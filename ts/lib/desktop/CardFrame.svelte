<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The iframe cards are rendered in. It loads desktop/web/card.html, which
carries the reviewer bundle, and exposes the same _showQuestion/_showAnswer
calls Python makes on the Qt webview. Card templates run arbitrary HTML and
JS, so keeping them in their own document keeps them out of the shell.
-->
<script lang="ts">
    import { installBridgeHandler } from "./bridge";
    import type { CardView } from "./reviewer";

    export let onCommand: (command: string) => void;
    export let onKeydown: (event: KeyboardEvent) => void;
    export let nightMode = false;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    type CardWindow = Window & Record<string, any>;

    let frame: HTMLIFrameElement;
    let ready = false;
    let pending: (() => void)[] = [];

    function win(): CardWindow | null {
        return (frame?.contentWindow as CardWindow | null) ?? null;
    }

    function whenReady(fn: () => void): void {
        if (ready) {
            fn();
        } else {
            pending.push(fn);
        }
    }

    function applyTheme(): void {
        const root = win()?.document?.documentElement;
        if (!root) {
            return;
        }
        root.classList.toggle("night-mode", nightMode);
        root.dataset.bsTheme = nightMode ? "dark" : "light";
    }

    $: (nightMode, applyTheme());

    function onLoad(): void {
        const w = win();
        if (!w) {
            return;
        }
        installBridgeHandler(w, (command) => onCommand(command));
        w.document.addEventListener("keydown", (event) => onKeydown(event));
        applyTheme();
        ready = true;
        const queued = pending;
        pending = [];
        for (const fn of queued) {
            fn();
        }
    }

    export const view: CardView = {
        showQuestion: (question, answer, bodyClass) =>
            whenReady(() => win()?._showQuestion(question, answer, bodyClass)),
        showAnswer: (answer) => whenReady(() => win()?._showAnswer(answer, "")),
        showPreview: (html, bodyClass) =>
            whenReady(() => win()?._showAnswer(html, bodyClass)),
        drawFlag: (flag) => whenReady(() => win()?._drawFlag(flag)),
        drawMark: (marked) => whenReady(() => win()?._drawMark(marked)),
        getTypedAnswer: () => win()?.getTypedAnswer?.() ?? null,
        runStateMutation: async (key, js) => {
            const w = win();
            if (!w?.anki?.mutateNextCardStates) {
                return;
            }
            const AsyncFunction = w.eval("(async function () {}).constructor");
            const transform = new AsyncFunction("states", "customData", "ctx", js);
            await w.anki.mutateNextCardStates(key, transform);
        },
    };

    export function focus(): void {
        win()?.focus();
    }
</script>

<iframe
    bind:this={frame}
    src="/_desktop/card.html"
    title="card"
    on:load={onLoad}
></iframe>

<style>
    iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--canvas);
    }
</style>
