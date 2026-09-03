// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Maps `/_anki/{method}` calls from the web code onto rslib.
//!
//! The web code posts protobuf bytes to a camelCase method name. rslib
//! dispatches on numeric (service, method) indices. `METHODS` is generated
//! by build.rs from the protobuf descriptors and joins the two.

use std::collections::HashMap;
use std::fmt;
use std::sync::OnceLock;

use anki::backend::Backend;
use anki_proto::backend::backend_error::Kind;
use anki_proto::backend::BackendError;
use prost::Message;

include!(concat!(env!("OUT_DIR"), "/methods.rs"));

fn table() -> &'static HashMap<&'static str, (u32, u32)> {
    static TABLE: OnceLock<HashMap<&'static str, (u32, u32)>> = OnceLock::new();
    TABLE.get_or_init(|| {
        METHODS
            .iter()
            .map(|(name, service, method)| (*name, (*service, *method)))
            .collect()
    })
}

/// The (service, method) indices for a camelCase method name.
pub fn lookup(name: &str) -> Option<(u32, u32)> {
    table().get(name).copied()
}

/// True for methods the app shell implements instead of rslib.
pub fn is_frontend_method(name: &str) -> bool {
    FRONTEND_METHODS.contains(&name)
}

#[derive(Debug)]
pub enum RpcError {
    UnknownMethod(String),
    Backend(BackendError),
    Decode(String),
}

impl RpcError {
    /// The text the web code shows the user. Mirrors what the Python
    /// media server returned: the backend error's message.
    pub fn message(&self) -> String {
        match self {
            RpcError::UnknownMethod(name) => format!("unknown backend method: {name}"),
            RpcError::Backend(err) if err.kind() == Kind::Interrupted => "Interrupted".into(),
            RpcError::Backend(err) => err.message.clone(),
            RpcError::Decode(msg) => msg.clone(),
        }
    }

    pub fn is_unknown_method(&self) -> bool {
        matches!(self, RpcError::UnknownMethod(_))
    }

    /// The proto name of a backend error's kind ("SYNC_AUTH_ERROR", ...), so
    /// the web side can act on it without parsing the message.
    pub fn kind_name(&self) -> Option<&'static str> {
        match self {
            RpcError::Backend(err) => Some(err.kind().as_str_name()),
            _ => None,
        }
    }
    pub fn is_not_found(&self) -> bool {
        matches!(self, RpcError::Backend(err) if err.kind() == Kind::NotFoundError)
    }
}

/// An encoded `generic.Json` holding `null`.
pub fn json_null() -> Vec<u8> {
    anki_proto::generic::Json {
        json: b"null".to_vec(),
    }
    .encode_to_vec()
}

impl fmt::Display for RpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for RpcError {}

/// Run a backend method by its camelCase name with raw protobuf bytes.
pub fn call(backend: &Backend, name: &str, input: &[u8]) -> Result<Vec<u8>, RpcError> {
    let (service, method) =
        lookup(name).ok_or_else(|| RpcError::UnknownMethod(name.to_string()))?;
    backend
        .run_service_method(service, method, input)
        .map_err(|bytes| {
            RpcError::Backend(BackendError::decode(bytes.as_slice()).unwrap_or_else(|_| {
                BackendError {
                    message: "backend returned an undecodable error".into(),
                    ..Default::default()
                }
            }))
        })
}

/// Typed helper for calls made from Rust itself.
pub fn call_typed<I, O>(backend: &Backend, name: &str, input: &I) -> Result<O, RpcError>
where
    I: Message,
    O: Message + Default,
{
    let output = call(backend, name, &input.encode_to_vec())?;
    O::decode(output.as_slice()).map_err(|err| RpcError::Decode(format!("decode {name}: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_is_populated_and_unique() {
        assert!(METHODS.len() > 100, "expected the full backend surface");
        let mut names: Vec<&str> = METHODS.iter().map(|(n, _, _)| *n).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), METHODS.len(), "duplicate method names");
    }

    #[test]
    fn names_are_camel_case_like_the_web_client() {
        for (name, ..) in METHODS {
            assert!(!name.contains('_'), "{name} should be camelCase");
            assert!(
                name.chars().next().unwrap().is_ascii_lowercase(),
                "{name} should start lowercase"
            );
        }
        // Spot checks against out/ts/lib/generated/backend.ts.
        for expected in [
            "i18nResources",
            "congratsInfo",
            "getDeckNames",
            "openCollection",
        ] {
            assert!(lookup(expected).is_some(), "{expected} missing");
        }
    }

    #[test]
    fn frontend_only_services_are_excluded() {
        assert!(lookup("deckOptionsRequireClose").is_none());
        assert!(lookup("searchInBrowser").is_none());
        assert!(is_frontend_method("deckOptionsRequireClose"));
        assert!(is_frontend_method("getSchedulingStatesWithContext"));
        assert!(!is_frontend_method("getDeckNames"));
    }
}
