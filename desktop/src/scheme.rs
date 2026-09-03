// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The `anki://` scheme: everything the web view loads goes through here.
//!
//! `/_anki/{method}` POSTs are backend RPCs. Paths under `/_anki/` and
//! `/_app/` are files from the web build. Known SvelteKit routes get the
//! SvelteKit shell. Anything else at the root is a file from the open
//! collection's media folder, which is how card templates reference their
//! images and sounds. This mirrors qt/aqt/mediasrv.py.

use std::borrow::Cow;
use std::path::Path;
use std::path::PathBuf;

use tauri::http::header;
use tauri::http::HeaderValue;
use tauri::http::Method;
use tauri::http::Request;
use tauri::http::Response;
use tauri::http::StatusCode;
use tauri::Manager;
use tauri::UriSchemeContext;

use crate::desktop_api;
use crate::rpc;
use crate::AppState;

/// The shim every document loads first; see `init_script`.
pub const INIT_SCRIPT_PATH: &str = "/_desktop/init.js";

/// The document cards are rendered in. See web/card.html.
pub const CARD_FRAME_PATH: &str = "/_desktop/card.html";
const CARD_FRAME_HTML: &str = include_str!("../web/card.html");

/// Response header naming a failed RPC's backend error kind (rpc.rs).
pub const ERROR_KIND_HEADER: &str = "anki-error-kind";

/// Top-level SvelteKit routes. Same list as `get_sveltekit_route` in
/// mediasrv.py; any other root path is a media file.
pub const SVELTEKIT_ROUTES: &[&str] = &[
    "graphs",
    "congrats",
    "card-info",
    "change-notetype",
    "deck-options",
    "import-anki-package",
    "import-csv",
    "import-page",
    "image-occlusion",
    "preferences",
    "editor",
];

/// Where the built web assets live: the tree the Qt app serves from
/// qt/aqt/data/web, assembled by `just web` into out/qt/_aqt/data/web.
#[derive(Debug, Clone)]
pub struct WebRoot {
    pub web: PathBuf,
}

impl WebRoot {
    /// Development layout, resolved relative to the repo root at compile time.
    pub fn from_repo() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("desktop/ sits inside the repo");
        Self {
            web: root.join("out/qt/_aqt/data/web"),
        }
    }

    fn sveltekit(&self) -> PathBuf {
        self.web.join("sveltekit")
    }

    /// Where to serve from, in order: `ANKI_WEB_ROOT`, the repo's build
    /// output when it exists (development), else the bundled resources
    /// (`bundle.resources` in tauri.conf.json copies the web tree to
    /// `<resources>/web`).
    pub fn locate(resource_dir: Option<PathBuf>) -> Self {
        if let Ok(dir) = std::env::var("ANKI_WEB_ROOT") {
            if !dir.is_empty() {
                return Self {
                    web: PathBuf::from(dir),
                };
            }
        }
        let repo = Self::from_repo();
        if repo.web.join("sveltekit/index.html").exists() {
            return repo;
        }
        let resource_dir = resource_dir.or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| bundle_resource_dir(&exe))
        });
        if let Some(dir) = resource_dir {
            let bundled = dir.join("web");
            if bundled.join("sveltekit/index.html").exists() {
                return Self { web: bundled };
            }
        }
        repo
    }
}

/// `Anki.app/Contents/MacOS/anki-desktop` -> `Anki.app/Contents/Resources`,
/// so `--serve` inside the bundle finds its resources without a Tauri app.
pub fn bundle_resource_dir(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    if macos.file_name()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    Some(contents.join("Resources"))
}

