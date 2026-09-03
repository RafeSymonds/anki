<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The card info page (ts/routes/card-info) for the browser's current card,
following the current row the way qt/aqt/browser/card_info.py calls
`anki.updateCard`.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    export let cardId: bigint | null;
    export let nightMode = false;

    const dispatch = createEventDispatcher<{ close: void }>();

    type InfoWindow = Window & {
        anki?: { updateCard?: (id: string) => Promise<void> };
    };

    let frame: HTMLIFrameElement;
    let loadedId: bigint | null = cardId;
    const src = `/card-info/${cardId ?? ""}${nightMode ? "#night" : ""}`;

    $: if (cardId !== loadedId) {
        loadedId = cardId;
        const win = frame?.contentWindow as InfoWindow | null;
        if (win?.anki?.updateCard) {
            void win.anki.updateCard(cardId?.toString() ?? "");
        } else if (frame) {
            frame.src = `/card-info/${cardId ?? ""}${nightMode ? "#night" : ""}`;
        }
    }
</script>

<div class="card-info">
    <div class="bar">
        <span class="title">{tr.actionsCardInfo()}</span>
        <button on:click={() => dispatch("close")}>{tr.actionsClose()}</button>
    </div>
    <iframe bind:this={frame} {src} title="card info"></iframe>
</div>

<style>
    .card-info {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
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
    button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 2px 10px;
        cursor: pointer;
    }
    iframe {
        flex: 1;
        width: 100%;
        border: 0;
        background: var(--canvas);
    }
</style>
