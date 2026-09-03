// Anki desktop shell: one Tauri window over rslib and the Svelte pages in ts/.
//
// The web view loads everything through the custom `anki://` scheme (see
// scheme.rs). Backend calls go straight to rslib in-process (see rpc.rs).
// The collection is opened before the window appears (see profile.rs).
// Native actions the shell needs live in desktop_api.rs. With `--serve`,
// the same routes are exposed over loopback HTTP instead of a window, for
// browsers and end-to-end tests (see http.rs).

pub mod demo;
pub mod desktop_api;
pub mod http;
pub mod profile;
pub mod rpc;
pub mod scheme;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;

use anki::backend::Backend;
use anki_i18n::I18n;
use anki_proto::decks::DeckTreeNode;
use anki_proto::decks::DeckTreeRequest;
pub use scheme::WebRoot;
use tauri::RunEvent;
use tauri::TitleBarStyle;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

/// Shared state available to every request handler.
pub struct AppState {
    /// The rslib backend. One per process, the same way pylib holds one.
    pub backend: Backend,
    pub web: WebRoot,
    /// Media folder of the open collection, if any.
    media_dir: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new(backend: Backend, web: WebRoot) -> Self {
        Self {
            backend,
            web,
            media_dir: Mutex::new(None),
        }
    }

    pub fn media_dir(&self) -> Option<PathBuf> {
        self.media_dir.lock().expect("media dir lock").clone()
    }

    pub fn set_media_dir(&self, dir: Option<PathBuf>) {
        *self.media_dir.lock().expect("media dir lock") = dir;
    }
}

/// Command line options.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Options {
    /// Serve over HTTP on this loopback port instead of opening a window.
    pub serve: Option<u16>,
    /// Data folder holding the profiles; overrides `ANKI_BASE`.
    pub base: Option<PathBuf>,
    /// Add this many demo notes if the collection is empty.
    pub seed: Option<usize>,
}

impl Options {
    pub fn from_args(args: impl Iterator<Item = String>) -> Self {
        let mut options = Options::default();
        let mut args = args.peekable();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--serve" => options.serve = args.next().and_then(|p| p.parse().ok()),
                "--base" => options.base = args.next().map(PathBuf::from),
                "--seed" => options.seed = args.next().and_then(|n| n.parse().ok()),
                _ => eprintln!("ignoring argument {arg}"),
            }
        }
        options
    }
}

/// Route the main window opens at. `ANKI_START_ROUTE` overrides it during
/// development so an individual page can be checked in isolation.
fn start_route() -> String {
    std::env::var("ANKI_START_ROUTE").unwrap_or_else(|_| "/".into())
}

pub fn new_backend() -> Backend {
    Backend::new(I18n::new(&["en"]), false)
}

fn collection_is_empty(backend: &Backend) -> bool {
    rpc::call_typed::<_, DeckTreeNode>(backend, "deckTree", &DeckTreeRequest { now: 0 })
        .map(|tree| tree.total_including_children == 0)
        .unwrap_or(false)
}

/// Open the default profile's collection and build the shared state.
pub fn open_state(options: &Options) -> AppState {
    let backend = new_backend();
    let base = options.base.clone().unwrap_or_else(profile::base_dir);
    let profile_dir = profile::default_profile_dir(&base);
    profile::open_collection(&backend, &profile_dir).unwrap_or_else(|err| {
        panic!(
            "could not open collection in {}: {err:#}",
            profile_dir.display()
        )
    });
    eprintln!("opened collection in {}", profile_dir.display());

    if let Some(count) = options.seed {
        if collection_is_empty(&backend) {
            demo::seed(&backend, count).expect("seed demo notes");
            eprintln!("added {count} demo notes");
        }
    }

    let state = AppState::new(backend, WebRoot::from_repo());
    state.set_media_dir(Some(
        profile::CollectionPaths::in_profile(&profile_dir).media_folder,
    ));
    state
}

pub fn run(options: Options) {
    let state = open_state(&options);
    match options.serve {
        Some(port) => {
            http::serve(Arc::new(state), port).expect("http server");
        }
        None => run_window(state),
    }
}

fn run_window(state: AppState) {
    let app = tauri::Builder::default()
        .manage(state)
        .register_uri_scheme_protocol("anki", scheme::handle)
        .setup(|app| {
            let url = format!("anki://localhost{}", start_route());
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url.parse()?))
                .title("Anki")
                .inner_size(1180.0, 780.0)
                .min_inner_size(760.0, 500.0)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Anki");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            let state = tauri::Manager::state::<AppState>(app);
            if let Err(err) = profile::close_collection(&state.backend) {
                eprintln!("close collection: {err:#}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_options() {
        let args = ["--serve", "4010", "--base", "/tmp/x", "--seed", "12"].map(String::from);
        assert_eq!(
            Options::from_args(args.into_iter()),
            Options {
                serve: Some(4010),
                base: Some(PathBuf::from("/tmp/x")),
                seed: Some(12),
            }
        );
        assert_eq!(Options::from_args(std::iter::empty()), Options::default());
    }
}
