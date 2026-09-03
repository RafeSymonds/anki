# Claude Code Configuration

> **Note:** Every command you need — building, running, testing, linting,
> formatting — is defined as a recipe in the project `justfile`. Run
> `just --list` to see them. Do not invoke `./ninja`, `./run`, or scripts
> under `./tools` directly — use the `just` recipes instead.

## This fork: the app is the Tauri shell in `desktop/`

This is a personal fork (origin `RafeSymonds/anki`, upstream `ankitects/anki`)
whose macOS app has been rebuilt as a Tauri 2 app over the existing Rust core.
New work belongs in `desktop/` (Rust host) and `ts/lib/desktop/` (the app
shell in Svelte), not in `qt/` or `pylib/`, which are upstream leftovers kept
only until the last screens move across. Do not propose PyQt changes, and do
not worry about breaking add-ons: there is no add-on support.

**Frozen boundary.** Nothing that leaves the machine may change: the sync wire
protocol (`rslib/src/sync/http_client`, `request/`, `response.rs`,
`version.rs`), media sync (`rslib/src/sync/media`) and the collection SQLite
schema (`rslib/src/storage/upgrades`). Sync _UI_ is free to change.

**Running it.** `bin/anki start|stop|restart|status` builds and launches the
window; `--build` rebuilds web assets first. `bin/anki serve PORT [--fresh]`
runs the same binary over loopback HTTP with no window, which is what the
browser tests drive. `bin/anki sveltekit` rebuilds just the shell, and is
needed after any change under `ts/` before an e2e run. `just run` still starts
the _old Qt app_; it is not this app.

Development profiles live in `out/anki-dev-base` (`ANKI_BASE`), so a dev run
never touches the real collection. Never point a test or a scratch server at
`~/Library/Application Support/Anki2`.

**Where things are.** `desktop/README.md` is the developer map: architecture,
the `anki://` scheme and `/_desktop/{command}` calls, every screen and
convention. Read it before changing the shell. The plan and what has shipped:
https://claude.ai/code/artifact/c91d5534-9763-4c4c-a311-b61574ae9da6

**Look and feel.** One palette, type scale and elevation live in
`ts/lib/desktop/theme.ts`, injected into the shell and into every page it
embeds (editor, deck options, statistics, the card frame); it redefines the
upstream token names from `ts/lib/sass/_vars.scss` at `:root:root` so it wins
regardless of stylesheet order. Use `--app-*` tokens in new components rather
than hard-coded colours, and keep both themes working. `editor-theme.ts` is
the same idea for the note editor's own document.

**Tests.** Four layers, all expected to pass:

- `cargo test -p anki-desktop` — unit, backend integration, simulation, sync.
- `cd ts && ../out/extracted/node/bin/yarn vitest run lib/desktop` — the
  shell's logic. Filters are relative to `ts/`.
- `bin/anki e2e` (or `bin/anki e2e-quick PORT [spec]` to skip the asset
  build) — Playwright in Chromium _and_ WebKit, the engine the real window
  uses. Both projects share one seeded collection, so a spec must tolerate
  the state the other engine left: use unique names, relative counts, and put
  anything that empties the collection in `zz-first-run.spec.ts`, which runs
  last and reseeds.
- `ts/tests/desktop/monkey.spec.ts` — a seeded random walk that fails on any
  page error or 5xx. Extend it when you add a screen.

**Two traps.** Playwright's `getByRole(role, { name })` matches substrings, so
a new control whose accessible name contains "Add", "Browse", "Options" or
"Close" will break existing specs; check before naming one. And `just fix-fmt`
runs stable rustfmt while `just check` wants the project's nightly settings —
when `check:format:rust` fails, run `cargo +nightly-2025-03-20 fmt --all`.

**Commits.** Work on branch `tauri` and never push. Commit messages end with
the `Claude-Session:` trailer only; never add a co-author.

## Project Overview

Anki is a spaced repetition flashcard program with a multi-layered architecture. Main components:

