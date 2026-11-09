// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Native actions the app shell asks the host for, posted to
//! `/_desktop/{command}`. These are the pieces of FrontendService that need
//! the operating system rather than rslib: opening links and files, native
//! dialogs, and the shell's own settings store.

use std::path::Path;
use std::path::PathBuf;
use std::sync::mpsc;

use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use tauri::http::StatusCode;

use crate::scheme::text;
use crate::scheme::Reply;
use crate::settings::Scope;
use crate::AppState;

#[derive(Debug, Deserialize)]
struct SettingsGet {
    scope: Scope,
    key: String,
}

#[derive(Debug, Deserialize)]
struct SettingsSet {
    scope: Scope,
    key: String,
    #[serde(default)]
    value: Value,
}

#[derive(Debug, Deserialize, Default)]
struct FilePick {
    #[serde(default)]
    title: String,
    #[serde(default)]
    filter_description: String,
    #[serde(default)]
    extensions: Vec<String>,
}

#[derive(Debug, Serialize)]
struct FilePicked {
    path: String,
}

#[derive(Debug, Deserialize, Default)]
struct FileSave {
    #[serde(default)]
    title: String,
    #[serde(default)]
    filter_description: String,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(default)]
    default_name: String,
}

#[derive(Debug, Serialize)]
struct ProfilePaths {
    profile_dir: String,
    backup_folder: String,
}

#[derive(Debug, Deserialize)]
struct ImportCollection {
    path: String,
}

pub fn handle(state: &AppState, cmd: &str, body: &[u8]) -> Reply {
    // The recorder posts raw audio bytes; the file name rides in the path.
    if let Some(name) = cmd.strip_prefix("saveRecording/") {
        return result(
            crate::recording::save(name, body)
                .map(|path| serde_json::json!({ "path": path.to_string_lossy() })),
        );
    }
    match cmd {
        "openLink" => {
            let url = String::from_utf8_lossy(body);
            result(open_link(&url).map(|_| Value::Null))
        }
        "openMedia" | "showInMediaFolder" => {
            let name = String::from_utf8_lossy(body);
            result(open_media(state, &name, cmd == "showInMediaFolder").map(|_| Value::Null))
        }
        "settingsGet" => match serde_json::from_slice::<SettingsGet>(body) {
            Ok(req) => json(state.settings_get(req.scope, &req.key)),
            Err(err) => text(StatusCode::BAD_REQUEST, err.to_string()),
        },
        "settingsSet" => match serde_json::from_slice::<SettingsSet>(body) {
            Ok(req) => result(
                state
                    .settings_set(req.scope, &req.key, req.value)
                    .map(|_| Value::Null)
                    .map_err(|e| e.to_string()),
            ),
            Err(err) => text(StatusCode::BAD_REQUEST, err.to_string()),
        },
        // Collection close/reopen for the sync flow; see sync.rs.
        "quit" => {
            state.quit();
            json(Value::Null)
        }
        // Updating from the newest GitHub release; see updater.rs.
        "checkForUpdate" => result(crate::updater::check(state)),
        "downloadUpdate" => result(crate::updater::download(state).map(|_| Value::Null)),
        "restartToUpdate" => {
            result(crate::updater::install_and_restart(state).map(|_| Value::Null))
        }
        "profiles" => json(crate::profile::profiles_json(state)),
        "downloadedDecks" => json(crate::downloads::downloaded_decks_json()),
        "switchProfile" => {
            let name = String::from_utf8_lossy(body).trim().to_string();
            result(
                crate::profile::switch_profile(state, &name)
                    .map(|_| Value::Null)
                    .map_err(|e| format!("{e:#}")),
            )
        }
        // Test support: refill the collection with demo notes. Only under
        // --serve, where the collection is a throwaway one.
        "seedDemo" => {
            if !state.in_serve_mode() {
                return text(
                    StatusCode::FORBIDDEN,
                    "seeding is only available under --serve".into(),
                );
            }
            let count: usize = String::from_utf8_lossy(body).trim().parse().unwrap_or(24);
            result(
                crate::demo::seed(&state.backend, count)
                    .map(|_| Value::from(count as u64))
                    .map_err(|e| e.to_string()),
            )
        }
        "createBackup" => result(
            crate::backup::create_backup(state, true)
                .map(Value::Bool)
                .map_err(|e| e.to_string()),
        ),
        "closeCollection" => result(crate::sync::close_collection(state).map(|_| Value::Null)),
        "reopenCollection" => result(crate::sync::reopen_collection(state).map(|_| Value::Null)),
        "openFilePicker" => {
            let req: FilePick = serde_json::from_slice(body).unwrap_or_default();
            let path = pick_file(state, &req)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            json(serde_json::to_value(FilePicked { path }).expect("json"))
        }
        "saveFilePicker" => {
            let req: FileSave = serde_json::from_slice(body).unwrap_or_default();
            let path = save_file(state, &req)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            json(serde_json::to_value(FilePicked { path }).expect("json"))
        }
        "profilePaths" => {
            result(profile_paths(state).map(|p| serde_json::to_value(p).expect("json")))
        }
        "importCollectionPackage" => match serde_json::from_slice::<ImportCollection>(body) {
            Ok(req) => result(import_collection_package(state, &req.path).map(|_| Value::Null)),
            Err(err) => text(StatusCode::BAD_REQUEST, err.to_string()),
        },
        _ => text(
            StatusCode::NOT_FOUND,
            format!("unknown desktop command: {cmd}"),
        ),
    }
}

