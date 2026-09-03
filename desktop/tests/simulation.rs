// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Simulation testing: random sequences of the operations the shell performs
//! (answering, burying, undoing, adding and deleting notes, flags, tags,
//! rescheduling) against a real collection, with invariants checked after
//! every step and the database checker run periodically.
//!
//! Reproduce a failure with `ANKI_SIM_SEED=<seed> ANKI_SIM_STEPS=<n>`.

use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use anki::backend::Backend;
use anki_desktop::demo;
use anki_desktop::new_backend;
use anki_desktop::profile;
use anki_desktop::rpc;
use anki_proto::cards::Card;
use anki_proto::cards::CardId;
use anki_proto::cards::CardIds;
use anki_proto::cards::SetFlagRequest;
use anki_proto::collection::CheckDatabaseResponse;
use anki_proto::collection::OpChanges;
use anki_proto::collection::OpChangesAfterUndo;
use anki_proto::collection::OpChangesWithCount;
use anki_proto::collection::UndoStatus;
use anki_proto::decks::DeckTreeNode;
use anki_proto::decks::DeckTreeRequest;
use anki_proto::generic::Empty;
use anki_proto::notes::AddNoteRequest;
use anki_proto::notes::AddNoteResponse;
use anki_proto::notes::Note;
use anki_proto::notes::NoteId;
use anki_proto::notes::RemoveNotesRequest;
use anki_proto::notetypes::NotetypeId;
use anki_proto::notetypes::NotetypeNames;
use anki_proto::scheduler::bury_or_suspend_cards_request::Mode;
use anki_proto::scheduler::card_answer::Rating;
use anki_proto::scheduler::BuryOrSuspendCardsRequest;
use anki_proto::scheduler::CardAnswer;
use anki_proto::scheduler::GetQueuedCardsRequest;
use anki_proto::scheduler::QueuedCards;
use anki_proto::scheduler::ScheduleCardsAsNewRequest;
use anki_proto::scheduler::SchedulingState;
use anki_proto::scheduler::SetDueDateRequest;
use anki_proto::search::sort_order;
use anki_proto::search::SearchRequest;
use anki_proto::search::SearchResponse;
use anki_proto::search::SortOrder;
use anki_proto::tags::NoteIdsAndTagsRequest;
use prost::Message;
use rand::rngs::StdRng;
use rand::Rng;
use rand::SeedableRng;

fn env_number<T: std::str::FromStr>(name: &str, fallback: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis() as i64
}

fn unsorted() -> SortOrder {
    SortOrder {
        value: Some(sort_order::Value::None(Empty {})),
    }
}

struct Sim {
    backend: Backend,
    rng: StdRng,
    basic: i64,
    log: Vec<String>,
}

impl Sim {
    fn new(seed: u64, dir: &std::path::Path, notes: usize) -> Self {
        let backend = new_backend();
        profile::open_collection(&backend, dir).unwrap();
        demo::seed(&backend, notes).unwrap();
        let names: NotetypeNames =
            rpc::call_typed(&backend, "getNotetypeNames", &Empty {}).unwrap();
        let basic = names
            .entries
            .iter()
            .find(|n| n.name == "Basic")
            .map(|n| n.id)
            .expect("Basic notetype");
        Self {
            backend,
            rng: StdRng::seed_from_u64(seed),
            basic,
            log: Vec::new(),
        }
    }

    fn call<I: Message, O: Message + Default>(&self, name: &str, input: &I) -> O {
        rpc::call_typed(&self.backend, name, input)
            .unwrap_or_else(|err| panic!("{name} failed: {err}\nhistory:\n{}", self.log.join("\n")))
    }

    fn card_ids(&self) -> Vec<i64> {
        let response: SearchResponse = self.call(
            "searchCards",
            &SearchRequest {
                search: String::new(),
                order: Some(unsorted()),
            },
        );
        response.ids
    }

    fn note_ids(&self) -> Vec<i64> {
        let response: SearchResponse = self.call(
            "searchNotes",
            &SearchRequest {
                search: String::new(),
                order: Some(unsorted()),
            },
        );
        response.ids
    }

    fn pick<T: Copy>(&mut self, items: &[T]) -> Option<T> {
        if items.is_empty() {
            None
        } else {
            Some(items[self.rng.random_range(0..items.len())])
        }
    }

    fn note(&mut self, text: &str) {
        self.log.push(text.to_string());
    }

    // ---- operations ----

    fn answer_next(&mut self) {
        let queued: QueuedCards = self.call(
            "getQueuedCards",
            &GetQueuedCardsRequest {
                fetch_limit: 1,
                intraday_learning_only: false,
            },
        );
        let Some(top) = queued.cards.first() else {
            self.note("answer: queue empty");
            return;
        };
        let card = top.card.as_ref().expect("queued card");
        let states = top.states.as_ref().expect("states");
        let ease = self.rng.random_range(1..=4u8);
        let (rating, new_state) = match ease {
            1 => (Rating::Again, states.again.clone()),
            2 => (Rating::Hard, states.hard.clone()),
            3 => (Rating::Good, states.good.clone()),
            _ => (Rating::Easy, states.easy.clone()),
        };
        let answer = CardAnswer {
            card_id: card.id,
            current_state: states.current.clone(),
            new_state,
            rating: rating as i32,
            answered_at_millis: now_millis(),
            milliseconds_taken: self.rng.random_range(400..20_000),
        };
        let _: OpChanges = self.call("answerCard", &answer);
        self.note(&format!("answer card {} ease {ease}", card.id));
    }