- Web frontend: Svelte/TypeScript in ts/
- PyQt GUI, which embeds the web components in aqt/
- Python library which wraps our rust Layer (pylib/, with Rust module in pylib/rsbridge)
- Core Rust layer in rslib/
- Protobuf definitions in proto/ that are used by the different layers to
  talk to each other.

## Running the old Qt app

Only useful for comparing behaviour with upstream; the app this fork ships is
the one above.

To build and run the Qt app in development mode:

```
just run
```

This builds pylib and qt, then launches Anki with debugging enabled. Web
views are served at http://localhost:40000/_anki/pages/ (e.g.,
deckconfig.html). Use `just run-optimized` for a release-optimized build.
For live-reloading during web development, run `just web-watch` in a
separate terminal — it monitors ts/, sass/, and qt/aqt/data/web/ and
auto-rebuilds on changes (`just rebuild-web` triggers a one-off rebuild).

## Building/checking

`just check` will format the code and run the main build & checks.
Please do this as a final step before marking a task as completed.

Run `just` (or `just --list`) to see all available commands.

## Quick iteration

During development, you can build/check subsections of our code:

- Rust: `cargo check`
- Python: `just lint` (runs mypy/ruff), and if wheel-related, `just wheels`
- TypeScript/Svelte: `just lint` (includes check:svelte and check:typescript)

Language-specific tests are also available: `just test-rust`, `just test-py`,
`just test-ts`. Use `just fmt` / `just fix-fmt` for formatting and
`just fix-lint` to auto-fix lint issues.

Upstream's browser e2e tests live in `ts/tests/e2e/` and run with
`just test-e2e` against a temporary Qt-era instance. This fork's own suite is
`ts/tests/desktop/`, run with `bin/anki e2e`; see the section on this fork
above.

Be mindful that some changes (such as modifications to .proto files) may
need a full build with `just check` first.

## Build tooling

`just` recipes wrap our build system (implemented in build/), which takes
care of downloading required deps and invoking our build steps. See the
project `justfile` for the full set of recipes.

## Translations

ftl/ contains our Fluent translation files. We have scripts in rslib/i18n
to auto-generate an API for Rust, TypeScript and Python so that our code can
access the translations in a type-safe manner. Changes should be made to
ftl/core or ftl/qt. Except for features specific to our Qt interface, prefer
the core module. When adding new strings, confirm the appropriate ftl file
first, and try to match the existing style.

## Protobuf and IPC

Our build scripts use the .proto files to define our Rust library's
non-Rust API. pylib/rsbridge exposes that API, and \_backend.py exposes
snake_case methods for each protobuf RPC that call into the API.
Similar tooling creates a @generated/backend TypeScript module for
communicating with the Rust backend (which happens over POST requests).

## Fixing errors

When dealing with build errors or failing tests, invoke 'check' or one
of the quick iteration commands regularly. This helps verify your changes
are correct. To locate other instances of a problem, run the check again -
don't attempt to grep the codebase.

## Ignores

The files in out/ are auto-generated. Mostly you should ignore that folder,
though you may sometimes find it useful to view out/{pylib/anki,qt/\_aqt,ts/lib/generated} when dealing with cross-language communication or our other generated sourcecode.

## Installer

The code for our Briefcase-based installer is in qt/installer, with
separate templates for each platform (mac-template/, linux-template/,
windows-template/).

## Rust dependencies

Prefer adding to the root workspace, and using dep.workspace = true in the individual Rust project.

## Rust utilities

rslib/{process,io} contain some helpers for file and process operations,
which provide better error messages/context and some ergonomics. Use them
when possible.

## Rust error handling

in rslib, use error/mod.rs's AnkiError/Result and snafu. In our other Rust modules, prefer anyhow + additional context where appropriate. Unwrapping
in build scripts/tests is fine.

## Individual preferences

Rafe's global preferences live in `~/.claude/CLAUDE.md`. For this app, the
conventions that matter are in `desktop/README.md`.
