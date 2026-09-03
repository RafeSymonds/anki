<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Hosts one of the existing SvelteKit pages (deck options, statistics, ...)
inside the shell. The page asks to be closed through FrontendService calls
that the Qt app answered from Python; here they are answered by the shell
for as long as the page is mounted.
-->
<script lang="ts">
    import { Empty } from "@generated/anki/generic_pb";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import { installBridgeHandler } from "./bridge";
    import { registerFrontendHandler, typedHandler } from "./frontend-service";
    import { applyDesktopThemeToFrame } from "./theme";

    export let src: string;
    export let nightMode = false;

    const dispatch = createEventDispatcher<{ close: void }>();

    let frame: HTMLIFrameElement;
    let unregister: (() => void)[] = [];

    $: url = nightMode ? `${src}#night` : src;

    const closeRequests = [
        "deckOptionsRequireClose",
        "importDialogRequireClose",
        "closeAddCards",
        "closeEditCurrent",
    ];

    onMount(() => {
        for (const method of closeRequests) {
            unregister.push(
                registerFrontendHandler(method, () => {
                    dispatch("close");
                    return new Empty().toBinary();
                }),
            );
        }
        unregister.push(
            registerFrontendHandler(
                "deckOptionsReady",
                typedHandler(Empty, () => new Empty()),
            ),
            registerFrontendHandler(
                "importDone",
                typedHandler(Empty, () => new Empty()),
            ),
        );
    });

    onDestroy(() => {
        for (const fn of unregister) {
            fn();
        }
        unregister = [];
    });

    function onLoad(): void {
        applyDesktopThemeToFrame(frame);
        const win = frame?.contentWindow;
        if (win) {
            installBridgeHandler(win, (command) => {
                if (command === "close") {
                    dispatch("close");
                } else {
                    console.warn(
                        "unhandled bridge command from embedded page",
                        command,
                    );
                }
            });
        }
    }

    /** Ask the page whether it is fine to leave; deck options prompts on unsaved changes. */
    export function requestClose(): void {
        const win = frame?.contentWindow as
            | (Window & { anki?: { deckOptionsPendingChanges?: () => Promise<void> } })
            | null;
        const pending = win?.anki?.deckOptionsPendingChanges;
        if (pending) {
            void pending();
        } else {
            dispatch("close");
        }
    }
</script>

<iframe bind:this={frame} src={url} title="page" on:load={onLoad}></iframe>

<style>
    iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--canvas);
    }
</style>
