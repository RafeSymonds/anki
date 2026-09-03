// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Collection backups, as the Qt app makes them: rslib writes a .colpkg
//! into `<profile>/backups` when its configured interval has elapsed, or
//! always when forced. Done on quit here; the Tools menu can force one.

use std::path::Path;
use std::path::PathBuf;

use anki_proto::collection::CreateBackupRequest;
use anki_proto::generic::Bool;
use anyhow::Context;
use anyhow::Result;

use crate::rpc;
use crate::AppState;

/// `pm.backupFolder()` in the Qt app.
pub fn backup_folder(profile_dir: &Path) -> PathBuf {
    profile_dir.join("backups")
}

/// Ask rslib for a backup of the open collection; waits until it is written.
/// Returns whether one was created (rslib skips it when too recent, unless forced).
pub fn create_backup(state: &AppState, force: bool) -> Result<bool> {
    let profile_dir = state.profile_dir().context("no profile open")?;
    let folder = backup_folder(&profile_dir);
    std::fs::create_dir_all(&folder).with_context(|| format!("create {}", folder.display()))?;
    let created: Bool = rpc::call_typed(
        &state.backend,
        "createBackup",
        &CreateBackupRequest {
            backup_folder: folder.to_string_lossy().into_owned(),
            force,
            wait_for_completion: true,
        },
    )
    .context("create backup")?;
    Ok(created.val)
}

/// main.py checks every five minutes whether a backup is due.
pub const PERIODIC_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// One timer tick: an unforced backup when a profile is open. rslib decides
/// whether enough time has passed and the collection changed.
pub fn periodic_tick(state: &AppState) -> Result<bool> {
    if state.profile_dir().is_none() {
        return Ok(false);
    }
    create_backup(state, false)
}

/// Runs `periodic_tick` every `PERIODIC_INTERVAL` until the app quits.
pub fn periodic_loop(handle: &tauri::AppHandle) {
    use tauri::Manager;
    loop {
        std::thread::sleep(PERIODIC_INTERVAL);
        let state = handle.state::<AppState>();
        if state.is_quitting() {
            return;
        }
        match periodic_tick(&state) {
            Ok(true) => eprintln!("periodic backup created"),
            Ok(false) => {}
            Err(err) => eprintln!("periodic backup: {err:#}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backups_live_under_the_profile() {
        assert_eq!(
            backup_folder(Path::new("/base/User 1")),
            PathBuf::from("/base/User 1/backups")
        );
    }
}