/// What a request resolves to, before any I/O happens.
#[derive(Debug, PartialEq, Eq)]
pub enum Route {
    /// Backend RPC by camelCase method name.
    Rpc(String),
    /// A FrontendService method; the shell handles these in JS, so reaching
    /// Rust means the shim was bypassed.
    FrontendRpc(String),
    /// A shell-only native action, e.g. opening a link.
    Desktop(String),
    /// A file from the web build.
    File(PathBuf),
    /// The SvelteKit shell; the client-side router takes it from there.
    Index,
    /// A file from the collection's media folder (already percent-decoded).
    Media(String),
    /// The card document.
    CardFrame,
    /// GET /_anki/readyz: 200 once the collection is open, like mediasrv.
    Ready,
    /// GET /_desktop/init.js: the bridge/fetch shim.
    InitScript,
}

/// Mirrors `_extract_internal_request` and the media fallback in mediasrv.py.
pub fn resolve(web: &WebRoot, method: &Method, path: &str) -> Route {
    if path == CARD_FRAME_PATH {
        return Route::CardFrame;
    }
    if path == INIT_SCRIPT_PATH {
        return Route::InitScript;
    }
    if path == "/_anki/readyz" {
        return Route::Ready;
    }
    if let Some(cmd) = path.strip_prefix("/_desktop/") {
        if *method == Method::POST {
            return Route::Desktop(cmd.to_string());
        }
    }
    if let Some(rest) = path.strip_prefix("/_anki/") {
        if *method == Method::POST && !rest.is_empty() && !rest.contains('/') {
            if rpc::is_frontend_method(rest) {
                return Route::FrontendRpc(rest.to_string());
            }
            return Route::Rpc(rest.to_string());
        }
        if let Some(sk) = rest.strip_prefix("sveltekit/") {
            // Hashed assets are real files; anything else is the shell.
            if sk.contains("immutable") {
                return Route::File(web.sveltekit().join(sk));
            }
            return Route::Index;
        }
        return Route::File(web.web.join(rest));
    }
    if let Some(rest) = path.strip_prefix("/_app/") {
        return Route::File(web.sveltekit().join("_app").join(rest));
    }
    let trimmed = path.trim_start_matches('/');
    if trimmed.is_empty() {
        return Route::Index;
    }
    let first = trimmed.split('/').next().unwrap_or("");
    if SVELTEKIT_ROUTES.contains(&first) {
        return Route::Index;
    }
    Route::Media(percent_decode(trimmed))
}

/// Decode `%XX` escapes; invalid sequences are kept verbatim.
pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &input[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A media path is a plain relative path with no traversal.
pub fn safe_media_path(name: &str) -> bool {
    !name.is_empty() && !Path::new(name).is_absolute() && !name.split('/').any(|part| part == "..")
}

pub type Reply = Response<Cow<'static, [u8]>>;

/// Tauri entry point for the `anki://` scheme (synchronous form).
pub fn handle<R: tauri::Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>) -> Reply {
    let state = ctx.app_handle().state::<AppState>();
    let path = req.uri().path().to_string();
    dispatch(&state, req.method(), &path, req.body())
}

/// Asynchronous entry point: every request runs on its own thread, so a
/// long backend call (a sync, a database check) never blocks the main
/// thread that WKWebView paints and dispatches events on. Native dialogs
/// still hop to the main thread through the app handle.
pub fn handle_async<R: tauri::Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let path = req.uri().path().to_string();
        let reply = dispatch(&state, req.method(), &path, req.body());
        responder.respond(reply);
    });
}

/// Answer one request. Shared by the scheme handler and the HTTP server.
pub fn dispatch(state: &AppState, method: &Method, path: &str, body: &[u8]) -> Reply {
    let reply = dispatch_inner(state, method, path, body);
    // ANKI_DEBUG_REQUESTS=1 logs every request; a debugging aid for the window.
    if std::env::var_os("ANKI_DEBUG_REQUESTS").is_some() {
        eprintln!("{} {} -> {}", method, path, reply.status());
    }
    reply
}

