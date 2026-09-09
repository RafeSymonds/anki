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
    import { isInteractiveTarget } from "./click-to-edit";
    import type { CardView } from "./reviewer";
    import { applyDesktopThemeToFrame } from "./theme";

    export let onCommand: (command: string) => void;
    export let onKeydown: (event: KeyboardEvent) => void;
    /** A click on card text, with that element's text (controls excluded). */
    export let onClick: ((text: string) => void) | null = null;
    export let nightMode = false;
    /** Called with which edges the card runs past, so the pane can show it. */
    export let onOverflow: ((above: boolean, below: boolean) => void) | null = null;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    type CardWindow = Window & Record<string, any>;

    let frame: HTMLIFrameElement;
    let ready = false;
    let pending: (() => void)[] = [];

    function win(): CardWindow | null {
        return (frame?.contentWindow as CardWindow | null) ?? null;
    }

    /** The text node under (x, y), if the point lies on its glyphs. */
    function textUnderPoint(doc: Document, x: number, y: number): string {
        const caret = (
            doc as Document & {
                caretRangeFromPoint?: (x: number, y: number) => Range | null;
            }
        ).caretRangeFromPoint?.(x, y);
        const node = caret?.startContainer;
        if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) {
            return "";
        }
        const range = doc.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
            if (
                x >= rect.left - 2 &&
                x <= rect.right + 2 &&
                y >= rect.top - 2 &&
                y <= rect.bottom + 2
            ) {
                return node.textContent ?? "";
            }
        }
        return "";
    }

    /**
     * A card taller than the pane scrolls inside the frame, but macOS hides
     * the scrollbar until you touch it, so a clipped card just looks broken.
     * Tell the pane which edges are cut instead. A tolerance of a pixel keeps
     * sub-pixel document heights from reporting a permanent overflow.
     */
    function reportOverflow(): void {
        const w = win();
        if (!onOverflow || !w?.document?.documentElement) {
            return;
        }
        const root = w.document.documentElement;
        const top = w.scrollY;
        const hidden = root.scrollHeight - root.clientHeight;
        onOverflow(top > 1, hidden - top > 1);
    }

    /** Watch the card document, which grows as images and answers land. */
    function watchOverflow(w: CardWindow): void {
        w.addEventListener("scroll", reportOverflow, { passive: true });
        w.addEventListener("resize", reportOverflow);
        new w.ResizeObserver(reportOverflow).observe(w.document.documentElement);
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
        applyDesktopThemeToFrame(frame);
        const w = win();
        if (!w) {
            return;
        }
        installBridgeHandler(w, (command) => onCommand(command));
        w.document.addEventListener("keydown", (event) => onKeydown(event));
        w.document.addEventListener("click", (event) => {
            const element = event.target as Element | null;
            if (!element || !onClick) {
                return;
            }
            const ancestors: string[] = [];
            for (let el = element.parentElement; el; el = el.parentElement) {
                ancestors.push(el.tagName);
            }
            if (
                isInteractiveTarget(element.tagName, ancestors) ||
                element.closest("[contenteditable], .replay-button")
            ) {
                return;
            }
            // Card text is often a bare text node inside the container, so
            // take the text under the pointer rather than the target's text.
            const text = textUnderPoint(w.document, event.clientX, event.clientY);
            if (text) {
                onClick(text);
            }
        });
        applyTheme();
        watchOverflow(w);
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
