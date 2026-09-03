//! A small loopback HTTP server exposing the same routes as the `anki://`
//! scheme. Used by `anki-desktop --serve PORT` so the shell can be driven
//! by a browser and by Playwright end-to-end tests without a window.
//!
//! Deliberately minimal: HTTP/1.1, one thread per connection, no keep-alive.

use std::io::BufRead;
use std::io::BufReader;
use std::io::Read;
use std::io::Write;
use std::net::TcpListener;
use std::net::TcpStream;
use std::sync::Arc;

use anyhow::Context;
use anyhow::Result;
use tauri::http::Method;

use crate::scheme;
use crate::AppState;

/// Bind the port and serve forever.
pub fn serve(state: Arc<AppState>, port: u16) -> Result<()> {
    let listener =
        TcpListener::bind(("127.0.0.1", port)).with_context(|| format!("bind port {port}"))?;
    eprintln!("serving http://127.0.0.1:{port}/");
    for stream in listener.incoming() {
        let stream = match stream {
            Ok(stream) => stream,
            Err(err) => {
                eprintln!("accept: {err}");
                continue;
            }
        };
        let state = Arc::clone(&state);
        std::thread::spawn(move || {
            if let Err(err) = handle_connection(&state, stream) {
                eprintln!("http: {err:#}");
            }
        });
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub struct ParsedRequest {
    pub method: String,
    pub path: String,
    pub content_length: usize,
}

/// Parse the request line and headers; the body follows.
pub fn parse_head(head: &str) -> Result<ParsedRequest> {
    let mut lines = head.lines();
    let request_line = lines.next().context("empty request")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().context("missing method")?.to_string();
    let target = parts.next().context("missing path")?;
    // Drop the query string; the routes do not use it.
    let path = target.split('?').next().unwrap_or(target).to_string();
    let mut content_length = 0;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }
    Ok(ParsedRequest {
        method,
        path,
        content_length,
    })
}

fn handle_connection(state: &AppState, mut stream: TcpStream) -> Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut head = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        head.push_str(&line);
    }
    let request = parse_head(&head)?;
    let mut body = vec![0u8; request.content_length];
    reader.read_exact(&mut body)?;

    let method: Method = request.method.parse().unwrap_or(Method::GET);
    let reply = scheme::dispatch(state, &method, &request.path, &body);

    let mut out = Vec::new();
    write!(
        out,
        "HTTP/1.1 {} {}\r\n",
        reply.status().as_u16(),
        reply.status().canonical_reason().unwrap_or("")
    )?;
    for (name, value) in reply.headers() {
        write!(out, "{}: {}\r\n", name, value.to_str().unwrap_or(""))?;
    }
    write!(
        out,
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        reply.body().len()
    )?;
    if method != Method::HEAD {
        out.extend_from_slice(reply.body());
    }
    stream.write_all(&out)?;
    stream.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_request_line_and_length() {
        let parsed = parse_head(
            "POST /_anki/congratsInfo?x=1 HTTP/1.1\r\nHost: a\r\nContent-Length: 12\r\n",
        )
        .unwrap();
        assert_eq!(
            parsed,
            ParsedRequest {
                method: "POST".into(),
                path: "/_anki/congratsInfo".into(),
                content_length: 12
            }
        );
        let get = parse_head("GET / HTTP/1.1\r\n").unwrap();
        assert_eq!(get.content_length, 0);
        assert_eq!(get.path, "/");
        assert!(parse_head("").is_err());
    }
}