fn dispatch_inner(state: &AppState, method: &Method, path: &str, body: &[u8]) -> Reply {
    match resolve(&state.web, method, path) {
        Route::Rpc(name) => run_rpc(state, &name, body),
        Route::FrontendRpc(name) => text(
            StatusCode::NOT_IMPLEMENTED,
            format!("frontend method '{name}' must be handled by the app shell"),
        ),
        Route::Desktop(cmd) => desktop_api::handle(state, &cmd, body),
        Route::File(file) => serve_file(&file),
        Route::Index => serve_index(state),
        Route::Media(name) => serve_media(state, &name),
        Route::CardFrame => html(inject_init_script(CARD_FRAME_HTML)),
        Route::Ready => {
            if state.media_dir().is_some() {
                text(StatusCode::OK, "ok".into())
            } else {
                text(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "collection not open".into(),
                )
            }
        }
        Route::InitScript => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/javascript")
            .body(Cow::Owned(init_script().into_bytes()))
            .expect("init script response"),
    }
}

fn serve_index(state: &AppState) -> Reply {
    match std::fs::read_to_string(state.web.sveltekit().join("index.html")) {
        Ok(page) => html(inject_init_script(&page)),
        Err(_) => text(
            StatusCode::NOT_FOUND,
            "web build missing: run `just web`".into(),
        ),
    }
}

/// The stylesheet the Qt webview injected into every page
/// (`AnkiWebView.standard_css`): the platform font, so pages that never set
/// one do not fall back to a serif face.
pub const STANDARD_CSS: &str =
    r#"html { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; }"#;

/// Add the shim as the first script of a document so it runs before any
/// page code, plus the standard stylesheet. The SvelteKit page's CSP allows
/// same-origin scripts and inline styles.
pub fn inject_init_script(page: &str) -> String {
    let tag = format!("<script src=\"{INIT_SCRIPT_PATH}\"></script><style>{STANDARD_CSS}</style>");
    match page.find("<head>") {
        Some(idx) => {
            let at = idx + "<head>".len();
            format!("{}{}{}", &page[..at], tag, &page[at..])
        }
        None => format!("{tag}{page}"),
    }
}

/// Runs in every frame before any page script.
///
/// Two jobs. First, `bridgeCommand` / `pycmd`: the Qt app injects these
/// through QWebChannel; here calls are queued until the shell installs a
/// handler on the frame. Second, FrontendService calls: the web code posts
/// them to `/_anki/{method}` expecting Python to answer. The shell answers
/// instead, so `fetch` for those names is redirected to the top window's
/// `__ankiFrontendService(method, bytes, frame)`.
pub fn init_script() -> String {
    let frontend_methods = serde_json::to_string(rpc::FRONTEND_METHODS).expect("json");
    format!(
        r#"(function () {{
    if (window.__ankiShim) {{ return; }}
    window.__ankiShim = true;
    const FRONTEND = new Set({frontend_methods});
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {{
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const m = /^(?:[a-z]+:\/\/[^/]+)?\/_anki\/([A-Za-z0-9]+)$/.exec(url);
        const method = (init && init.method) || (input && input.method) || "GET";
        if (m && FRONTEND.has(m[1]) && method.toUpperCase() === "POST") {{
            const service = window.top && window.top.__ankiFrontendService;
            if (!service) {{
                return new Response("frontend service not ready", {{ status: 503 }});
            }}
            try {{
                const raw = init && init.body;
                const body = raw instanceof Uint8Array
                    ? raw
                    : new Uint8Array(await new Response(raw || new Uint8Array()).arrayBuffer());
                const out = await service(m[1], body, window);
                return new Response(out, {{ status: 200, headers: {{ "Content-Type": "application/binary" }} }});
            }} catch (err) {{
                return new Response(String((err && err.message) || err), {{ status: 500 }});
            }}
        }}
        const response = await origFetch(input, init);
        // Let the shell know a backend operation ran, like Qt's
        // operation_did_execute hook; used to refresh other views.
        if (m && method.toUpperCase() === "POST" && response.ok) {{
            const done = window.top && window.top.__ankiRpcDone;
            if (done) {{ try {{ done(m[1], window); }} catch (_) {{}} }}
        }}
        return response;
    }};
    window.bridgeCommand = function (command, callback) {{
        const handler = window.__ankiBridgeHandler;
        if (handler) {{ return handler(command, callback); }}
        (window.__ankiBridgeQueue = window.__ankiBridgeQueue || []).push([command, callback]);
    }};
    window.pycmd = window.bridgeCommand;
}})();"#
    )
}

