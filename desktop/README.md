# Anki desktop shell (Tauri)

A macOS app that replaces the PyQt GUI (`qt/`, `pylib/`) with a Tauri 2 window
over the existing Rust core (`rslib/`) and the existing Svelte pages (`ts/`).
The collection file format and the sync protocol are untouched: everything
here is GUI. This document is the map for anyone working on it.

## Layout

```
desktop/                     Rust crate `anki-desktop` (Tauri app + HTTP mode)
  src/lib.rs                 startup: open collection, build AppState, window or --serve
  src/scheme.rs              the anki:// scheme: routes every request (also used by HTTP mode)
  src/rpc.rs                 /_anki/{method} -> Backend::run_service_method (table from build.rs)
  src/desktop_api.rs         /_desktop/{command}: native actions (links, files, dialogs, settings)
  src/settings.rs            per-profile JSON settings (replaces the Qt profile/meta pickles)
  src/profile.rs             data folder, profile folders, open/close collection
  src/sync.rs                close/reopen the collection for the sync flow (/_desktop/closeCollection, reopenCollection)
  src/http.rs                loopback HTTP server for `anki-desktop --serve PORT`
  src/demo.rs                demo notes for dev/e2e collections
  src/menu.rs                native menu bar; choices run window.__ankiMenu(id) in the shell
  src/backup.rs              .colpkg backups into <profile>/backups (on quit, and Tools > Create Backup)
  src/recording.rs           stores editor recordings (/_desktop/saveRecording/{name}) for addMediaFromPath
  Info.plist                 microphone usage description; merged into the bundle and embedded in the dev binary
  web/card.html              the document cards render in (loads js/reviewer.js)
  tests/backend.rs           integration tests against a temporary collection
  tests/simulation.rs        seeded random operation sequences with invariants (ANKI_SIM_SEED/STEPS)
  tests/sync.rs              close/reopen and the error-kind header, against a temporary collection
  examples/seed.rs           `cargo run -p anki-desktop --example seed -- <profile dir>`
ts/lib/desktop/              the Svelte app shell (mounted by ts/routes/+page.svelte)
  App.svelte                 shell: sidebar + screens (overview, review, add, embedded page)
  DeckSidebar.svelte         deck tree
  Overview.svelte            deck overview / congrats, daily-limit notices (limits.ts), first run (EmptyState.svelte)
  Reviewer.svelte            study screen chrome; reviewer.ts is the logic (port of reviewer.py)
  CardFrame.svelte           iframe around desktop/web/card.html
  EditorPanel.svelte         iframe around the note editor route (/editor/?mode=add|current)
  EmbeddedPage.svelte        iframe around any other SvelteKit route (deck options, graphs, ...)
  frontend-service.ts        FrontendService (proto/anki/frontend.proto) implemented in the shell
  shell-services.ts          the shell-wide FrontendService handlers
  bridge.ts                  bridgeCommand/pycmd plumbing
  rpc-events.ts              "a backend call ran" notifications (stand-in for operation_did_execute)
  desktop-api.ts             calls to /_desktop/* (native side)
  sync/                      AnkiWeb sync: sync.ts (port of qt/aqt/sync.py), sync-rpc.ts, SyncPanel.svelte, LoginSheet.svelte
  decks.ts, card-html.ts, audio.ts, shortcuts.ts   pure logic with vitest tests next to them
  notetypes/                 note type list, Fields dialog and card layout (models.py, fields.py, clayout.py)
ts/tests/desktop/            Playwright e2e specs (run against `anki-desktop --serve`);
                             monkey.spec.ts is a seeded UI random walk (ANKI_MONKEY_SEED/STEPS)
playwright.desktop.config.ts
bin/anki                     start/stop/restart/status/serve/e2e/build/logs/package/bench
```

## How the pieces talk

