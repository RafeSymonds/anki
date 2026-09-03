//! Fill a profile with demo notes so there is something to study.
//!
//!     cargo run -p anki-desktop --example seed -- <profile dir> [count]

use std::path::PathBuf;

use anki_desktop::demo;
use anki_desktop::new_backend;
use anki_desktop::profile;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().expect("usage: seed <profile dir> [count]"));
    let count: usize = args.next().and_then(|c| c.parse().ok()).unwrap_or(20);

    let backend = new_backend();
    profile::open_collection(&backend, &dir)?;
    demo::seed(&backend, count)?;
    profile::close_collection(&backend)?;
    println!("added {count} notes to {}", dir.display());
    Ok(())
}
