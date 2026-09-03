// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The native macOS menu bar. Besides the standard application and edit
//! menus (which WKWebView needs for copy/paste and the usual text keys),
//! it lists the app's actions; picking one runs `window.__ankiMenu(id)` in
//! the main window, where the shell maps ids to screens and dialogs.
//!
//! Single-letter shortcuts (A, B, T, Y, ...) stay in the shell's JavaScript
//! so they never swallow typing; only chorded accelerators live here.

use tauri::menu::AboutMetadata;
use tauri::menu::Menu;
use tauri::menu::MenuEvent;
use tauri::menu::MenuItem;
use tauri::menu::PredefinedMenuItem;
use tauri::menu::Submenu;
use tauri::AppHandle;
use tauri::Manager;
use tauri::Runtime;

/// (id, label, accelerator) for the app's own menu items.
pub const ITEMS: &[(&str, &str, Option<&str>)] = &[
    ("preferences", "Preferences…", Some("CmdOrCtrl+,")),
    ("sync", "Sync", None),
    (
        "switch_profile",
        "Switch Profile…",
        Some("CmdOrCtrl+Shift+P"),
    ),
    ("import", "Import…", Some("CmdOrCtrl+Shift+I")),
    ("export", "Export…", Some("CmdOrCtrl+E")),
    ("undo", "Undo", None),
    ("redo", "Redo", None),
    ("decks", "Decks", None),
    ("add", "Add", None),
    ("browse", "Browse", None),
    ("stats", "Statistics", None),
    ("study_deck", "Study Deck…", Some("/")),
    ("create_filtered_deck", "Create Filtered Deck…", None),
    (
        "note_types",
        "Manage Note Types…",
        Some("CmdOrCtrl+Shift+N"),
    ),
    ("check_database", "Check Database", None),
    ("check_media", "Check Media…", None),
    ("empty_cards", "Empty Cards…", None),
    ("create_backup", "Create Backup", None),
    ("guide", "Guide…", Some("F1")),
    ("support", "Support Anki…", None),
];

fn item<R: Runtime>(app: &AppHandle<R>, id: &str) -> tauri::Result<MenuItem<R>> {
    let (_, label, accelerator) = ITEMS
        .iter()
        .find(|(item_id, ..)| *item_id == id)
        .unwrap_or_else(|| panic!("unknown menu item {id}"));
    MenuItem::with_id(app, id, label, true, *accelerator)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadata {
        name: Some("Anki".into()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        "Anki",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Anki"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "preferences")?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item(app, "switch_profile")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "import")?,
            &item(app, "export")?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &item(app, "undo")?,
            &item(app, "redo")?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let go = Submenu::with_items(
        app,
        "Go",
        true,
        &[
            &item(app, "decks")?,
            &item(app, "add")?,
            &item(app, "browse")?,
            &item(app, "stats")?,
            &item(app, "sync")?,
        ],
    )?;
    let tools = Submenu::with_items(
        app,
        "Tools",
        true,
        &[
            &item(app, "study_deck")?,
            &item(app, "create_filtered_deck")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "note_types")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "check_database")?,
            &item(app, "check_media")?,
            &item(app, "empty_cards")?,
            &item(app, "create_backup")?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&item(app, "guide")?, &item(app, "support")?],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &go, &tools, &window, &help])
}

/// Forward a menu choice to the shell.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().0.clone();
    if !ITEMS.iter().any(|(item_id, ..)| *item_id == id) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let js = format!(
            "window.__ankiMenu && window.__ankiMenu({})",
            serde_json::to_string(&id).expect("json")
        );
        if let Err(err) = window.eval(&js) {
            eprintln!("menu {id}: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_are_unique_and_never_single_letters() {
        let mut ids: Vec<&str> = ITEMS.iter().map(|(id, ..)| *id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), ITEMS.len());
        for (_, _, accelerator) in ITEMS {
            if let Some(accel) = accelerator {
                assert!(
                    accel.contains('+') || accel.len() > 1 || *accel == "/",
                    "{accel} would swallow typing"
                );
            }
        }
    }
}