**Backend RPC.** Web code calls rslib exactly as it always has: `postProto` in
`ts/lib/generated/post.ts` POSTs protobuf bytes to `/_anki/{camelCaseMethod}`.
`scheme.rs` maps that onto `Backend::run_service_method(service, method, bytes)`
using a table generated at build time from the protobuf descriptors
(`desktop/build.rs`). Errors come back as 500 with the backend error message,
which `postProto` alerts and rethrows. Nothing in Python is involved.

**FrontendService.** Methods in `proto/anki/frontend.proto` (askUser,
openFilePicker, closeAddCards, deckOptionsRequireClose, getSchedulingStatesWithContext, ...)
are calls the web code makes _to the GUI_. The host injects a shim
(`scheme.rs::init_script`, served at `/_desktop/init.js` and inserted as the
first script of every HTML document) that redirects those fetches to
`window.top.__ankiFrontendService(method, bytes, frame)`, i.e.
`dispatchFrontendCall` in `frontend-service.ts`. Register handlers with
`registerFrontendHandler(name, typedHandler(RequestType, fn))`; the component
that owns the behaviour registers them on mount and unregisters on destroy.
Shell-wide ones live in `shell-services.ts`. A method with no handler makes the
page's call fail with "frontend method not implemented in the app shell".

**bridgeCommand / pycmd.** The shim defines these in every frame and queues
calls until the shell calls `installBridgeHandler(frameWindow, handler)`
(`bridge.ts`). The reviewer document sends `ans`, `ease1`..`ease4`,
`play:q:0`, `statesMutated`; the editor sends `editorReady`, `saved`,
`focus:N`, `blur:N`, `key:N`, ...; SvelteKit pages send `close`.

**Operation notifications.** After any successful POST to `/_anki/{method}`
the shim calls `window.top.__ankiRpcDone(method, frame)`. `rpc-events.ts`
fans that out (`onRpcDone`) so views can refresh, e.g. the deck list after
`answerCard`, the card after the editor's `updateNotes`. `isOperation()`
lists the methods that change the collection.

**Native side.** `/_desktop/{command}` POSTs go to `desktop_api.rs`:
`openLink`, `openMedia`, `showInMediaFolder`, `settingsGet`/`settingsSet`
(`{scope: "profile"|"meta", key, value}`), `openFilePicker` and
`saveFilePicker` (JSON in, `{path}` out; `ANKI_TEST_FILE_PICK` /
`ANKI_TEST_FILE_SAVE` answer them in tests), `closeCollection` /
`reopenCollection` (around a full sync or a .colpkg import), `createBackup`,
`quit`, `profiles` / `switchProfile` (see Profiles), `saveRecording/{name}`
(raw audio bytes in, `{path}` out; see Recording), and `seedDemo` (only
under `--serve`, for tests). Typed helpers are
in `desktop-api.ts`. Add commands there when a feature needs the OS; keep
them small and testable.

**Quitting.** Closing the window, Cmd+Q or Quit in the menu first runs
`window.__ankiBeforeQuit()` in the shell (sync on quit when enabled), which
then posts `/_desktop/quit`; on exit the host writes a backup if the
configured interval has passed and closes the collection.

**Documents.** Everything is one origin (`anki://localhost` in the app,
`http://127.0.0.1:PORT` in HTTP mode). Static files come from
`out/qt/_aqt/data/web` (the tree the Qt app served; build it with `just web`).
`/_app/*` and `/_anki/sveltekit/*` are the SvelteKit build; `/deck-options/1`,
`/editor/?mode=add`, `/graphs`, `/congrats`, ... are SvelteKit routes
(`scheme.rs::SVELTEKIT_ROUTES`); any other root path is a media file from the
open collection's media folder. `/_desktop/card.html` is the card document.

**Existing pages as iframes.** Deck options, statistics, import, card info,
change notetype, image occlusion and preferences are the existing SvelteKit
routes, embedded with `EmbeddedPage.svelte`, which also answers their close
requests. The note editor is embedded with `EditorPanel.svelte`, which drives
it the way `qt/aqt/editor.py` does (`loadNote({...})` after `editorReady`).
Prefer embedding an existing route over rewriting it; write new Svelte for
what only existed in Qt (deck list, reviewer chrome, browser, note types, ...).