    fn bury_or_suspend(&mut self) {
        let ids = self.card_ids();
        let Some(cid) = self.pick(&ids) else { return };
        let mode = if self.rng.random_bool(0.5) {
            Mode::BuryUser
        } else {
            Mode::Suspend
        };
        let _: OpChangesWithCount = self.call(
            "buryOrSuspendCards",
            &BuryOrSuspendCardsRequest {
                card_ids: vec![cid],
                note_ids: vec![],
                mode: mode as i32,
            },
        );
        self.note(&format!("{mode:?} card {cid}"));
    }

    fn restore(&mut self) {
        let ids = self.card_ids();
        let _: OpChanges = self.call(
            "restoreBuriedAndSuspendedCards",
            &CardIds { cids: ids.clone() },
        );
        self.note(&format!("restore {} cards", ids.len()));
    }

    fn undo(&mut self) -> bool {
        let status: UndoStatus = self.call("getUndoStatus", &Empty {});
        if status.undo.is_empty() {
            self.note("undo: nothing");
            return false;
        }
        let result: OpChangesAfterUndo = self.call("undo", &Empty {});
        self.note(&format!("undo {}", result.operation));
        true
    }

    fn redo(&mut self) {
        let status: UndoStatus = self.call("getUndoStatus", &Empty {});
        if status.redo.is_empty() {
            self.note("redo: nothing");
            return;
        }
        let result: OpChangesAfterUndo = self.call("redo", &Empty {});
        self.note(&format!("redo {}", result.operation));
    }

    fn add_note(&mut self) {
        let mut note: Note = self.call("newNote", &NotetypeId { ntid: self.basic });
        let n = self.rng.random_range(0..1_000_000);
        note.fields = vec![format!("Sim front {n}"), format!("Sim back {n}")];
        let response: AddNoteResponse = self.call(
            "addNote",
            &AddNoteRequest {
                note: Some(note),
                deck_id: 1,
            },
        );
        self.note(&format!("add note {}", response.note_id));
    }

    fn delete_note(&mut self) {
        let ids = self.note_ids();
        if ids.len() < 3 {
            return;
        }
        let Some(nid) = self.pick(&ids) else { return };
        let _: OpChangesWithCount = self.call(
            "removeNotes",
            &RemoveNotesRequest {
                note_ids: vec![nid],
                card_ids: vec![],
            },
        );
        self.note(&format!("delete note {nid}"));
    }

    fn flag(&mut self) {
        let ids = self.card_ids();
        let Some(cid) = self.pick(&ids) else { return };
        let flag = self.rng.random_range(0..=7u32);
        let _: OpChangesWithCount = self.call(
            "setFlag",
            &SetFlagRequest {
                card_ids: vec![cid],
                flag,
            },
        );
        let card: Card = self.call("getCard", &CardId { cid });
        assert_eq!(card.flags & 0b111, flag, "flag round trip");
        self.note(&format!("flag card {cid} -> {flag}"));
    }

    fn tag(&mut self) {
        let ids = self.note_ids();
        let Some(nid) = self.pick(&ids) else { return };
        let tag = format!("sim{}", self.rng.random_range(0..5));
        let method = if self.rng.random_bool(0.6) {
            "addNoteTags"
        } else {
            "removeNoteTags"
        };
        let _: OpChangesWithCount = self.call(
            method,
            &NoteIdsAndTagsRequest {
                note_ids: vec![nid],
                tags: tag.clone(),
            },
        );
        self.note(&format!("{method} {nid} {tag}"));
    }

    fn set_due(&mut self) {
        let ids = self.card_ids();
        let Some(cid) = self.pick(&ids) else { return };
        let days = format!("{}", self.rng.random_range(0..10));
        let _: OpChanges = self.call(
            "setDueDate",
            &SetDueDateRequest {
                card_ids: vec![cid],
                days: days.clone(),
                config_key: None,
            },
        );
        self.note(&format!("set due {cid} in {days} days"));
    }

    fn forget(&mut self) {
        let ids = self.card_ids();
        let Some(cid) = self.pick(&ids) else { return };
        let _: OpChanges = self.call(
            "scheduleCardsAsNew",
            &ScheduleCardsAsNewRequest {
                card_ids: vec![cid],
                log: true,
                restore_position: false,
                reset_counts: false,
                context: None,
            },
        );
        self.note(&format!("forget {cid}"));
    }

    fn step(&mut self) {
        match self.rng.random_range(0..100u32) {
            0..=39 => self.answer_next(),
            40..=49 => self.bury_or_suspend(),
            50..=54 => self.restore(),
            55..=64 => {
                self.undo();
            }
            65..=69 => self.redo(),
            70..=79 => self.add_note(),
            80..=83 => self.delete_note(),
            84..=89 => self.flag(),
            90..=93 => self.tag(),
            94..=96 => self.set_due(),
            _ => self.forget(),
        }
    }

