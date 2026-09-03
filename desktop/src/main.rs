// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Anki desktop shell (Tauri). See desktop/src/lib.rs.
//
//   anki-desktop                       open the window
//   anki-desktop --serve PORT          serve over loopback HTTP, no window
//   anki-desktop --base DIR            data folder (default: ANKI_BASE or
// ~/Library/...)   anki-desktop --seed N              add N demo notes if the
// collection is empty

fn main() {
    let options = anki_desktop::Options::from_args(std::env::args().skip(1));
    anki_desktop::run(options)
}
