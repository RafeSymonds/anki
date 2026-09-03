//! The `anki://` scheme: everything the web view loads goes through here.
//!
//! `/_anki/{method}` POSTs are backend RPCs. Every other path is a file from
//! the web build in out/, resolved the same way qt/aqt/mediasrv.py resolves
//! requests against qt/aqt/data/web.

use std::borrow::Cow;
use std::path::Path;
use std::path::PathBuf;

use tauri::http::header;
use tauri::http::Method;
use tauri::http::Request;
use tauri::http::Response;
use tauri::http::StatusCode;
use tauri::Manager;
use tauri::UriSchemeContext;

use crate::rpc;
use crate::AppState;

/// Where the built web assets live.
#[derive(Debug, Clone)]
pub struct WebRoot {
    /// SvelteKit build: routes such as /congrats, /deck-options, /editor.
    pub sveltekit: PathBuf,
    /// esbuild bundles: reviewer, editor, mathjax, page bundles.
    pub ts: PathBuf,
}

impl WebRoot {
    /// Development layout, resolved relative to the repo root at compile time.
    pub fn from_repo() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("desktop/ sits inside the repo");
        Self {
            sveltekit: root.join("out/sveltekit"),
            ts: root.join("out/ts"),
        }
    }
}

/// What a request resolves to, before any I/O happens.
#[derive(Debug, PartialEq, Eq)]
pub enum Route {
    /// Backend RPC by camelCase method name.
    Rpc(String),
    /// A file on disk.
    File(PathBuf),
    /// The SvelteKit shell; the client-side router takes it from there.
    Index,
}

/// Mirrors `_extract_internal_request` in qt/aqt/mediasrv.py.
pub fn resolve(web: &WebRoot, method: &Method, path: &str) -> Route {
    if let Some(rest) = path.strip_prefix("/_anki/") {
        if *method == Method::POST && !rest.is_empty() && !rest.contains('/') {
            return Route::Rpc(rest.to_string());
        }
        if let Some(sk) = rest.strip_prefix("sveltekit/") {
            // Hashed assets are real files; anything else is the shell.
            if sk.contains("immutable") {
                return Route::File(web.sveltekit.join(sk));
            }
            return Route::Index;
        }
        return Route::File(web.ts.join(rest));
    }
    if let Some(rest) = path.strip_prefix("/_app/") {
        return Route::File(web.sveltekit.join("_app").join(rest));
    }
    Route::Index
}

pub type Reply = Response<Cow<'static, [u8]>>;

pub fn handle<R: tauri::Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>) -> Reply {
    let state = ctx.app_handle().state::<AppState>();
    let path = req.uri().path().to_string();
    match resolve(&state.web, req.method(), &path) {
        Route::Rpc(name) => run_rpc(&state, &name, req.body()),
        Route::File(file) => serve_file(&file),
        Route::Index => serve_file(&state.web.sveltekit.join("index.html")),
    }
}

fn run_rpc(state: &AppState, name: &str, body: &[u8]) -> Reply {
    match rpc::call(&state.backend, name, body) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/binary")
            .body(Cow::Owned(bytes))
            .expect("rpc response"),
        Err(err) if err.is_unknown_method() => text(StatusCode::NOT_FOUND, err.message()),
        Err(err) => text(StatusCode::INTERNAL_SERVER_ERROR, err.message()),
    }
}

fn serve_file(file: &Path) -> Reply {
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

fn text(status: StatusCode, body: String) -> Reply {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Cow::Owned(body.into_bytes()))
        .expect("text response")
}

pub fn mime_for(file: &Path) -> &'static str {
    match file.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn web() -> WebRoot {
        WebRoot {
            sveltekit: PathBuf::from("/w/sveltekit"),
            ts: PathBuf::from("/w/ts"),
        }
    }

    #[test]
    fn posts_to_bare_anki_names_are_rpcs() {
        assert_eq!(
            resolve(&web(), &Method::POST, "/_anki/congratsInfo"),
            Route::Rpc("congratsInfo".into())
        );
        // A GET to the same path is a file lookup, like mediasrv.
        assert_eq!(
            resolve(&web(), &Method::GET, "/_anki/congratsInfo"),
            Route::File("/w/ts/congratsInfo".into())
        );
        // Nested paths are never RPCs.
        assert_eq!(
            resolve(&web(), &Method::POST, "/_anki/js/reviewer.js"),
            Route::File("/w/ts/js/reviewer.js".into())
        );
    }

    #[test]
    fn sveltekit_assets_and_routes() {
        assert_eq!(
            resolve(&web(), &Method::GET, "/_app/immutable/entry/start.js"),
            Route::File("/w/sveltekit/_app/immutable/entry/start.js".into())
        );
        assert_eq!(
            resolve(&web(), &Method::GET, "/_anki/sveltekit/_app/immutable/x.css"),
            Route::File("/w/sveltekit/_app/immutable/x.css".into())
        );
        assert_eq!(resolve(&web(), &Method::GET, "/_anki/sveltekit/congrats"), Route::Index);
        assert_eq!(resolve(&web(), &Method::GET, "/congrats"), Route::Index);
        assert_eq!(resolve(&web(), &Method::GET, "/deck-options/1"), Route::Index);
        assert_eq!(resolve(&web(), &Method::GET, "/"), Route::Index);
    }

    #[test]
    fn mime_types() {
        assert_eq!(mime_for(Path::new("a/b.js")), "text/javascript");
        assert_eq!(mime_for(Path::new("a/b.woff2")), "font/woff2");
        assert_eq!(mime_for(Path::new("a/b")), "application/octet-stream");
    }
}
