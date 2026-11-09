// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! In-app updates from the newest GitHub release, through Tauri's updater
//! plugin. `plugins.updater` in tauri.conf.json names the release's
//! latest.json and the public key the release's archive must be signed with.
//!
//! The three steps are separate commands so the running app is only disturbed
//! by the last one: `check` asks GitHub, `download` fetches the archive into
//! memory and verifies its signature, and `install_and_restart` replaces the
//! bundle and relaunches. The relaunch goes through `RunEvent::Exit`, so the
//! backup and the collection close in lib.rs run first.

use std::path::Path;
use std::time::Duration;

use serde_json::json;
use serde_json::Value;
use tauri_plugin_updater::Update;
use tauri_plugin_updater::UpdaterExt;

use crate::AppState;

/// How long one request may take in all, the archive download included.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
/// Fails an offline check quickly rather than after `REQUEST_TIMEOUT`.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// The release `check` found, and its verified archive once `download` ran.
pub struct PendingUpdate {
    update: Update,
    archive: Option<Vec<u8>>,
}

/// Why this copy of the app cannot replace itself, if it cannot. The updater
/// replaces the `.app` around the running binary, so there has to be one, and
/// it has to be somewhere writable: macOS runs a downloaded app that was not
/// moved from a read-only translocated copy, and a disk image is read-only.
fn update_blocker(exe: &Path) -> Option<&'static str> {
    let in_bundle = exe
        .parent()
        .filter(|dir| dir.ends_with("Contents/MacOS"))
        .and_then(|dir| dir.parent()?.parent())
        .is_some_and(|bundle| bundle.extension().is_some_and(|ext| ext == "app"));
    if !in_bundle {
        return Some("Updates only work in the installed app, not in a development build.");
    }
    let translocated = exe
        .components()
        .any(|part| part.as_os_str() == "AppTranslocation");
    if translocated || exe.starts_with("/Volumes") {
        return Some("Move Anki to the Applications folder to update it.");
    }
    None
}

fn unsupported(reason: &str) -> Value {
    json!({ "status": "unsupported", "reason": reason })
}

/// Ask GitHub whether a newer release exists, and remember it for `download`.
pub fn check(state: &AppState) -> Result<Value, String> {
    // Absent under --serve, which has no bundle to replace.
    let Some(app) = state.app_handle() else {
        return Ok(unsupported(
            "Updates only work in the installed app, not in a development build.",
        ));
    };
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    if let Some(reason) = update_blocker(&exe) {
        return Ok(unsupported(reason));
    }
    let updater = app
        .updater_builder()
        .timeout(REQUEST_TIMEOUT)
        .configure_client(|client| client.connect_timeout(CONNECT_TIMEOUT))
        .build()
        .map_err(|err| err.to_string())?;
    let found = tauri::async_runtime::block_on(updater.check()).map_err(|err| err.to_string())?;
    let mut pending = state.pending_update.lock().expect("pending update lock");
    let Some(update) = found else {
        *pending = None;
        return Ok(json!({
            "status": "current",
            "version": app.package_info().version.to_string(),
        }));
    };
    let version = update.version.clone();
    // Checking again must not throw away an archive that is already here.
    let already_known = pending
        .as_ref()
        .is_some_and(|known| known.update.version == version);
    if !already_known {
        *pending = Some(PendingUpdate {
            update,
            archive: None,
        });
    }
    Ok(json!({ "status": "available", "version": version }))
}

/// Download the release `check` found. The plugin verifies the signature
/// before returning the bytes, so anything kept here is safe to install.
pub fn download(state: &AppState) -> Result<(), String> {
    let update = {
        let pending = state.pending_update.lock().expect("pending update lock");
        match pending.as_ref() {
            Some(known) if known.archive.is_some() => return Ok(()),
            Some(known) => known.update.clone(),
            None => return Err("No update to download; check for updates first.".into()),
        }
    };
    let archive = tauri::async_runtime::block_on(update.download(|_, _| {}, || {}))
        .map_err(|err| err.to_string())?;
    // The archive stays paired with the release it came from, whatever a check
    // did to the pending slot while this ran.
    *state.pending_update.lock().expect("pending update lock") = Some(PendingUpdate {
        update,
        archive: Some(archive),
    });
    Ok(())
}

/// Replace the bundle with the downloaded release and relaunch. A failure
/// leaves the app running as it was, so the shell can report it.
pub fn install_and_restart(state: &AppState) -> Result<(), String> {
    let pending = state.pending_update.lock().expect("pending update lock");
    let Some(PendingUpdate {
        update,
        archive: Some(archive),
    }) = pending.as_ref()
    else {
        return Err("No update has been downloaded.".into());
    };
    update.install(archive).map_err(|err| err.to_string())?;
    state.restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_installed_bundle_can_replace_itself() {
        let blocker = |path: &str| update_blocker(Path::new(path));
        assert_eq!(
            blocker("/Applications/Anki.app/Contents/MacOS/anki-desktop"),
            None
        );
        assert_eq!(
            blocker("/Users/me/Applications/Anki Desktop.app/Contents/MacOS/anki-desktop"),
            None
        );
        // bin/anki start runs the bare binary.
        assert!(blocker("/Users/me/anki/target/debug/anki-desktop")
            .unwrap()
            .contains("development build"));
        assert!(blocker("/Users/me/Contents/MacOS/anki-desktop")
            .unwrap()
            .contains("development build"));
        // Opened straight from the disk image, or from Downloads without moving it.
        assert!(
            blocker("/Volumes/Anki/Anki.app/Contents/MacOS/anki-desktop")
                .unwrap()
                .contains("Applications folder")
        );
        assert!(blocker(
            "/private/var/folders/x/AppTranslocation/ABC/d/Anki.app/Contents/MacOS/anki-desktop"
        )
        .unwrap()
        .contains("Applications folder"));
    }
}
