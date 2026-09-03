<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Empty Cards (qt/aqt/emptycards.py): the report of cards whose templates
render nothing, and the button that deletes them.
-->
<script lang="ts">
    import type { EmptyCardsReport } from "@generated/anki/card_rendering_pb";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    import { deleteEmptyCards, emptyCardsReportHtml } from "./maintenance";
    import Modal from "./Modal.svelte";

    export let report: EmptyCardsReport;

    const dispatch = createEventDispatcher<{
        close: void;
        notify: string;
        changed: void;
    }>();

    let keepNotes = true;
    let busy = false;

    async function onDelete(): Promise<void> {
        busy = true;
        try {
            const count = await deleteEmptyCards(report, keepNotes);
            dispatch("notify", tr.emptyCardsDeletedCount({ cards: count }));
            dispatch("changed");
            dispatch("close");
        } catch {
            // postProto has shown the error.
        } finally {
            busy = false;
        }
    }
</script>

<Modal title={tr.emptyCardsWindowTitle()} width="640px" on:close>
    <div class="report">{@html emptyCardsReportHtml(report.report)}</div>
    <svelte:fragment slot="footer">
        <label class="keep">
            <input type="checkbox" bind:checked={keepNotes} />
            {tr.emptyCardsPreserveNotesCheckbox()}
        </label>
        <button on:click={() => dispatch("close")}>{tr.actionsClose()}</button>
        <button class="primary" disabled={busy} on:click={onDelete}>
            {tr.emptyCardsDeleteButton()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .report {
        max-height: 60vh;
        overflow: auto;
    }
    .report :global(.allempty) {
        color: var(--accent-danger, red);
    }
    .keep {
        margin-inline-end: auto;
    }
</style>