**Settings.** The Qt app kept profile/meta dictionaries in a pickle. The shell
keeps `desktop-settings.json` in the profile folder (`settings.rs`), exposed
to web code through `getProfileConfigJson`/`setProfileConfigJson`/
`getMetaJson`/`setMetaJson` and to the shell through `settingsGet/Set`.
Sync credentials, remembered dialog state and similar go there.

**Recording.** The editor's Record Audio button calls the `recordAudio`
frontend method. The shell opens `RecorderDialog.svelte`, which records with
`getUserMedia` + `MediaRecorder` (AAC/MP4 in WebKit), posts the bytes to
`saveRecording/rec<seconds>.<ext>`, and resolves with the temporary file's
path; the editor then adds it with `addMediaFromPath` exactly as it did with
the Qt recorder's file. macOS only grants the microphone to a process with
`NSMicrophoneUsageDescription`: `Info.plist` supplies it, and `build.rs`
embeds it into the bare binary's `__info_plist` section for `bin/anki start`
and the tests. The e2e spec stubs `getUserMedia` with a synthetic tone.

**Deck options essentials.** In the Essentials view each essential setting
carries one line of consequence (`ts/routes/deck-options/consequences.ts`: a
rule-of-thumb review estimate, the review-limit check, forgotten cards per
hundred) and the first sentence of its help inline; the Advanced view keeps
the compact layout. The view flag travels by Svelte context.

**Kind of card.** Above the Add editor, a picker offers Basic, Both
directions and Fill in the blank (`notetype-kinds.ts` maps them to the stock
note types by name; a renamed one drops out) and "More types…" opens the
editor's own chooser. The picker calls `setNotetype` on the editor window,
an export added to NoteEditor.svelte for the shell. Adding a cloze note with
no blank first says how to make one, then asks as before.

**Click to edit.** On the card, clicking a piece of text opens the edit
panel on the field it came from: `CardFrame` reports the clicked element's
text (controls excluded) and `click-to-edit.ts` matches it against the
note's fields. Help > Getting Started and the welcome panel link to the
manual's first chapter (`links.ts`).

**The card sheet.** The card renders in a pane, not in the whole window the
Qt webview was, and `desktop/web/card.html` is written against that: its
rules come after webview.css and reviewer.css so they win, they redefine
`--canvas` to the raised surface (`--canvas-elevated`) on both the root and
the body so the frame is the same colour as the pane behind it, and the body
is given a `min-height` so the note type's own background covers the pane
rather than a strip of it. Images are capped against the pane minus the
document's margins instead of upstream's 95vh, which assumed the card owned
the window. A card longer than the pane still scrolls inside the frame, and
because macOS hides the scrollbar until you reach for it, `CardFrame` reports
which edges are cut and `Reviewer` shades them.

**Live preview.** The Preview toggle in the same bar shows the first card
the note will make (`AddPreview.svelte`, question and answer through
`notetypes/preview.ts`), re-rendered a moment after each keystroke from the
editor's `getNoteInfo`; the toggle is remembered per profile
(`addPreviewOpen`).

**Note type options.** Manage Note Types > Options edits the LaTeX header,
footer and the dvisvgm flag (`OptionsDialog.svelte`, `latexOptions` /
`setLatexOptions` in `notetypes.ts`), saved through `updateNotetype` like
the Fields dialog.

**Browser saved searches.** The sidebar's first section mirrors Qt's:
saved searches live in the collection config key `savedFilters` (name to
search text), so they sync with the collection and show up in the Qt app
too. `BrowserController.saveSearch/renameSavedSearch/removeSavedSearch`
return false when a name is taken so the screen can ask before overwriting.

**Browser column widths.** Dragging the handle at a header's end resizes
the column (arrow keys on a focused handle nudge it; double-click restores
the default); widths live in the profile setting `browserColumnWidths` by
column key (`columnTemplate` and friends in `columns.ts`).

