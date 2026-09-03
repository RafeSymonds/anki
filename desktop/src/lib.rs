// Anki desktop shell: one Tauri window over rslib and the Svelte pages in ts/.
//
// The web view loads everything through the custom `anki://` scheme (see
// scheme.rs). Backend calls go straight to rslib in-process (see rpc.rs).
// The collection is opened before the window appears (see profile.rs).

pub mod profile;
pub mod rpc;
pub mod scheme;

use anki::backend::Backend;
use anki_i18n::I18n;
use tauri::RunEvent;
use tauri::TitleBarStyle;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

pub use scheme::WebRoot;

/// Shared state available to every request handler.
pub struct AppState {
    /// The rslib backend. One per process, the same way pylib holds one.
    pub backend: Backend,
    pub web: WebRoot,
}

/// Route the main window opens at. `ANKI_START_ROUTE` overrides it during
/// development so an individual page can be checked in isolation.
fn start_route() -> String {
    std::env::var("ANKI_START_ROUTE").unwrap_or_else(|_| "/".into())
}

/// Until the app shell owns it, `bridgeCommand` just reports what it got.
const BRIDGE_STUB: &str = r#"
window.bridgeCommand = function (command, callback) {
    console.warn("bridgeCommand not handled yet:", command);
    if (callback) { callback(null); }
};
"#;

pub fn new_backend() -> Backend {
    Backend::new(I18n::new(&["en"]), false)
}

pub fn run() {
    let backend = new_backend();
    let base = profile::base_dir();
    let profile_dir = profile::default_profile_dir(&base);
    profile::open_collection(&backend, &profile_dir).unwrap_or_else(|err| {
        panic!("could not open collection in {}: {err:#}", profile_dir.display())
    });
    eprintln!("opened collection in {}", profile_dir.display());

    let state = AppState {
        backend,
        web: WebRoot::from_repo(),
    };

    let app = tauri::Builder::default()
        .manage(state)
        .register_uri_scheme_protocol("anki", scheme::handle)
        .setup(|app| {
            let url = format!("anki://localhost{}", start_route());
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url.parse()?))
                .title("Anki")
                .inner_size(1100.0, 760.0)
                .min_inner_size(720.0, 480.0)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .initialization_script(BRIDGE_STUB)
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
