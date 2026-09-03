// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

use std::env;
use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;

use anki_proto_gen::descriptors_path;
use anki_proto_gen::get_services;
use anyhow::Context;
use anyhow::Result;
use prost_reflect::DescriptorPool;

fn main() -> Result<()> {
    tauri_build::build();
    write_method_table()
}

/// Generates `methods.rs`: the table mapping the camelCase names the web code
/// posts to `/_anki/{name}` onto the (service, method) indices that
/// `Backend::run_service_method` dispatches on. Same rule pylib uses.
fn write_method_table() -> Result<()> {
    let path = descriptors_path();
    println!("cargo:rerun-if-changed={}", path.display());
    let bytes = fs::read(&path).with_context(|| format!("read {}", path.display()))?;
    let pool = DescriptorPool::decode(bytes.as_ref()).context("decode descriptors")?;
    let (collection, backend) = get_services(&pool);

    let mut buf = String::new();
    buf.push_str("/// (camelCase method name, service index, method index)\n");
    buf.push_str("pub static METHODS: &[(&str, u32, u32)] = &[\n");
    for service in backend
        .iter()
        .filter(|s| s.name != "BackendFrontendService")
    {
        for method in service
            .trait_methods
            .iter()
            .chain(&service.delegating_methods)
        {
            writeln!(
                buf,
                "    ({:?}, {}, {}),",
                snake_to_camel(&method.name),
                service.index,
                method.index
            )?;
        }
    }
    buf.push_str("];\n");

    // Methods the web code calls that are implemented by the app shell, not
    // rslib (FrontendService in proto/anki/frontend.proto).
    buf.push_str("/// camelCase names of FrontendService methods\n");
    buf.push_str("pub static FRONTEND_METHODS: &[&str] = &[\n");
    for service in collection.iter().filter(|s| s.name == "FrontendService") {
        for method in &service.trait_methods {
            writeln!(buf, "    {:?},", snake_to_camel(&method.name))?;
        }
    }
    buf.push_str("];\n");

    let out = PathBuf::from(env::var("OUT_DIR")?).join("methods.rs");
    fs::write(&out, buf).context("write methods.rs")?;
    Ok(())
}

/// `get_deck_names` -> `getDeckNames`, matching protobuf-es local names.
fn snake_to_camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper_next = false;
    for ch in name.chars() {
        if ch == '_' {
            upper_next = true;
        } else if upper_next {
            out.extend(ch.to_uppercase());
            upper_next = false;
        } else {
            out.push(ch);
        }
    }
    out
}
