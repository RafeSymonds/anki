<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Hosts the Svelte note editor (ts/routes/editor) for adding a note or
editing the card being reviewed, driven the way qt/aqt/editor.py drives it:
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

    export let mode: "add" | "current" = "add";
    export let noteId: bigint | null = null;
    export let cardId: bigint | null = null;
    export let deckId: bigint | null = null;
    export let nightMode = false;

    const dispatch = createEventDispatcher<{ close: void; changed: void }>();

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
            // Escape inside the editor closes it, as in the Qt windows.
            w.document.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    void requestClose();
                }
            });
        }
    }

    /** Flush pending field edits; resolves once the editor reports "saved". */
    export function saveNow(): Promise<void> {
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
