<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Hosts the Svelte note editor (ts/routes/editor) for adding a note, editing
the card being reviewed or the note selected in the browser, driven the way
qt/aqt/editor.py drives it:
wait for "editorReady", call loadNote(), and answer the close requests it
makes through FrontendService.
-->
<script context="module" lang="ts">
    /* eslint-disable @typescript-eslint/no-explicit-any */
    type EditorWindow = Window & Record<string, any>;

    /** What `getNoteInfo()` in NoteEditor.svelte reports about the loaded note. */
    export interface EditorNoteInfo {
        /** Null for a note that has not been added yet. */
        id: bigint | null;
        notetypeId: bigint;
        fields: string[];
    }

    /** The note shown by the editor running in `frame`; null when it is not
     * an editor or has not loaded a note. */
    export function editorNoteInfo(frame: Window | null): EditorNoteInfo | null {
        let raw: { id: string | null; mid: string; fields: string[] } | undefined;
        try {
            raw = (frame as EditorWindow | null)?.getNoteInfo?.();
        } catch {
            return null;
        }
        if (!raw?.mid) {
            return null;
        }
        const id = raw.id ? BigInt(raw.id) : 0n;
        return {
            id: id || null,
            notetypeId: BigInt(raw.mid),
            fields: raw.fields ?? [],
        };
    }
</script>