fn json(value: Value) -> Reply {
    tauri::http::Response::builder()
        .status(StatusCode::OK)
        .header(tauri::http::header::CONTENT_TYPE, "application/json")
        .body(std::borrow::Cow::Owned(value.to_string().into_bytes()))
        .expect("json response")
}

fn result(outcome: Result<Value, String>) -> Reply {
    match outcome {
        Ok(value) => json(value),
        Err(err) => text(StatusCode::BAD_REQUEST, err),
    }
}

/// Open an http(s) or mailto link in the user's browser or mail client.
pub fn open_link(url: &str) -> Result<(), String> {
    if !link_is_allowed(url) {
        return Err(format!("refusing to open link: {url}"));
    }
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("open {url}: {err}"))
}

/// Only web and mail links leave the app; anything else could run a program.
pub fn link_is_allowed(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

/// Open a file from the media folder with its default app, or reveal it.
fn open_media(state: &AppState, name: &str, reveal: bool) -> Result<(), String> {
    if !crate::scheme::safe_media_path(name) {
        return Err(format!("invalid media path: {name}"));
    }
    let dir = state.media_dir().ok_or("no collection open")?;
    let path = dir.join(name);
    let mut command = std::process::Command::new("open");
    if reveal {
        command.arg("-R");
    }
    command
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("open {}: {err}", path.display()))
}

/// Show a native open-file dialog. Runs on the main thread, which is where
/// the scheme handler already is under Tauri; from the HTTP server the
/// request is forwarded to the main thread when an app exists. Tests set
/// `ANKI_TEST_FILE_PICK` to answer without a dialog.
fn pick_file(state: &AppState, req: &FilePick) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ANKI_TEST_FILE_PICK") {
        return if path.is_empty() {
            None
        } else {
            Some(PathBuf::from(path))
        };
    }
    let title = req.title.clone();
    let description = if req.filter_description.is_empty() {
        "Files".to_string()
    } else {
        req.filter_description.clone()
    };
    let extensions: Vec<String> = req
        .extensions
        .iter()
        .map(|e| e.trim_start_matches('.').to_string())
        .collect();
    let show = move || {
        let mut dialog = rfd::FileDialog::new().set_title(&title);
        if !extensions.is_empty() {
            dialog = dialog.add_filter(&description, &extensions);
        }
        dialog.pick_file()
    };
    if state.on_main_thread() {
        return show();
    }
    let app = state.app_handle()?;
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(show());
    })
    .ok()?;
    rx.recv().ok().flatten()
}

/// Tests answer a dialog through an environment variable: unset means show
/// the dialog, empty means the user cancelled, anything else is the path.
fn env_answer(var: &str) -> Option<Option<PathBuf>> {
    let value = std::env::var(var).ok()?;
    Some(if value.is_empty() {
        None
    } else {
        Some(PathBuf::from(value))
    })
}

/// Show a native save-file dialog, the counterpart of `pick_file`. Tests set
/// `ANKI_TEST_FILE_SAVE` to answer without a dialog.
fn save_file(state: &AppState, req: &FileSave) -> Option<PathBuf> {
    if let Some(answer) = env_answer("ANKI_TEST_FILE_SAVE") {
        return answer;
    }
    let title = req.title.clone();
    let description = if req.filter_description.is_empty() {
        "Files".to_string()
    } else {
        req.filter_description.clone()
    };
    let extensions: Vec<String> = req
        .extensions
        .iter()
        .map(|e| e.trim_start_matches('.').to_string())
        .collect();
    let default_name = req.default_name.clone();
    let show = move || {
        let mut dialog = rfd::FileDialog::new().set_title(&title);
        if !extensions.is_empty() {
            dialog = dialog.add_filter(&description, &extensions);
        }
        if !default_name.is_empty() {
            dialog = dialog.set_file_name(&default_name);
        }
        dialog.save_file()
    };
    if state.on_main_thread() {
        return show();
    }
    let app = state.app_handle()?;
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(show());
    })
    .ok()?;
    rx.recv().ok().flatten()
}

