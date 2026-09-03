//! Native actions the app shell asks the host for, posted to
//! `/_desktop/{command}`. These are the pieces of FrontendService that need
//! the operating system rather than rslib: opening links, file pickers,
//! clipboard, audio. Only what the shell already uses is implemented.

use tauri::http::StatusCode;

use crate::scheme::text;
use crate::scheme::Reply;

pub fn handle(cmd: &str, body: &[u8]) -> Reply {
    match cmd {
        "openLink" => {
            let url = String::from_utf8_lossy(body);
            match open_link(&url) {
                Ok(()) => text(StatusCode::OK, String::new()),
                Err(err) => text(StatusCode::BAD_REQUEST, err),
            }
        }
        _ => text(
            StatusCode::NOT_FOUND,
            format!("unknown desktop command: {cmd}"),
        ),
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
