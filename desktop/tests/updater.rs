// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The update commands without an app around them, which is what `--serve`
//! and a development build see. The real flow needs a signed release; see
//! "Updates" in desktop/README.md.

use anki_desktop::desktop_api;
use anki_desktop::new_backend;
use anki_desktop::profile;
use anki_desktop::AppState;
use anki_desktop::Settings;
use anki_desktop::WebRoot;
use tauri::http::StatusCode;

fn state(dir: &std::path::Path) -> AppState {
    let backend = new_backend();
    profile::open_collection(&backend, dir).unwrap();
    AppState::new(
        backend,
        WebRoot {
            web: dir.join("web"),
        },
        Settings::load(dir),
        dir.to_path_buf(),
    )
}

#[test]
fn without_an_app_there_is_nothing_to_update() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path());

    let reply = desktop_api::handle(&state, "checkForUpdate", b"");
    assert_eq!(reply.status(), StatusCode::OK);
    let body: serde_json::Value = serde_json::from_slice(reply.body()).unwrap();
    assert_eq!(body["status"], "unsupported");
    assert!(body["reason"].as_str().unwrap().contains("installed app"));
}

#[test]
fn downloading_and_restarting_need_an_update_first() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path());

    let download = desktop_api::handle(&state, "downloadUpdate", b"");
    assert_eq!(download.status(), StatusCode::BAD_REQUEST);

    let restart = desktop_api::handle(&state, "restartToUpdate", b"");
    assert_eq!(restart.status(), StatusCode::BAD_REQUEST);
    assert!(
        !state.is_quitting(),
        "a refused restart must not start quitting"
    );
}
