// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Per-profile settings the shell keeps outside the collection: the values
//! the Qt app stored in its pickled profile and meta dictionaries (sync
//! credentials, remembered dialog state, editor preferences). Stored as
//! JSON next to the collection so nothing here touches the collection file
//! or the sync protocol.

use std::collections::BTreeMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::Context;
use anyhow::Result;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

pub const FILE_NAME: &str = "desktop-settings.json";

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SettingsData {
    /// `mw.pm.profile` in the Qt app: per-profile values.
    #[serde(default)]
    pub profile: BTreeMap<String, Value>,
    /// `mw.pm.meta` in the Qt app: values shared by all profiles. Kept per
    /// profile here for simplicity.
    #[serde(default)]
    pub meta: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Profile,
    Meta,
}

pub struct Settings {
    path: PathBuf,
    data: Mutex<SettingsData>,
}

impl Settings {
    /// Load from the profile folder, starting empty if there is no file yet.
    pub fn load(profile_dir: &Path) -> Self {
        let path = profile_dir.join(FILE_NAME);
        let data = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn get(&self, scope: Scope, key: &str) -> Value {
        let data = self.data.lock().expect("settings lock");
        let map = match scope {
            Scope::Profile => &data.profile,
            Scope::Meta => &data.meta,
        };
        map.get(key).cloned().unwrap_or(Value::Null)
    }

    pub fn set(&self, scope: Scope, key: &str, value: Value) -> Result<()> {
        let snapshot = {
            let mut data = self.data.lock().expect("settings lock");
            let map = match scope {
                Scope::Profile => &mut data.profile,
                Scope::Meta => &mut data.meta,
            };
            if value.is_null() {
                map.remove(key);
            } else {
                map.insert(key.to_string(), value);
            }
            data.clone()
        };
        self.save(&snapshot)
    }

    fn save(&self, data: &SettingsData) -> Result<()> {
        let json = serde_json::to_vec_pretty(data)?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json).with_context(|| format!("write {}", tmp.display()))?;
        std::fs::rename(&tmp, &self.path)
            .with_context(|| format!("rename to {}", self.path.display()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings::load(dir.path());
        assert_eq!(settings.get(Scope::Profile, "syncUser"), Value::Null);

        settings
            .set(
                Scope::Profile,
                "syncUser",
                Value::String("me@example.com".into()),
            )
            .unwrap();
        settings
            .set(Scope::Meta, "lastMsg", serde_json::json!({ "n": 3 }))
            .unwrap();

        let reloaded = Settings::load(dir.path());
        assert_eq!(
            reloaded.get(Scope::Profile, "syncUser"),
            Value::String("me@example.com".into())
        );
        assert_eq!(reloaded.get(Scope::Meta, "lastMsg")["n"], 3);
        assert_eq!(reloaded.get(Scope::Meta, "syncUser"), Value::Null);

        // Null removes the key.
        reloaded
            .set(Scope::Profile, "syncUser", Value::Null)
            .unwrap();
        assert_eq!(
            Settings::load(dir.path()).get(Scope::Profile, "syncUser"),
            Value::Null
        );
    }

    #[test]
    fn corrupt_file_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), b"not json").unwrap();
        let settings = Settings::load(dir.path());
        assert_eq!(settings.get(Scope::Meta, "x"), Value::Null);
    }
}
