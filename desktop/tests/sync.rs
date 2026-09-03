// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Integration tests for closing and reopening the collection around a full
//! sync (desktop/src/sync.rs) and the `/_desktop` commands that expose it.

use std::path::Path;

use anki_desktop::new_backend;
use anki_desktop::profile;
use anki_desktop::rpc;
use anki_desktop::scheme;
use anki_desktop::sync;
use anki_desktop::AppState;
use anki_desktop::Settings;
use anki_desktop::WebRoot;
use anki_proto::decks::DeckNames;
use anki_proto::decks::GetDeckNamesRequest;
use tauri::http::Method;
use tauri::http::StatusCode;

fn open_state(dir: &Path) -> AppState {
    let backend = new_backend();
    profile::open_collection(&backend, dir).unwrap();
    let state = AppState::new(backend, WebRoot::from_repo(), Settings::load(dir));
    state.set_media_dir(Some(profile::CollectionPaths::in_profile(dir).media_folder));
    state.set_profile_dir(Some(dir.to_path_buf()));
    state
}

fn collection_is_open(state: &AppState) -> bool {
    rpc::call_typed::<_, DeckNames>(
        &state.backend,
        "getDeckNames",
        &GetDeckNamesRequest::default(),
    )
    .is_ok()
}

#[test]
fn closes_and_reopens_the_collection() {
    let dir = tempfile::tempdir().unwrap();
    let state = open_state(dir.path());
    assert!(collection_is_open(&state));

    sync::close_collection(&state).unwrap();
    assert!(!collection_is_open(&state));
    assert_eq!(state.media_dir(), None);
    // Closing again is harmless.
    sync::close_collection(&state).unwrap();

    sync::reopen_collection(&state).unwrap();
    assert!(collection_is_open(&state));
    assert_eq!(state.media_dir(), Some(dir.path().join("collection.media")));
    // Reopening an open collection is a no-op, as after a full sync where
    // rslib has already rebuilt the collection itself.
    sync::reopen_collection(&state).unwrap();
    assert!(collection_is_open(&state));
    assert_eq!(state.media_dir(), Some(dir.path().join("collection.media")));
}

#[test]
fn reopening_needs_a_profile_folder() {
    let backend = new_backend();
    let state = AppState::new(
        backend,
        WebRoot::from_repo(),
        Settings::load(Path::new("/nonexistent")),
    );
    let err = sync::reopen_collection(&state).unwrap_err();
    assert_eq!(err, "no profile open");
}

#[test]
fn desktop_commands_close_and_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let state = open_state(dir.path());
    let post = |path: &str| scheme::dispatch(&state, &Method::POST, path, b"");
    let ready = || scheme::dispatch(&state, &Method::GET, "/_anki/readyz", b"").status();

    assert_eq!(ready(), StatusCode::OK);
    assert_eq!(post("/_desktop/closeCollection").status(), StatusCode::OK);
    assert_eq!(ready(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(!collection_is_open(&state));

    // A backend call while closed fails and names the error kind.
    let reply = scheme::dispatch(&state, &Method::POST, "/_anki/getDeckNames", b"");
    assert_eq!(reply.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        reply
            .headers()
            .get(scheme::ERROR_KIND_HEADER)
            .and_then(|v| v.to_str().ok()),
        Some("INVALID_INPUT")
    );
    assert_eq!(String::from_utf8_lossy(reply.body()), "CollectionNotOpen");

    assert_eq!(post("/_desktop/reopenCollection").status(), StatusCode::OK);
    assert_eq!(ready(), StatusCode::OK);
    assert!(collection_is_open(&state));
}

#[test]
fn sync_calls_without_auth_report_their_kind() {
    let dir = tempfile::tempdir().unwrap();
    let state = open_state(dir.path());
    // An empty SyncCollectionRequest has no auth; no network is involved.
    let reply = scheme::dispatch(&state, &Method::POST, "/_anki/syncCollection", b"");
    assert_eq!(reply.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        reply
            .headers()
            .get(scheme::ERROR_KIND_HEADER)
            .and_then(|v| v.to_str().ok()),
        Some("INVALID_INPUT")
    );
    assert!(String::from_utf8_lossy(reply.body()).contains("missing auth"));
    // Unknown methods carry no kind.
    let reply = scheme::dispatch(&state, &Method::POST, "/_anki/noSuchMethod", b"");
    assert_eq!(reply.status(), StatusCode::NOT_FOUND);
    assert!(reply.headers().get(scheme::ERROR_KIND_HEADER).is_none());
}