    // ---- invariants ----

    fn check_invariants(&self) {
        // A non-zero `now` asks for today's counts and totals.
        let tree: DeckTreeNode = self.call(
            "deckTree",
            &DeckTreeRequest {
                now: now_millis() / 1000,
            },
        );
        let cards = self.card_ids();
        // The root is synthetic; its children carry the totals.
        let total: u32 = tree
            .children
            .iter()
            .map(|c| c.total_including_children)
            .sum();
        assert_eq!(
            total as usize,
            cards.len(),
            "deck tree total must match the card count\n{}",
            self.log.join("\n")
        );
        for node in &tree.children {
            for (label, count) in [
                ("new", node.new_count),
                ("learn", node.learn_count),
                ("review", node.review_count),
            ] {
                assert!(
                    count <= node.total_including_children,
                    "{label} count {count} exceeds {} cards in {}",
                    node.total_including_children,
                    node.name
                );
            }
        }
        // Every card belongs to a note that still exists, and every note
        // still has at least one card.
        let notes = self.note_ids();
        for cid in cards.iter().take(20) {
            let card: Card = self.call("getCard", &CardId { cid: *cid });
            assert!(
                notes.contains(&card.note_id),
                "card {cid} has a missing note"
            );
            let _: Note = self.call("getNote", &NoteId { nid: card.note_id });
        }
        assert!(!notes.is_empty(), "collection ran out of notes");
    }

    fn check_database(&self) {
        let response: CheckDatabaseResponse = self.call("checkDatabase", &Empty {});
        assert!(
            response.problems.is_empty(),
            "check database found problems: {:?}\nhistory:\n{}",
            response.problems,
            self.log.join("\n")
        );
    }
}

#[test]
fn random_operations_keep_the_collection_consistent() {
    let seed: u64 = env_number("ANKI_SIM_SEED", 0x5eed);
    let steps: usize = env_number("ANKI_SIM_STEPS", 120);
    let dir = tempfile::tempdir().unwrap();
    let mut sim = Sim::new(seed, dir.path(), 30);

    for i in 0..steps {
        sim.step();
        sim.check_invariants();
        if i % 25 == 24 {
            sim.check_database();
        }
    }
    sim.check_database();
    profile::close_collection(&sim.backend).unwrap();
    eprintln!("simulation seed {seed}: {steps} steps ok");
}

#[test]
fn undo_after_answering_restores_the_card() {
    let dir = tempfile::tempdir().unwrap();
    let mut sim = Sim::new(7, dir.path(), 8);

    let queued: QueuedCards = sim.call(
        "getQueuedCards",
        &GetQueuedCardsRequest {
            fetch_limit: 1,
            intraday_learning_only: false,
        },
    );
    let cid = queued.cards[0].card.as_ref().unwrap().id;
    let before: Card = sim.call("getCard", &CardId { cid });

    sim.answer_next();
    let after: Card = sim.call("getCard", &CardId { cid });
    assert_ne!(
        (before.queue, before.due, before.reps),
        (after.queue, after.due, after.reps)
    );

    assert!(sim.undo());
    let restored: Card = sim.call("getCard", &CardId { cid });
    assert_eq!(
        (before.queue, before.due, before.reps, before.interval),
        (
            restored.queue,
            restored.due,
            restored.reps,
            restored.interval
        )
    );

    // The undone card is back at the front of the queue.
    let queued: QueuedCards = sim.call(
        "getQueuedCards",
        &GetQueuedCardsRequest {
            fetch_limit: 1,
            intraday_learning_only: false,
        },
    );
    assert_eq!(queued.cards[0].card.as_ref().unwrap().id, cid);
}

#[test]
fn a_full_session_empties_the_queue() {
    let dir = tempfile::tempdir().unwrap();
    let sim = Sim::new(11, dir.path(), 12);
    // Rate everything Easy; new cards leave learning immediately.
    for _ in 0..200 {
        let queued: QueuedCards = sim.call(
            "getQueuedCards",
            &GetQueuedCardsRequest {
                fetch_limit: 1,
                intraday_learning_only: false,
            },
        );
        let Some(top) = queued.cards.first() else {
            break;
        };
        let card = top.card.as_ref().unwrap();
        let states = top.states.as_ref().unwrap();
        let easy: Option<SchedulingState> = states.easy.clone();
        let _: OpChanges = sim.call(
            "answerCard",
            &CardAnswer {
                card_id: card.id,
                current_state: states.current.clone(),
                new_state: easy,
                rating: Rating::Easy as i32,
                answered_at_millis: now_millis(),
                milliseconds_taken: 1000,
            },
        );
    }
    let queued: QueuedCards = sim.call(
        "getQueuedCards",
        &GetQueuedCardsRequest {
            fetch_limit: 1,
            intraday_learning_only: false,
        },
    );
    assert!(
        queued.cards.is_empty(),
        "queue should be empty after rating all cards Easy"
    );
    sim.check_invariants();
    sim.check_database();
}
