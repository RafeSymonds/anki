<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The browser's card preview (qt/aqt/browser/previewer.py): the selected card
rendered into a card frame, with a button to flip between question and
answer.
-->
<script lang="ts">
    import type { Card } from "@generated/anki/cards_pb";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import CardFrame from "../CardFrame.svelte";
    import type { PreviewSide } from "./preview";
    import { PreviewRenderer } from "./preview";

    export let card: Card | null;
    export let nightMode = false;
    export let onKeydown: (event: KeyboardEvent) => void = () => {};

    const dispatch = createEventDispatcher<{ close: void }>();
    const renderer = new PreviewRenderer();

    let frame: CardFrame;
    let side: PreviewSide = "question";
    let shownCardId: bigint | null = null;

    $: renderer.setNightMode(nightMode);

    // A new card starts on the question side (`Previewer._render_scheduled`).
    $: if (card?.id !== shownCardId) {
        shownCardId = card?.id ?? null;
        side = "question";
        void renderer.render(card, side);
    }

    function flip(): void {
        side = side === "question" ? "answer" : "question";
        void renderer.render(card, side, false);
    }

    /** Re-render after the note changed. */
    export function refresh(): void {
        void renderer.render(card, side, false);
    }

    onMount(() => {
        renderer.attach(frame.view);
        void renderer.render(card, side);
    });

    onDestroy(() => renderer.stop());
</script>

<div class="preview">
    <div class="bar">
        <span class="title">{tr.actionsPreview()}</span>
        <button on:click={flip} disabled={!card}>
            {side === "question" ? tr.studyingShowAnswer() : tr.browsingQuestion()}
        </button>
        <button on:click={() => dispatch("close")}>{tr.actionsClose()}</button>
    </div>
    <div class="frame">
        <CardFrame bind:this={frame} {nightMode} onCommand={() => {}} {onKeydown} />
    </div>
</div>

<style>
    .preview {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
    }
    .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-bottom: 1px solid var(--border);
        background: var(--canvas-elevated);
    }
    .title {
        flex: 1;
        font-weight: 600;
    }
    .frame {
        flex: 1;
        min-height: 0;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 2px 10px;
        cursor: pointer;
    }
</style>
