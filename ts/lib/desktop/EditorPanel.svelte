<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Hosts the Svelte note editor (ts/routes/editor) for adding a note, editing
the card being reviewed or the note selected in the browser, driven the way
qt/aqt/editor.py drives it:
wait for "editorReady", call loadNote(), and answer the close requests it
makes through FrontendService.
-->
<script lang="ts">
    import { Bool, Empty } from "@generated/anki/generic_pb";
    import { getNote } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import { installBridgeHandler, parseBridgeCommand } from "./bridge";
    import { registerFrontendHandler, typedHandler } from "./frontend-service";

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

    /* eslint-disable @typescript-eslint/no-explicit-any */
    type EditorWindow = Window & Record<string, any>;

    let frame: HTMLIFrameElement;
    let ready = false;
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
            focusTo: 0,
            originalNoteId: null,
            reviewerCardId: cardId?.toString() ?? null,
            deckId: deckId?.toString() ?? null,
            initial: true,
        };
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
                break;
            case "preview":
                // The browser editor's preview button (PreviewButton.svelte).
                dispatch("preview");
                break;
            case "focus":
            case "editorState":
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

<iframe bind:this={frame} src={url} title="editor" on:load={onLoad}></iframe>

<style>
    iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--canvas);
    }
</style>
