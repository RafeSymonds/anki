// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Audio recordings made in the editor. The web side records with
//! `MediaRecorder` and posts the bytes to `/_desktop/saveRecording/{name}`;
//! the file lands in a temporary folder and the editor then adds it to the
//! collection's media with `addMediaFromPath`, exactly as it did with the
//! Qt recorder's file.

use std::path::Path;
use std::path::PathBuf;

/// Where recordings wait to be added to the media folder.
pub fn recordings_dir() -> PathBuf {
    std::env::temp_dir().join("anki-recordings")
}

/// `rec<digits>.<ext>` with a known audio extension; nothing that could
/// escape the folder.
pub fn valid_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    let digits = stem.strip_prefix("rec").unwrap_or("");
    !digits.is_empty()
        && digits.bytes().all(|b| b.is_ascii_digit())
        && matches!(ext, "m4a" | "mp4" | "webm" | "ogg" | "opus" | "wav" | "mp3")
}

/// Write `data` as `name` into the recordings folder and return its path.
pub fn save(name: &str, data: &[u8]) -> Result<PathBuf, String> {
    save_in(&recordings_dir(), name, data)
}

pub fn save_in(dir: &Path, name: &str, data: &[u8]) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("invalid recording name: {name}"));
    }
    if data.is_empty() {
        return Err("the recording is empty".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = dir.join(name);
    std::fs::write(&path, data).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_rec_number_and_audio_extension() {
        assert!(valid_name("rec1700000000.m4a"));
        assert!(valid_name("rec1.webm"));
        assert!(!valid_name("rec.m4a"));
        assert!(!valid_name("rec12.exe"));
        assert!(!valid_name("../rec12.m4a"));
        assert!(!valid_name("rec12"));
        assert!(!valid_name("song12.mp3"));
    }

    #[test]
    fn saves_bytes_under_the_name_and_rejects_bad_input() {
        let dir = tempfile::tempdir().unwrap();
        let path = save_in(dir.path(), "rec42.m4a", b"abc").unwrap();
        assert_eq!(path, dir.path().join("rec42.m4a"));
        assert_eq!(std::fs::read(&path).unwrap(), b"abc");

        assert!(save_in(dir.path(), "rec42.m4a", b"").is_err());
        assert!(save_in(dir.path(), "x/rec42.m4a", b"abc").is_err());
        assert!(!dir.path().join("x").exists());
    }
}