<script lang="ts">
    import { Bool, Empty } from "@generated/anki/generic_pb";
    import { getNote, getNotetypeNames } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import AddPreview from "./AddPreview.svelte";
    import { installBridgeHandler, parseBridgeCommand } from "./bridge";
    import { settingsGet, settingsSet } from "./desktop-api";
    import { registerFrontendHandler, typedHandler } from "./frontend-service";
    import {
        kindOfNotetype,
        type NotetypeKindOption,
        notetypeKindOptions,
    } from "./notetype-kinds";
    import { onRpcDone } from "./rpc-events";
    import { applyEditorStylesToFrame } from "./editor-theme";
    import { applyDesktopThemeToFrame } from "./theme";

    export let mode: "add" | "current" | "browser" = "add";
    export let noteId: bigint | null = null;
    export let cardId: bigint | null = null;
    export let deckId: bigint | null = null;
    export let nightMode = false;
    /** Keys pressed inside the editor document, for the host screen's shortcuts. */
    export let onKeydown: ((event: KeyboardEvent) => void) | null = null;

    const dispatch = createEventDispatcher<{
        close: void;
        changed: void;
        preview: void;
    }>();

    let frame: HTMLIFrameElement;
    let ready = false;
    // The quick picker (Basic / Both directions / Fill in the blank) above
    // the Add editor; "More types…" opens the editor's own chooser.
    let kinds: NotetypeKindOption[] = [];
    let currentNotetype: bigint | null = null;
    $: currentKind = kindOfNotetype(kinds, currentNotetype);

    async function loadKinds(): Promise<void> {
        const names = await getNotetypeNames({});
        kinds = notetypeKindOptions(names.entries, {
            basic: tr.notetypesBasicName(),
            reversed: tr.notetypesBasicReversedName(),
            cloze: tr.notetypesClozeName(),
        });
    }

    function pickKind(option: NotetypeKindOption): void {
        win()?.setNotetype?.(option.id.toString());
        currentNotetype = option.id;
    }

    function moreTypes(): void {
        (
            win()?.document.querySelector(".chooser-button") as HTMLElement | null
        )?.click();
    }

    function refreshCurrentNotetype(): void {
        currentNotetype = getNoteInfo()?.notetypeId ?? null;
    }

    /** The editor reports its state once it has a note, which can be after
     * the panel is up; look again a few times so the kind picker starts on
     * the type the editor is actually showing. */
    function pollCurrentNotetype(): void {
        let tries = 0;
        const look = (): void => {
            refreshCurrentNotetype();
            if (currentNotetype === null && ++tries < 8) {
                setTimeout(look, 150);
            }
        };
        look();
    }

    // Live preview of the card being typed (remembered per profile).
    const PREVIEW_KEY = "addPreviewOpen";
    let previewOpen = false;
    let previewInfo: EditorNoteInfo | null = null;
    let previewTimer: ReturnType<typeof setTimeout> | undefined;

    function togglePreview(): void {
        previewOpen = !previewOpen;
        void settingsSet("profile", PREVIEW_KEY, previewOpen).catch(() => undefined);
        if (previewOpen) {
            refreshPreview();
        }
    }

    /** Read the editor's note a moment after it changed. */
    function refreshPreview(): void {
        if (!previewOpen) {
            return;
        }
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
            previewInfo = getNoteInfo();
        }, 150);
    }
    let loadedNote: bigint | null = null;
    let savedResolvers: (() => void)[] = [];
    let unregister: (() => void)[] = [];

    $: url = `/editor/?mode=${mode}${nightMode ? "#night" : ""}`;

    function win(): EditorWindow | null {
        return (frame?.contentWindow as EditorWindow | null) ?? null;
    }

    async function load(): Promise<void> {
        const w = win();
        if (!ready || !w?.require) {
            return;
        }
        loadedNote = noteId;
        // Like editor.py's load_note(mid=note.mid): an existing note is
        // loaded with its notetype, since only the add editor has a chooser.
        let notetypeId: string | null = null;
        if (mode !== "add" && noteId !== null) {
            notetypeId = (await getNote({ nid: noteId })).notetypeId.toString();
        }
        const args = {
            nid: noteId?.toString() ?? null,
            notetypeId,
            focusTo: pendingFocus ?? 0,
            originalNoteId: null,
            reviewerCardId: cardId?.toString() ?? null,
            deckId: deckId?.toString() ?? null,
            initial: true,
        };
        pendingFocus = null;
        w.require("anki/ui").loaded.then(() => w.loadNote(args));
    }

    // Follow the reviewer to the next card.
    $: if (ready && noteId !== loadedNote) {
        void load();
    }

    function onBridge(command: string): void {
        const { cmd } = parseBridgeCommand(command);
        switch (cmd) {
            case "editorReady":
                ready = true;
                void load();
                if (mode === "add") {
                    void loadKinds();
                    pollCurrentNotetype();
                    void settingsGet("profile", PREVIEW_KEY)
                        .then((stored) => {
                            previewOpen = stored === true;
                            refreshPreview();
                        })
                        .catch(() => undefined);
                }
                break;
            case "saved": {
                const resolvers = savedResolvers;
                savedResolvers = [];
                for (const resolve of resolvers) {
                    resolve();
                }
                break;
            }
            case "key":
            case "blur":
            case "saveTags":
                dispatch("changed");
                refreshPreview();
                break;
            case "preview":
                // The browser editor's preview button (PreviewButton.svelte).
                dispatch("preview");
                break;
            case "editorState":
                // Fired as the editor loads a note, so the picker follows the chooser.
                if (mode === "add") {
                    refreshCurrentNotetype();
                    refreshPreview();
                }
                break;
            case "focus":
            case "ioImageLoaded":
            case "paste":
            case "cut":
            case "copy":
                break;
            default:
                console.warn("unhandled editor bridge command", command);
        }
    }

    function onLoad(): void {
        applyDesktopThemeToFrame(frame);
        applyEditorStylesToFrame(frame);
        const w = win();
        if (w) {
            installBridgeHandler(w, (command) => onBridge(command));
            // Escape inside the editor closes it, as in the Qt windows; the
            // browser's editor leaves that to the browser screen.
            w.document.addEventListener("keydown", (event) => {
                if (event.key === "Escape" && mode !== "browser") {
                    event.preventDefault();
                    void requestClose();
                } else {
                    onKeydown?.(event);
                }
            });
        }
    }

    /** The note the editor is showing (`getNoteInfo` in NoteEditor.svelte). */
    export function getNoteInfo(): EditorNoteInfo | null {
        return ready ? editorNoteInfo(win()) : null;
    }

    /** Reload after the note type changed in another frame, as
     * webview.py's on_operation_did_execute tells the page. */
    function onNotetypeChanged(): void {
        win()?.anki?.onOperationDidExecute?.({ notetype: true, noteText: true });
    }

    /** Put the caret in field `index`, now or once the note has loaded. */
    let pendingFocus: number | null = null;
    export function focusField(index: number): void {
        const w = win();
        if (ready && loadedNote === noteId && w?.focusField) {
            w.focusField(index);
        } else {
            pendingFocus = index;
        }
    }

    /** Flush pending field edits; resolves once the editor reports "saved". */
    export async function saveNow(): Promise<void> {
        // Saving while a reload is in flight would write the old note back.
        await reloading;
        return new Promise((resolve) => {
            const w = win();
            if (!ready || !w?.saveNow) {
                resolve();
                return;
            }
            savedResolvers.push(resolve);
            setTimeout(resolve, 2000);
            w.saveNow(false);
        });
    }

    let reloading: Promise<void> = Promise.resolve();

    /** Reload the note after another part of the app changed it, unless the
     * change came from this editor (`Editor.reload_note`, called from
     * `Browser.on_operation_did_execute` when note text changed). */
    export function reloadNote(from: Window | null = null): void {
        const w = win();
        if (!ready || !w?.reloadNote || from === w) {
            return;
        }
        reloading = Promise.resolve(w.reloadNote()).catch(() => undefined);
    }

    /** Close the way the window's close button would: the add editor may
     * ask to keep editing, the current-card editor saves first. */
    export async function requestClose(): Promise<void> {
        const w = win();
        if (mode === "add" && ready && w?.closeAddCards) {
            await w.closeAddCards();
        } else {
            await saveNow();
            dispatch("close");
        }
    }

    onMount(() => {
        const offRpcDone = onRpcDone((method) => {
            if (method === "updateNotetype" || method === "restoreNotetypeToStock") {
                onNotetypeChanged();
            }
        });
        unregister.push(() => offRpcDone());
        unregister.push(
            registerFrontendHandler(
                "closeAddCards",
                typedHandler(Bool, (input) => {
                    if (!input.val || confirm(tr.addingDiscardCurrentInput())) {
                        dispatch("close");
                    }
                    return new Empty();
                }),
            ),
            registerFrontendHandler(
                "closeEditCurrent",
                typedHandler(Empty, () => {
                    dispatch("close");
                    return new Empty();
                }),
            ),
        );
    });

    onDestroy(() => {
        for (const fn of unregister) {
            fn();
        }
    });
