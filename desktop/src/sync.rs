//! Closing and reopening the open collection from the shell: the counterpart
//! of `close_for_full_sync` / `reopen(after_full_sync=True)` in pylib's
//! collection.py, reachable from web code as `/_desktop/closeCollection` and
//! `/_desktop/reopenCollection`.
//!
//! rslib's `fullUploadOrDownload` takes the collection out of the backend by
//! itself and rebuilds it afterwards (see `full_sync_inner` in
//! rslib/src/backend/sync.rs), and fails with `CollectionNotOpen` if it was
//! closed beforehand. The sync flow therefore never calls `close_collection`
//! first; it calls `reopen_collection` afterwards, which is a no-op when the
//! backend has already reopened the collection and recovers when rebuilding
//! it failed.

use crate::profile;
use crate::profile::CollectionPaths;
use crate::AppState;

/// Close the collection and stop serving its media. Harmless when it is
/// already closed.
pub fn close_collection(state: &AppState) -> Result<(), String> {
    match profile::close_collection(&state.backend) {
        Ok(()) => {}
        Err(err) if is_state_error(&err, "CollectionNotOpen") => {}
        Err(err) => return Err(format!("{err:#}")),
    }
    state.set_media_dir(None);
    Ok(())
}

/// Make sure the profile's collection is open and its media folder is served
/// again. Harmless when it is already open.
pub fn reopen_collection(state: &AppState) -> Result<(), String> {
    let dir = state.profile_dir().ok_or("no profile open")?;
    match profile::open_collection(&state.backend, &dir) {
        Ok(()) => {}
        Err(err) if is_state_error(&err, "CollectionAlreadyOpen") => {}
        Err(err) => return Err(format!("{err:#}")),
    }
    state.set_media_dir(Some(CollectionPaths::in_profile(&dir).media_folder));
    Ok(())
}

/// rslib reports a collection that is already open, or not open, as an error
/// whose message is the bare variant name.
fn is_state_error(err: &anyhow::Error, variant: &str) -> bool {
    err.chain().any(|cause| cause.to_string() == variant)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_backend_state_errors_through_context() {
        let already_open =
            anyhow::anyhow!("CollectionAlreadyOpen").context("open collection in /x");
        assert!(is_state_error(&already_open, "CollectionAlreadyOpen"));
        assert!(!is_state_error(&already_open, "CollectionNotOpen"));
        let other = anyhow::anyhow!("disk full").context("open collection in /x");
        assert!(!is_state_error(&other, "CollectionAlreadyOpen"));
    }
}