**Periodic work.** As main.py's timers: every five minutes the Rust side
asks rslib for an unforced backup (`backup::periodic_loop`; rslib skips it
until the configured interval has passed and the collection changed), and
the shell checks whether a media-only sync is due
(`SyncController.periodicMediaSync`, `autoSyncMediaMinutes`, default 15,
0 turns it off). Both stay out of the way: no sheet, no notice.

**First-run guide.** The first time a profile reviews a card, the reviewer
shows a one-time guide over the answer buttons (`FirstCardOverlay.svelte`,
`first-card.ts`); the per-profile setting `firstCardGuideShown` records the
dismissal. `--seed` (dev and e2e collections) presets it, so the specs see
the plain reviewer; `first-card.spec.ts` clears it through `settingsSet`.

**Profiles.** Each folder under the data folder (`profile.rs`: `ANKI_BASE`,
else `~/Library/Application Support/Anki2`) is a profile with its own
collection, media and `desktop-settings.json`. The app opens the first one
(`User 1` on a fresh install). File > Switch Profile (Ctrl+Shift+P) lists
them; picking one, or naming a new one, POSTs `switchProfile`, which closes
the open collection, opens the other profile's (creating the folder when new)
and swaps the state's paths and settings. The shell then reloads the page,
the way the Qt app closes and reopens its main window.