/// The open profile's folder: the parent of its media folder (see
/// `CollectionPaths::in_profile`).
fn profile_dir(state: &AppState) -> Result<PathBuf, String> {
    state
        .media_dir()
        .and_then(|dir| dir.parent().map(Path::to_path_buf))
        .ok_or_else(|| "no collection open".to_string())
}

/// `pm.backupFolder()` in the Qt app: <profile>/backups, created on demand.
fn profile_paths(state: &AppState) -> Result<ProfilePaths, String> {
    let dir = profile_dir(state)?;
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups)
        .map_err(|err| format!("create {}: {err}", backups.display()))?;
    Ok(ProfilePaths {
        profile_dir: dir.to_string_lossy().into_owned(),
        backup_folder: backups.to_string_lossy().into_owned(),
    })
}

/// ColpkgImporter._import: the backend needs the collection closed while it
/// replaces the files, and it is reopened whether or not that succeeded.
fn import_collection_package(state: &AppState, path: &str) -> Result<(), String> {
    let dir = profile_dir(state)?;
    let paths = crate::profile::CollectionPaths::in_profile(&dir);
    crate::profile::close_collection(&state.backend).map_err(|err| format!("{err:#}"))?;
    let request = anki_proto::import_export::ImportCollectionPackageRequest {
        col_path: paths.collection.to_string_lossy().into_owned(),
        backup_path: path.to_string(),
        media_folder: paths.media_folder.to_string_lossy().into_owned(),
        media_db: paths.media_db.to_string_lossy().into_owned(),
    };
    let imported = crate::rpc::call_typed::<_, anki_proto::generic::Empty>(
        &state.backend,
        "importCollectionPackage",
        &request,
    )
    .map(|_| ())
    .map_err(|err| err.message());
    let reopened =
        crate::profile::open_collection(&state.backend, &dir).map_err(|err| format!("{err:#}"));
    imported.and(reopened)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_picker_is_answered_by_the_environment() {
        const VAR: &str = "ANKI_TEST_FILE_SAVE_UNIT_TEST";
        std::env::remove_var(VAR);
        assert_eq!(env_answer(VAR), None, "unset: show the dialog");
        std::env::set_var(VAR, "");
        assert_eq!(env_answer(VAR), Some(None), "empty: cancelled");
        std::env::set_var(VAR, "/tmp/out/Default.apkg");
        assert_eq!(
            env_answer(VAR),
            Some(Some(PathBuf::from("/tmp/out/Default.apkg")))
        );
        std::env::remove_var(VAR);
    }

    #[test]
    fn save_request_parses_with_defaults() {
        let req: FileSave = serde_json::from_str(
            r#"{"title":"Export","extensions":["apkg"],"default_name":"Default.apkg"}"#,
        )
        .unwrap();
        assert_eq!(req.title, "Export");
        assert_eq!(req.extensions, vec!["apkg"]);
        assert_eq!(req.default_name, "Default.apkg");
        assert!(req.filter_description.is_empty());
        let empty: FileSave = serde_json::from_str("{}").unwrap();
        assert!(empty.default_name.is_empty());
    }

    #[test]
    fn only_web_and_mail_links_open() {
        assert!(link_is_allowed("https://docs.ankiweb.net/"));
        assert!(link_is_allowed("  HTTP://example.com"));
        assert!(link_is_allowed("mailto:someone@example.com"));
        assert!(!link_is_allowed("file:///etc/passwd"));
        assert!(!link_is_allowed("javascript:alert(1)"));
        assert!(!link_is_allowed("/usr/bin/say"));
        assert!(!link_is_allowed(""));
    }

    #[test]
    fn settings_requests_parse() {
        let get: SettingsGet =
            serde_json::from_str(r#"{"scope":"profile","key":"syncUser"}"#).unwrap();
        assert_eq!(get.scope, Scope::Profile);
        assert_eq!(get.key, "syncUser");
        let set: SettingsSet =
            serde_json::from_str(r#"{"scope":"meta","key":"k","value":{"a":1}}"#).unwrap();
        assert_eq!(set.scope, Scope::Meta);
        assert_eq!(set.value["a"], 1);
        let unset: SettingsSet = serde_json::from_str(r#"{"scope":"meta","key":"k"}"#).unwrap();
        assert!(unset.value.is_null());
    }
}
