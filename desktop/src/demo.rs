// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Demo content for development and tests: a handful of Basic and Cloze
//! notes across two decks.

use anki::backend::Backend;
use anki_proto::collection::OpChangesWithId;
use anki_proto::decks::Deck;
use anki_proto::generic::Empty;
use anki_proto::notes::AddNoteRequest;
use anki_proto::notes::AddNoteResponse;
use anki_proto::notes::Note;
use anki_proto::notetypes::NotetypeId;
use anki_proto::notetypes::NotetypeNames;
use anyhow::Context;
use anyhow::Result;

pub const DEMO_DECK: &str = "Demo";

/// Add `count` notes to the open collection: three Basic notes for every
/// Cloze, alternating between Default and a "Demo" deck.
pub fn seed(backend: &Backend, count: usize) -> Result<()> {
    let names: NotetypeNames = rpc_typed(backend, "getNotetypeNames", &Empty {})?;
    let id_of = |name: &str| -> Result<i64> {
        names
            .entries
            .iter()
            .find(|n| n.name == name)
            .map(|n| n.id)
            .with_context(|| format!("missing stock notetype {name}"))
    };
    let basic = id_of("Basic")?;
    let cloze = id_of("Cloze")?;

    // Reuse the demo deck when seeding more than once (tests reseed).
    let existing: anki_proto::decks::DeckId = rpc_typed(
        backend,
        "getDeckIdByName",
        &anki_proto::generic::String {
            val: DEMO_DECK.into(),
        },
    )
    .unwrap_or_default();
    let demo_id = if existing.did != 0 {
        existing.did
    } else {
        let mut demo: Deck = rpc_typed(backend, "newDeck", &Empty {})?;
        demo.name = DEMO_DECK.into();
        let added: OpChangesWithId = rpc_typed(backend, "addDeck", &demo)?;
        added.id
    };

    for i in 0..count {
        let (ntid, fields) = if i % 4 == 3 {
            (
                cloze,
                vec![
                    format!("The capital of country {i} is {{{{c1::City {i}}}}}."),
                    format!("Extra note {i}"),
                ],
            )
        } else {
            (
                basic,
                vec![
                    format!("<b>Question {i}</b><br>What is the capital of country {i}?"),
                    format!("City {i}"),
                ],
            )
        };
        let mut note: Note = rpc_typed(backend, "newNote", &NotetypeId { ntid })?;
        // Fill the leading fields only: the user (or a test) may have added
        // fields to the stock notetypes, and addNote wants all of them.
        for (slot, value) in note.fields.iter_mut().zip(fields) {
            *slot = value;
        }
        note.tags = vec!["demo".into()];
        let deck_id = if i % 2 == 0 { 1 } else { demo_id };
        let _: AddNoteResponse = rpc_typed(
            backend,
            "addNote",
            &AddNoteRequest {
                note: Some(note),
                deck_id,
            },
        )?;
    }
    Ok(())
}

fn rpc_typed<I, O>(backend: &Backend, name: &str, input: &I) -> Result<O>
where
    I: prost::Message,
    O: prost::Message + Default,
{
    crate::rpc::call_typed(backend, name, input).with_context(|| format!("rpc {name}"))
}