fn html(page: String) -> Reply {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Cow::Owned(page.into_bytes()))
        .expect("html response")
}

fn run_rpc(state: &AppState, name: &str, body: &[u8]) -> Reply {
    match rpc::call(&state.backend, name, body) {
        Ok(bytes) => binary(bytes),
        // mediasrv.py's get_config_json answers a missing key with null
        // rather than an error; pages probe optional keys this way.
        Err(err) if name == "getConfigJson" && err.is_not_found() => binary(rpc::json_null()),
        Err(err) if err.is_unknown_method() => text(StatusCode::NOT_FOUND, err.message()),
        Err(err) => {
            let mut reply = text(StatusCode::INTERNAL_SERVER_ERROR, err.message());
            if let Some(kind) = err.kind_name() {
                reply
                    .headers_mut()
                    .insert(ERROR_KIND_HEADER, HeaderValue::from_static(kind));
            }
            reply
        }
    }
}

fn binary(bytes: Vec<u8>) -> Reply {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/binary")
        .body(Cow::Owned(bytes))
        .expect("rpc response")
}

fn serve_media(state: &AppState, name: &str) -> Reply {
    if !safe_media_path(name) {
        return text(
            StatusCode::BAD_REQUEST,
            format!("invalid media path: {name}"),
        );
    }
    match state.media_dir() {
        Some(dir) => serve_file(&dir.join(name)),
        None => text(StatusCode::NOT_FOUND, "no collection open".into()),
    }
}

pub fn serve_file(file: &Path) -> Reply {
    match std::fs::read(file) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime_for(file))
            .body(Cow::Owned(bytes))
            .expect("static response"),
        Err(_) => text(
            StatusCode::NOT_FOUND,
            format!("not found: {}", file.display()),
        ),
    }
}

pub fn text(status: StatusCode, body: String) -> Reply {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Cow::Owned(body.into_bytes()))
        .expect("text response")
}

