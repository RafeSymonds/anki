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
        dir.path().to_path_buf(),
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

#[test]
fn forced_backups_land_in_the_profile_folder() {
    let dir = tempfile::tempdir().unwrap();
    let backend = new_backend();
    profile::open_collection(&backend, dir.path()).unwrap();
    let state = AppState::new(
        backend,
        WebRoot {
            web: dir.path().join("web"),
        },
        Settings::load(dir.path()),
        dir.path().to_path_buf(),
    );
    state.set_profile_dir(Some(dir.path().to_path_buf()));

    assert!(anki_desktop::backup::create_backup(&state, true).unwrap());
    let backups: Vec<_> = std::fs::read_dir(dir.path().join("backups"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        backups.iter().any(|name| name.ends_with(".colpkg")),
        "expected a .colpkg in {backups:?}"
    );
    profile::close_collection(&state.backend).unwrap();
}

#[test]
fn switching_profiles_moves_collection_settings_and_media() {
    let base = tempfile::tempdir().unwrap();
    let first = base.path().join("User 1");
    let backend = new_backend();
    profile::open_collection(&backend, &first).unwrap();
    let state = AppState::new(
        backend,
        WebRoot {
            web: base.path().join("web"),
        },
        Settings::load(&first),
        base.path().to_path_buf(),
    );
    state.set_profile_dir(Some(first.clone()));
    state
        .settings_set(
            anki_desktop::settings::Scope::Profile,
            "syncUser",
            serde_json::json!("a"),
        )
        .unwrap();

    profile::switch_profile(&state, "Second").unwrap();
    assert_eq!(state.profile_dir(), Some(base.path().join("Second")));
    assert_eq!(
        state.media_dir(),
        Some(base.path().join("Second/collection.media"))
    );
    assert!(base.path().join("Second/collection.anki2").exists());
    // Settings are per profile: the new one starts empty.
    assert_eq!(
        state.settings_get(anki_desktop::settings::Scope::Profile, "syncUser"),
        serde_json::Value::Null
    );
    let listed = profile::profiles_json(&state);
    assert_eq!(listed["current"], "Second");
    assert_eq!(listed["profiles"], serde_json::json!(["Second", "User 1"]));

    profile::switch_profile(&state, "User 1").unwrap();
    assert_eq!(
        state.settings_get(anki_desktop::settings::Scope::Profile, "syncUser"),
        serde_json::json!("a")
    );
    assert!(profile::switch_profile(&state, "../x").is_err());
    profile::close_collection(&state.backend).unwrap();
}

#[test]
fn reseeding_still_works_after_a_stock_notetype_gained_a_field() {
    use anki_proto::notetypes::notetype::Field;
    use anki_proto::notetypes::Notetype;
    use anki_proto::notetypes::NotetypeId;
    use anki_proto::notetypes::NotetypeNames;
    use anki_proto::search::SearchRequest;
    use anki_proto::search::SearchResponse;

    let dir = tempfile::tempdir().unwrap();
    let backend = new_backend();
    profile::open_collection(&backend, dir.path()).unwrap();
    anki_desktop::demo::seed(&backend, 4).unwrap();

    let names: NotetypeNames = rpc::call_typed(&backend, "getNotetypeNames", &Empty {}).unwrap();
    let basic = names.entries.iter().find(|n| n.name == "Basic").unwrap().id;
    let mut notetype: Notetype =
        rpc::call_typed(&backend, "getNotetype", &NotetypeId { ntid: basic }).unwrap();
    notetype.fields.push(Field {
        name: "Extra".into(),
        config: Some(Default::default()),
        ..Default::default()
    });
    let _: anki_proto::collection::OpChanges =
        rpc::call_typed(&backend, "updateNotetype", &notetype).unwrap();

    // What the e2e suite does after its first-run spec empties the collection.
    anki_desktop::demo::seed(&backend, 4).unwrap();
    let found: SearchResponse = rpc::call_typed(
        &backend,
        "searchNotes",
        &SearchRequest {
            search: "tag:demo".into(),
            order: None,
        },
    )
    .unwrap();
    assert_eq!(found.ids.len(), 8);
}

#[test]
fn seeded_profiles_skip_the_first_card_guide() {
    let base = tempfile::tempdir().unwrap();
    let options = anki_desktop::Options {
        base: Some(base.path().to_path_buf()),
        seed: Some(2),
        ..Default::default()
    };
    let state = anki_desktop::open_state(&options, WebRoot::from_repo());
    assert_eq!(
        state.settings_get(
            anki_desktop::settings::Scope::Profile,
            anki_desktop::FIRST_CARD_GUIDE_KEY
        ),
        serde_json::Value::Bool(true)
    );

    let unseeded = anki_desktop::Options {
        base: Some(tempfile::tempdir().unwrap().path().to_path_buf()),
        ..Default::default()
    };
    let state = anki_desktop::open_state(&unseeded, WebRoot::from_repo());
    assert_eq!(
        state.settings_get(
            anki_desktop::settings::Scope::Profile,
            anki_desktop::FIRST_CARD_GUIDE_KEY
        ),
        serde_json::Value::Null
    );
}

#[test]
fn periodic_backups_wait_for_a_profile_and_for_time_to_pass() {
    use anki_desktop::backup;

    let base = tempfile::tempdir().unwrap();
    let backend = new_backend();
    let state = AppState::new(
        backend,
        WebRoot::from_repo(),
        Settings::load(std::path::Path::new("/nonexistent")),
        base.path().to_path_buf(),
    );
    // Nothing open yet: a tick is a no-op, not an error.
    assert!(!backup::periodic_tick(&state).unwrap());

    let profile = base.path().join("User 1");
    profile::open_collection(&state.backend, &profile).unwrap();
    state.set_profile_dir(Some(profile.clone()));
    assert!(backup::create_backup(&state, true).unwrap());
    // Just backed up and nothing changed since: rslib skips the unforced one.
    assert!(!backup::periodic_tick(&state).unwrap());
    assert_eq!(
        std::fs::read_dir(backup::backup_folder(&profile))
            .unwrap()
            .count(),
        1
    );
}