</script>

<div class="editor-panel" class:framed={mode === "add"}>
    {#if mode === "add" && kinds.length}
        <div class="kinds" role="radiogroup" aria-label="Kind of card">
            {#each kinds as option (option.kind)}
                <button
                    role="radio"
                    aria-checked={currentKind === option.kind}
                    class:active={currentKind === option.kind}
                    title={option.hint}
                    on:click={() => pickKind(option)}
                >
                    {option.label}
                </button>
            {/each}
            <button
                class="more"
                title={tr.notetypesChangeNoteTypeCtrlandn()}
                on:click={moreTypes}
            >
                More types…
            </button>
            <button
                class="preview-toggle"
                class:active={previewOpen}
                aria-pressed={previewOpen}
                title="Show the card this note will make"
                on:click={togglePreview}
            >
                Preview
            </button>
        </div>
    {/if}
    <div class="body" class:split={mode === "add" && previewOpen}>
        <iframe bind:this={frame} src={url} title="editor" on:load={onLoad}></iframe>
        {#if mode === "add" && previewOpen}
            <AddPreview info={previewInfo} {nightMode} />
        {/if}
    </div>
</div>

<style>
    /* A segmented control: which kind of card this note will make. */
    .kinds {
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 0 24px 12px;
    }
    .framed iframe,
    .framed .body > :global(*) {
        border-radius: var(--app-radius-large);
        box-shadow: var(--app-shadow-card);
        overflow: hidden;
    }
    .kinds button {
        font: inherit;
        font-size: 13px;
        color: var(--fg-subtle);
        background: var(--app-surface);
        border: 1px solid transparent;
        border-radius: var(--app-radius);
        padding: 7px 14px;
        cursor: pointer;
        box-shadow: var(--app-shadow-card);
        transition:
            background var(--transition),
            color var(--transition);
    }
    .kinds button:hover {
        color: var(--fg);
    }
    .kinds button.active {
        background: var(--app-accent);
        color: var(--app-accent-fg);
        font-weight: 600;
    }
    .kinds button.more {
        margin-inline-start: auto;
        background: transparent;
        box-shadow: none;
    }
    .kinds button.more:hover {
        background: var(--app-surface);
    }
    .kinds button.preview-toggle {
        margin-inline-start: 0;
    }
    .kinds button.preview-toggle.active {
        background: var(--app-accent-soft);
        color: var(--app-accent);
    }
    .editor-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
    }
    .body {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
    }
    /* The add screen floats the editor on the window ground; the reviewer
     * and browser embed it in a pane that already has its own frame. */
    .framed .body {
        padding: 0 24px 24px;
    }
    .body.split {
        grid-template-columns: minmax(0, 1fr) minmax(280px, 38%);
    }
    iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--app-surface);
    }
</style>