pub fn mime_for(file: &Path) -> &'static str {
    match file
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
        .unwrap_or("")
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn web() -> WebRoot {
        WebRoot {
            web: PathBuf::from("/w"),
        }
    }

    #[test]
    fn posts_to_bare_anki_names_are_rpcs() {
        assert_eq!(
            resolve(&web(), &Method::POST, "/_anki/congratsInfo"),
            Route::Rpc("congratsInfo".into())
        );
        // Frontend-service methods are recognised so the shell can be blamed.
        assert_eq!(
            resolve(&web(), &Method::POST, "/_anki/deckOptionsRequireClose"),
            Route::FrontendRpc("deckOptionsRequireClose".into())
        );
        // A GET to the same path is a file lookup, like mediasrv.
        assert_eq!(
            resolve(&web(), &Method::GET, "/_anki/congratsInfo"),
            Route::File("/w/congratsInfo".into())
        );
        // Nested paths are never RPCs.
        assert_eq!(
            resolve(&web(), &Method::POST, "/_anki/js/reviewer.js"),
            Route::File("/w/js/reviewer.js".into())
        );
    }

    #[test]
    fn sveltekit_assets_and_routes() {
        assert_eq!(
            resolve(&web(), &Method::GET, "/_app/immutable/entry/start.js"),
            Route::File("/w/sveltekit/_app/immutable/entry/start.js".into())
        );
        assert_eq!(
            resolve(
                &web(),
                &Method::GET,
                "/_anki/sveltekit/_app/immutable/x.css"
            ),
            Route::File("/w/sveltekit/_app/immutable/x.css".into())
        );
        assert_eq!(
            resolve(&web(), &Method::GET, "/_anki/sveltekit/congrats"),
            Route::Index
        );
        assert_eq!(resolve(&web(), &Method::GET, "/congrats"), Route::Index);
        assert_eq!(
            resolve(&web(), &Method::GET, "/deck-options/1"),
            Route::Index
        );
        assert_eq!(resolve(&web(), &Method::GET, "/"), Route::Index);
    }

    #[test]
    fn root_files_are_media_and_the_card_frame_is_special() {
        assert_eq!(
            resolve(&web(), &Method::GET, "/paste-abc.jpg"),
            Route::Media("paste-abc.jpg".into())
        );
        assert_eq!(
            resolve(&web(), &Method::GET, "/my%20sound.mp3"),
            Route::Media("my sound.mp3".into())
        );
        assert_eq!(
            resolve(&web(), &Method::GET, CARD_FRAME_PATH),
            Route::CardFrame
        );
        assert_eq!(
            resolve(&web(), &Method::POST, "/_desktop/openLink"),
            Route::Desktop("openLink".into())
        );
        assert_eq!(resolve(&web(), &Method::GET, "/_anki/readyz"), Route::Ready);
        assert_eq!(
            resolve(&web(), &Method::GET, INIT_SCRIPT_PATH),
            Route::InitScript
        );
    }

    #[test]
    fn init_script_is_injected_first_in_head() {
        let page = inject_init_script(
            "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
        );
        assert!(page.starts_with(
            "<!doctype html><html><head><script src=\"/_desktop/init.js\"></script><style>"
        ));
        assert!(page.contains("font-family"));
        assert!(page.contains("</style><meta"));
        assert!(inject_init_script("<p>no head</p>")
            .starts_with("<script src=\"/_desktop/init.js\"></script>"));
    }

    #[test]
    fn init_script_embeds_frontend_methods_and_bridge() {
        let script = init_script();
        assert!(script.contains("\"deckOptionsRequireClose\""));
        assert!(script.contains("\"getSchedulingStatesWithContext\""));
        assert!(script.contains("window.bridgeCommand = function"));
        assert!(script.contains("__ankiFrontendService"));
        assert!(script.contains("__ankiRpcDone"));
    }

    #[test]
    fn media_paths_cannot_escape_the_folder() {
        assert!(safe_media_path("a.png"));
        assert!(safe_media_path("sub/a.png"));
        assert!(!safe_media_path("../collection.anki2"));
        assert!(!safe_media_path("a/../../x"));
        assert!(!safe_media_path("/etc/passwd"));
        assert!(!safe_media_path(""));
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("a%20b.png"), "a b.png");
        assert_eq!(percent_decode("100%.png"), "100%.png");
        assert_eq!(percent_decode("%E2%9C%93.png"), "✓.png");
        assert_eq!(percent_decode("plain"), "plain");
    }

    #[test]
    fn resource_dir_from_bundle_layout() {
        assert_eq!(
            bundle_resource_dir(Path::new(
                "/Applications/Anki.app/Contents/MacOS/anki-desktop"
            )),
            Some(PathBuf::from("/Applications/Anki.app/Contents/Resources"))
        );
        assert_eq!(
            bundle_resource_dir(Path::new("/repo/target/debug/anki-desktop")),
            None
        );
    }

    #[test]
    fn mime_types() {
        assert_eq!(mime_for(Path::new("a/b.js")), "text/javascript");
        assert_eq!(mime_for(Path::new("a/b.woff2")), "font/woff2");
        assert_eq!(mime_for(Path::new("a/b.JPG")), "image/jpeg");
        assert_eq!(mime_for(Path::new("a/b")), "application/octet-stream");
    }
}
