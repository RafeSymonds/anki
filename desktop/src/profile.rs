// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Locating the Anki data folder and opening a collection.
//!
//! The Qt app keeps a list of profiles in a pickled prefs21.db. We do not
//! read that file; a profile is simply a folder under the base directory,
//! and the folder layout is the one rslib and the Qt app already share.

use std::path::Path;
use std::path::PathBuf;

use anki::backend::Backend;
use anki_proto::collection::CloseCollectionRequest;
use anki_proto::collection::OpenCollectionRequest;
use anki_proto::generic::Empty;
use anyhow::Context;
use anyhow::Result;

use crate::rpc;
use crate::settings::Settings;
use crate::AppState;

pub const DEFAULT_PROFILE: &str = "User 1";

/// `ANKI_BASE` if set, otherwise the folder the Qt app uses on macOS.
pub fn base_dir() -> PathBuf {
    if let Ok(base) = std::env::var("ANKI_BASE") {
        if !base.is_empty() {
            return PathBuf::from(base);
        }
    }
    dirs::home_dir()
        .expect("home directory")
        .join("Library/Application Support/Anki2")
}

/// Profile folders under `base`, sorted by name. Skips the add-ons folder
/// and hidden entries.
pub fn profile_dirs(base: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(base) else {
        return vec![];
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name != "addons21" && !name.starts_with('.')
        })
        .map(|e| e.path())
        .collect();
    dirs.sort();
    dirs
}

/// The profile to open when none is chosen: the first folder that already
/// holds a collection, else the first folder, else a new default profile.
pub fn default_profile_dir(base: &Path) -> PathBuf {
    let dirs = profile_dirs(base);
    dirs.iter()
        .find(|d| d.join("collection.anki2").exists())
        .cloned()
        .or_else(|| dirs.first().cloned())
        .unwrap_or_else(|| base.join(DEFAULT_PROFILE))
}

/// The three paths rslib needs, laid out the way pylib's
/// `media_paths_from_col_path` does it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectionPaths {
    pub collection: PathBuf,
    pub media_folder: PathBuf,
    pub media_db: PathBuf,
}

impl CollectionPaths {
    pub fn in_profile(dir: &Path) -> Self {
        Self {
            collection: dir.join("collection.anki2"),
            media_folder: dir.join("collection.media"),
            media_db: dir.join("collection.media.db2"),
        }
    }
}

/// Open (creating if needed) the collection in a profile folder.
pub fn open_collection(backend: &Backend, dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
    let paths = CollectionPaths::in_profile(dir);
    let request = OpenCollectionRequest {
        collection_path: paths.collection.to_string_lossy().into_owned(),
        media_folder_path: paths.media_folder.to_string_lossy().into_owned(),
        media_db_path: paths.media_db.to_string_lossy().into_owned(),
    };
    rpc::call_typed::<_, Empty>(backend, "openCollection", &request)
        .with_context(|| format!("open collection in {}", dir.display()))?;
    Ok(())
}

pub fn close_collection(backend: &Backend) -> Result<()> {
    let request = CloseCollectionRequest {
        downgrade_to_schema11: false,
    };
    rpc::call_typed::<_, Empty>(backend, "closeCollection", &request)
        .context("close collection")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_follow_pylib_layout() {
        let paths = CollectionPaths::in_profile(Path::new("/base/User 1"));
        assert_eq!(paths.collection, Path::new("/base/User 1/collection.anki2"));
        assert_eq!(
            paths.media_folder,
            Path::new("/base/User 1/collection.media")
        );
        assert_eq!(
            paths.media_db,
            Path::new("/base/User 1/collection.media.db2")
        );
    }

    #[test]
    fn profile_names_are_folder_names() {
        assert!(valid_profile_name("User 1"));
        assert!(valid_profile_name("Work"));
        assert!(!valid_profile_name(""));
        assert!(!valid_profile_name(".hidden"));
        assert!(!valid_profile_name("a/b"));
        assert!(!valid_profile_name("addons21"));
    }

    #[test]
    fn default_profile_prefers_existing_collections() {
        let base = tempfile::tempdir().unwrap();
        assert_eq!(
            default_profile_dir(base.path()),
            base.path().join(DEFAULT_PROFILE)
        );

        std::fs::create_dir_all(base.path().join("addons21")).unwrap();
        std::fs::create_dir_all(base.path().join("Alpha")).unwrap();
        std::fs::create_dir_all(base.path().join("Beta")).unwrap();
        std::fs::write(base.path().join("Beta/collection.anki2"), b"").unwrap();

        assert_eq!(
            profile_dirs(base.path()),
            vec![base.path().join("Alpha"), base.path().join("Beta")]
        );
        assert_eq!(default_profile_dir(base.path()), base.path().join("Beta"));
    }
}

/// Profile names under the base folder, always including the open one.
pub fn profile_names(base: &Path, current: Option<&Path>) -> Vec<String> {
    let mut names: Vec<String> = profile_dirs(base)
        .iter()
        .filter_map(|d| d.file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect();
    if let Some(current) = current.and_then(|c| c.file_name()) {
        let current = current.to_string_lossy().into_owned();
        if !names.contains(&current) {
            names.push(current);
        }
    }
    names.sort();
    names
}

/// `{ "profiles": [...], "current": "User 1" }` for the profile switcher.
pub fn profiles_json(state: &AppState) -> serde_json::Value {
    let current = state.profile_dir();
    let names = profile_names(state.base_dir(), current.as_deref());
    let current_name = current
        .as_deref()
        .and_then(|c| c.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    serde_json::json!({ "profiles": names, "current": current_name })
}

/// A profile name is a plain folder name.
pub fn valid_profile_name(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name.len() <= 100
        && !name.starts_with('.')
        && name != "addons21"
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains(':')
}

/// Close the open collection and open the named profile's, creating the
/// profile when it does not exist yet. Settings and the media folder follow.
pub fn switch_profile(state: &AppState, name: &str) -> Result<()> {
    let name = name.trim();
    if !valid_profile_name(name) {
        anyhow::bail!("invalid profile name: {name:?}");
    }
    let dir = state.base_dir().join(name);
    if state.profile_dir().as_deref() == Some(dir.as_path()) {
        return Ok(());
    }
    close_collection(&state.backend).context("close current collection")?;
    open_collection(&state.backend, &dir)?;
    state.set_profile_dir(Some(dir.clone()));
    state.set_media_dir(Some(CollectionPaths::in_profile(&dir).media_folder));
    state.replace_settings(Settings::load(&dir));
    Ok(())
}