**Look and theme.** `theme.ts` holds the palette, type and elevation as one
stylesheet, and redefines the upstream token names from
`ts/lib/sass/_vars.scss` at `:root:root` (the extra specificity beats the
app's own `:root` block, whatever the source order). The shell injects it
into its own document and into every frame it hosts — the note editor, deck
options, statistics, the card frame — so one palette covers them all.
`editor-theme.ts` is appended on top of the note editor's document for the
few things worth changing there: chooser buttons, field cards, the footer.
Both use `--app-*` names for what the upstream tokens do not cover.

No page flashes white on the way in: `scheme.rs` injects a first-paint
stylesheet and sets `night-mode` from the `#night` hash or the system
preference in the init script, before the page's own bundle runs, and the
window is created hidden, given `ground_color()`, then shown.

**Get shared decks.** `SharedDecksScreen.svelte` (sidebar footer, the
sidebar's + menu, Tools, and the welcome panel) explains the three steps,
links into AnkiWeb by subject (`shared-decks.ts`), and lists the .apkg and
.colpkg files already in Downloads so importing one is a click.
`downloads.rs` does the scan behind `/_desktop/downloadedDecks`;
`ANKI_DOWNLOADS_DIR` points it at another folder, which `bin/anki serve
--fresh` sets so a test run never reads the real Downloads.

**Study settings.** The overview explains how the deck is scheduled in
plain words with its own numbers (`Overview.svelte` and
`routes/deck-options/consequences.ts`), and Adjust studying opens
`StudySettings.svelte`: how much a day, when a new card comes back, target
retention when FSRS is on, how long a sitting runs, plus burying and the
timer. It saves through `updateDeckConfigs` and `setPreferences`, the same
calls Deck Options uses, and `study-settings.ts` holds the presets and the
sentences that describe each choice.

## Commands

```
bin/anki start [--build]      build (web with --build) and launch the window
bin/anki stop | status | restart | logs
bin/anki serve [port] [--fresh]   HTTP mode; --fresh seeds out/anki-e2e-base
bin/anki e2e                  Playwright e2e (= just test-e2e-desktop)
bin/anki sveltekit            rebuild only the SvelteKit app (the shell) without ninja, ~35 s
bin/anki e2e-quick [port] [spec]   e2e without rebuilding assets (pair with `bin/anki sveltekit`)
bin/anki package [--universal]    self-contained Anki.app and .dmg in target/release/bundle
bin/anki release <version>    build and publish that version on GitHub
bin/anki bench                cold start and backend round-trip latency
bin/anki worktree-init        prepare a git worktree to build and test on its own
just web                      build the web assets the app serves
cargo test -p anki-desktop    Rust unit + integration tests
yarn vitest run lib/desktop   shell unit tests (use out/extracted/node/bin/yarn)
yarn svelte-check:once        type-check Svelte/TS
out/node_modules/.bin/eslint -c .eslintrc.cjs ts/lib/desktop ts/tests/desktop
just fix-fmt                  format Rust and TS before committing
just lint                     the full lint suite (clippy, mypy, ruff, eslint, svelte, tsc)
```

`ANKI_BASE` chooses the data folder (bin/anki defaults it to
`out/anki-dev-base` so a dev build never touches the real collection);
`ANKI_START_ROUTE=/congrats` opens the window on one route;
`ANKI_WEB_ROOT` overrides where web assets are served from. The packaged
app resolves them from its Resources folder (`bundle.resources` in
tauri.conf.json).

Working in a git worktree (several people or agents at once): run
`bin/anki worktree-init` there, use `bin/anki sveltekit` and
`bin/anki e2e-quick <port>` instead of the ninja-based recipes, and pick a
distinct port per worktree. The ninja build in the main checkout ignores
`.claude/`, where agent worktrees live.

## Releasing

`.github/workflows/desktop-release.yml` builds the app on a macOS runner and
publishes it as a GitHub release, so installing it means downloading one .dmg.

```
bin/anki release 0.2.0     # = gh workflow run desktop-release.yml -f version=0.2.0
git push origin v0.2.0     # a tag push runs the same workflow
```

The run stamps the version into `desktop/tauri.conf.json` (the committed value
is only a placeholder for dev builds), builds the web assets with `just web`,
then `cargo tauri build --target universal-apple-darwin`, so one bundle covers
Intel and Apple silicon. Before publishing it mounts the disk image and
refuses a bundle that is not universal, fails `codesign --verify`, or carries
the wrong version. The release gets `Anki-<version>-macos-universal.dmg` and
`SHA256SUMS.txt`, with `docs/desktop-install.md` as the notes plus a compare
link to the previous `v*` tag. `bin/anki package --universal` builds the same
bundle locally.

There is no Apple developer certificate, so the app is only ad-hoc signed
(`APPLE_SIGNING_IDENTITY=-`) and macOS blocks the first launch until the
quarantine flag is cleared; `bin/install-anki` does that for people who use
it, and `docs/desktop-install.md` covers the manual route. Real signing and
notarisation would need an Apple certificate plus the notary secrets
upstream's `release.yml` already reads.

## Conventions

- Every source file starts with the project's copyright header (minilints
  checks it).
- Ports of Python behaviour name the Python they mirror in a comment
  (`_redraw_current_card` in reviewer.py, `av_refs_to_play_icons` in sound.py).
- Pure logic goes in `.ts` modules with vitest tests next to them;
  components stay thin. Rust gets unit tests in-module and integration tests
  in `desktop/tests/`.
- Translations: `import * as tr from "@generated/ftl"`; names are the
  camelCase of the Fluent ids (`studying-show-answer` -> `tr.studyingShowAnswer()`).
  Check a name exists with `grep "export function <name>" out/ts/lib/generated/ftl.ts`.
- Proto types: `@generated/anki/<file>_pb` (protobuf-es). Field names are
  camelCase; ids are `bigint`; request wrappers need every field
  (`PlainMessage`).
- CSS uses the theme variables from `ts/lib/sass` (`--canvas`, `--fg`,
  `--border`, `--state-new`, ...); the shell follows the system light/dark
  setting and passes `nightMode` to frames (`#night` on SvelteKit routes).
- Never modify `rslib/src/sync`, `rslib/src/storage/upgrades` or the
  collection schema. Adding backend RPCs or proto messages is fine.
- Do not read the user's real collection in tests; `--fresh` and
  `tempfile::tempdir()` collections only.
