// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Integration tests: the desktop crate driving rslib in-process, the same
//! way the running app does, against a throwaway collection.

use anki_desktop::new_backend;
use anki_desktop::profile;
use anki_desktop::rpc;
use anki_desktop::scheme;
use anki_desktop::AppState;
use anki_desktop::Settings;
use anki_desktop::WebRoot;
use anki_proto::decks::DeckNames;
use anki_proto::decks::GetDeckNamesRequest;
use anki_proto::generic::Empty;
use anki_proto::generic::Json;
use anki_proto::generic::String as PbString;
use anki_proto::i18n::I18nResourcesRequest;
use anki_proto::scheduler::CongratsInfoResponse;
use prost::Message;
use tauri::http::Method;

#[test]
fn opens_a_fresh_collection_and_serves_rpcs() {
    let dir = tempfile::tempdir().unwrap();
    let backend = new_backend();
    profile::open_collection(&backend, dir.path()).unwrap();

    let names: DeckNames = rpc::call_typed(
        &backend,
        "getDeckNames",
        &GetDeckNamesRequest {
            skip_empty_default: false,
            include_filtered: true,
        },
    )
    .unwrap();
    assert!(
        names.entries.iter().any(|d| d.name == "Default"),
        "fresh collection has a Default deck: {names:?}"
    );

    let congrats: CongratsInfoResponse =
        rpc::call_typed(&backend, "congratsInfo", &Empty {}).unwrap();
    assert_eq!(congrats.learn_remaining, 0);
    assert!(!congrats.new_remaining);
    assert!(!congrats.review_remaining);

    // The first call every SvelteKit page makes.
    let json: Json = rpc::call_typed(
        &backend,
        "i18nResources",
        &I18nResourcesRequest {
            modules: vec!["scheduling".into()],
        },
    )
    .unwrap();
    let text = String::from_utf8(json.json).unwrap();
    assert!(
        text.contains("scheduling-congratulations-finished"),
        "{text}"
    );

    profile::close_collection(&backend).unwrap();
    assert!(dir.path().join("collection.anki2").exists());
}

#[test]
fn missing_config_keys_read_as_null_like_mediasrv() {
    let dir = tempfile::tempdir().unwrap();
    let backend = new_backend();
    profile::open_collection(&backend, dir.path()).unwrap();

    let key = |val: &str| anki_proto::generic::String { val: val.into() };
    // The editor asks for keys that only exist once set (mediasrv.py::get_config_json).
    let missing: Json = rpc::call_typed(&backend, "getConfigJson", &key("renderMathjax")).unwrap();
    assert_eq!(missing.json, b"null");
    // Keys that exist keep their value.
    let sort: Json = rpc::call_typed(&backend, "getConfigJson", &key("sortType")).unwrap();
    assert_eq!(sort.json, b"\"noteFld\"");
    // Other not-found errors still surface.
    let err = rpc::call_typed::<_, anki_proto::cards::Card>(
        &backend,
        "getCard",
        &anki_proto::cards::CardId { cid: 1 },
    )
    .unwrap_err();
    assert!(!err.message().is_empty());

    profile::close_collection(&backend).unwrap();
}

#[test]
fn unknown_method_is_reported_by_name() {
    let backend = new_backend();
    let err = rpc::call(&backend, "noSuchMethod", &[]).unwrap_err();
    assert!(err.is_unknown_method());
    assert_eq!(err.message(), "unknown backend method: noSuchMethod");
}

#[test]
fn calls_before_a_collection_is_open_fail_cleanly() {
    let backend = new_backend();
    let err =
        rpc::call_typed::<_, DeckNames>(&backend, "getDeckNames", &GetDeckNamesRequest::default())
            .unwrap_err();
    assert!(!err.is_unknown_method());
    assert!(!err.message().is_empty());
}

#[test]
fn missing_config_keys_answer_null_like_mediasrv() {
    let dir = tempfile::tempdir().unwrap();
    let backend = new_backend();
    profile::open_collection(&backend, dir.path()).unwrap();
    let state = AppState::new(
        backend,
        WebRoot {
            web: dir.path().join("web"),
        },
        Settings::load(dir.path()),
    );

    let body = PbString {
        val: "renderMathjax".into(),
    }
    .encode_to_vec();
    let reply = scheme::dispatch(&state, &Method::POST, "/_anki/getConfigJson", &body);
    assert_eq!(reply.status(), 200);
    let json = Json::decode(reply.body().as_ref()).unwrap();
    assert_eq!(json.json, b"null");

    // Other errors still surface as 500s with the backend's message.
    let reply = scheme::dispatch(&state, &Method::POST, "/_anki/getCard", &[]);
    assert_eq!(reply.status(), 500);

    profile::close_collection(&state.backend).unwrap();
}
