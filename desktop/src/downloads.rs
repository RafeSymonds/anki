// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Deck files waiting in the user's Downloads folder. Shared decks arrive as
//! an .apkg download from AnkiWeb, and the step people get stuck on is going
//! back to the app and finding the file again. The Get Shared Decks screen
//! lists what is already downloaded so importing is one click.

use std::path::Path;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Deck packages only; a collection package replaces the whole collection and
/// is offered through Import File instead.
const EXTENSIONS: [&str; 2] = ["apkg", "colpkg"];

/// How many to show. The list is a shortcut, not a file browser.
const MAX_FILES: usize = 12;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct DeckFile {
    /// File name, e.g. "Japanese Core 2000.apkg".
    pub name: String,
    pub path: String,
    pub size: u64,
    /// Seconds since the epoch, for "2 hours ago" in the UI.
    pub modified: u64,
}

/// Tests and the e2e harness point the search at a folder of their own, so a
/// run never reads the real Downloads folder.
pub const DIR_OVERRIDE_VAR: &str = "ANKI_DOWNLOADS_DIR";

/// The folders worth looking in: Downloads first, then the desktop, which is
/// where Safari puts files for people who changed that setting.
pub fn search_dirs() -> Vec<PathBuf> {
    if let Some(dir) = std::env::var_os(DIR_OVERRIDE_VAR) {
        return vec![PathBuf::from(dir)];
    }
    let mut dirs = Vec::new();
    if let Some(dir) = dirs::download_dir() {
        dirs.push(dir);
    }
    if let Some(dir) = dirs::desktop_dir() {
        dirs.push(dir);
    }
    dirs
}

/// Deck files directly inside `dir`, newest first. A folder that is missing
/// or unreadable contributes nothing.
pub fn deck_files_in(dir: &Path) -> Vec<DeckFile> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<DeckFile> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(str::to_lowercase)?;
            if !EXTENSIONS.contains(&extension.as_str()) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some(DeckFile {
                name: path.file_name()?.to_str()?.to_string(),
                path: path.to_str()?.to_string(),
                size: metadata.len(),
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|since| since.as_secs())
                    .unwrap_or(0),
            })
        })
        .collect();
    sort_newest_first(&mut files);
    files
}

fn sort_newest_first(files: &mut [DeckFile]) {
    files.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.name.cmp(&b.name))
    });
}

/// What the Get Shared Decks screen lists, across all search folders.
pub fn downloaded_decks() -> Vec<DeckFile> {
    let mut files = Vec::new();
    for dir in search_dirs() {
        files.extend(deck_files_in(&dir));
    }
    sort_newest_first(&mut files);
    files.dedup_by(|a, b| a.path == b.path);
    files.truncate(MAX_FILES);
    files
}

/// `downloaded_decks` as the JSON the shell reads.
pub fn downloaded_decks_json() -> serde_json::Value {
    serde_json::json!({ "files": downloaded_decks() })
}

/// Tests point this at a folder of their own instead of the real Downloads.
#[cfg(test)]
pub fn touch(path: &Path, modified: std::time::SystemTime) {
    std::fs::write(path, b"x").unwrap();
    let file = std::fs::File::options().write(true).open(path).unwrap();
    file.set_modified(modified).unwrap();
}

#[cfg(test)]
mod tests {
    use std::time::Duration;
    use std::time::SystemTime;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn lists_only_deck_packages() {
        let dir = tempdir().unwrap();
        let now = SystemTime::now();
        touch(&dir.path().join("Japanese.apkg"), now);
        touch(&dir.path().join("Backup.colpkg"), now);
        touch(&dir.path().join("notes.csv"), now);
        touch(&dir.path().join("photo.png"), now);
        let names: Vec<String> = deck_files_in(dir.path())
            .into_iter()
            .map(|file| file.name)
            .collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"Japanese.apkg".to_string()));
        assert!(names.contains(&"Backup.colpkg".to_string()));
    }

    #[test]
    fn matches_the_extension_whatever_its_case() {
        let dir = tempdir().unwrap();
        touch(&dir.path().join("Spanish.APKG"), SystemTime::now());
        assert_eq!(deck_files_in(dir.path()).len(), 1);
    }

    #[test]
    fn newest_file_comes_first() {
        let dir = tempdir().unwrap();
        let now = SystemTime::now();
        touch(
            &dir.path().join("old.apkg"),
            now - Duration::from_secs(3600),
        );
        touch(&dir.path().join("new.apkg"), now);
        let files = deck_files_in(dir.path());
        assert_eq!(files[0].name, "new.apkg");
        assert_eq!(files[1].name, "old.apkg");
        assert!(files[0].size > 0);
        assert!(files[0].path.ends_with("new.apkg"));
    }

    #[test]
    fn a_missing_folder_is_empty_rather_than_an_error() {
        assert!(deck_files_in(Path::new("/nonexistent/anki/downloads")).is_empty());
    }

    #[test]
    fn the_override_replaces_the_real_folders() {
        let dir = tempdir().unwrap();
        touch(&dir.path().join("Shared.apkg"), SystemTime::now());
        // Safe: the whole suite runs single-threaded per binary for this var.
        unsafe { std::env::set_var(DIR_OVERRIDE_VAR, dir.path()) };
        let dirs = search_dirs();
        let files = downloaded_decks();
        unsafe { std::env::remove_var(DIR_OVERRIDE_VAR) };
        assert_eq!(dirs, vec![dir.path().to_path_buf()]);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "Shared.apkg");
    }

    #[test]
    fn folders_named_like_a_deck_are_skipped() {
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join("bundle.apkg")).unwrap();
        assert!(deck_files_in(dir.path()).is_empty());
    }
}
