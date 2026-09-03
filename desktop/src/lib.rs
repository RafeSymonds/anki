// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// Anki desktop shell: one Tauri window over rslib and the Svelte pages in ts/.
//
// The web view loads everything through the custom `anki://` scheme (see
// scheme.rs). Backend calls go straight to rslib in-process (see rpc.rs).
// The collection is opened before the window appears (see profile.rs).
// Native actions the shell needs live in desktop_api.rs. With `--serve`,
// the same routes are exposed over loopback HTTP instead of a window, for
// browsers and end-to-end tests (see http.rs).

pub mod backup;
pub mod demo;
pub mod desktop_api;
pub mod http;
pub mod menu;
pub mod profile;
pub mod recording;
pub mod rpc;
pub mod scheme;
pub mod settings;
pub mod sync;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::RwLock;
use std::thread::ThreadId;

use anki::backend::Backend;
use anki_i18n::I18n;
use anki_proto::decks::DeckTreeNode;
use anki_proto::decks::DeckTreeRequest;
pub use scheme::WebRoot;
pub use settings::Settings;
use tauri::AppHandle;
use tauri::RunEvent;
use tauri::TitleBarStyle;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;
use tauri::WindowEvent;

/// Shared state available to every request handler.
pub struct AppState {
    /// The rslib backend. One per process, the same way pylib holds one.
    pub backend: Backend,
    pub web: WebRoot,
    /// Shell settings for the open profile; swapped when switching profiles.
    settings: RwLock<Settings>,
    /// The data folder holding the profiles.
    base_dir: PathBuf,
    /// Media folder of the open collection, if any.
    media_dir: Mutex<Option<PathBuf>>,
    /// Folder of the open profile; needed to reopen its collection (sync.rs).
    profile_dir: Mutex<Option<PathBuf>>,
    /// Set once the Tauri app exists; absent in `--serve` mode.
    app: Mutex<Option<AppHandle>>,
    /// Native dialogs must run here.
    main_thread: ThreadId,
    /// Set once the shell has finished its before-quit work; the next close
    /// request is then allowed through.
    quitting: AtomicBool,
    /// True under `--serve`: test-only commands such as seeding are allowed.
    serve_mode: AtomicBool,
}

impl AppState {
    pub fn new(backend: Backend, web: WebRoot, settings: Settings, base_dir: PathBuf) -> Self {
        Self {
            backend,
            web,
            settings: RwLock::new(settings),
            base_dir,
            media_dir: Mutex::new(None),
            profile_dir: Mutex::new(None),
            app: Mutex::new(None),
            main_thread: std::thread::current().id(),
            quitting: AtomicBool::new(false),
            serve_mode: AtomicBool::new(false),
        }
    }

    pub fn in_serve_mode(&self) -> bool {
        self.serve_mode.load(Ordering::SeqCst)
    }

    pub fn set_serve_mode(&self) {
        self.serve_mode.store(true, Ordering::SeqCst);
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    /// Called by the shell when it is done (sync on quit finished): exits the
    /// app, which runs the backup and closes the collection.
    pub fn quit(&self) {
        self.quitting.store(true, Ordering::SeqCst);
        if let Some(app) = self.app_handle() {
            app.exit(0);
        }
    }

    pub fn base_dir(&self) -> &std::path::Path {
        &self.base_dir
    }

    pub fn settings_get(&self, scope: settings::Scope, key: &str) -> serde_json::Value {
        self.settings.read().expect("settings lock").get(scope, key)
    }

    pub fn settings_set(
        &self,
        scope: settings::Scope,
        key: &str,
        value: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.settings
            .read()
            .expect("settings lock")
            .set(scope, key, value)
    }

    /// Point the settings at another profile folder (after switching).
    pub fn replace_settings(&self, settings: Settings) {
        *self.settings.write().expect("settings lock") = settings;
    }

    pub fn app_handle(&self) -> Option<AppHandle> {
        self.app.lock().expect("app lock").clone()
    }

    pub fn set_app_handle(&self, app: AppHandle) {
        *self.app.lock().expect("app lock") = Some(app);
    }

    pub fn on_main_thread(&self) -> bool {
        std::thread::current().id() == self.main_thread
    }

    pub fn media_dir(&self) -> Option<PathBuf> {
        self.media_dir.lock().expect("media dir lock").clone()
    }

    pub fn set_media_dir(&self, dir: Option<PathBuf>) {
        *self.media_dir.lock().expect("media dir lock") = dir;
    }

    pub fn profile_dir(&self) -> Option<PathBuf> {
        self.profile_dir.lock().expect("profile dir lock").clone()
    }

    pub fn set_profile_dir(&self, dir: Option<PathBuf>) {
        *self.profile_dir.lock().expect("profile dir lock") = dir;
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
pub fn open_state(options: &Options, web: WebRoot) -> AppState {
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

    let settings = Settings::load(&profile_dir);
    let state = AppState::new(backend, web, settings, base.clone());
    state.set_media_dir(Some(
        profile::CollectionPaths::in_profile(&profile_dir).media_folder,
    ));
    state.set_profile_dir(Some(profile_dir));
    state
}

pub fn run(options: Options) {
    match options.serve {
        Some(port) => {
            let state = open_state(&options, WebRoot::locate(None));
            state.set_serve_mode();
            eprintln!("serving web assets from {}", state.web.web.display());
            http::serve(Arc::new(state), port).expect("http server");
        }
        None => run_window(options),
    }
}

fn run_window(options: Options) {
    use tauri::Manager;

    let app = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("anki", scheme::handle_async)
        .setup(move |app| {
            // The bundle's resource folder is only resolvable once the app
            // exists, so the collection is opened here, before the window.
            let resource_dir = app.path().resource_dir().ok();
            let state = open_state(&options, WebRoot::locate(resource_dir));
            eprintln!("serving web assets from {}", state.web.web.display());
            state.set_app_handle(app.handle().clone());
            app.manage(state);

            // ANKI_NO_MENU=1 skips the menu bar, a debugging aid.
            if std::env::var_os("ANKI_NO_MENU").is_none() {
                match menu::build(app.handle()) {
                    Ok(menu) => {
                        app.set_menu(menu)?;
                        app.on_menu_event(menu::on_event);
                    }
                    Err(err) => eprintln!("menu: {err}"),
                }
            }

            let url = format!("anki://localhost{}", start_route());
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::CustomProtocol(url.parse()?),
            )
            .title("Anki")
            .inner_size(1180.0, 780.0)
            .min_inner_size(760.0, 500.0)
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true)
            .build()?;
            eprintln!("main window created");

            // Closing the window first lets the shell finish (sync on quit),
            // which then posts /_desktop/quit; that exits for real.
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let state = handle.state::<AppState>();
                    if !state.is_quitting() {
                        api.prevent_close();
                        if let Some(main) = handle.get_webview_window("main") {
                            let _ = main.eval(
                                "window.__ankiBeforeQuit ? window.__ankiBeforeQuit() : fetch('/_desktop/quit', { method: 'POST' })",
                            );
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Anki");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            let state = tauri::Manager::state::<AppState>(app);
            match backup::create_backup(&state, false) {
                Ok(true) => eprintln!("backup created"),
                Ok(false) => {}
                Err(err) => eprintln!("backup: {err:#}"),
            }
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
