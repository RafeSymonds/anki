<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

What a new user sees instead of an empty deck table: what Anki does in two
sentences and the three ways to get cards.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    import { openLink } from "./desktop-api";

    const dispatch = createEventDispatcher<{ add: void; import: void }>();

    const sharedDecks = "https://ankiweb.net/shared/decks";
</script>

<div class="empty-state">
    <h1>Welcome to Anki</h1>
    <p class="lede">
        Anki shows you a card, you say how well you knew the answer, and it schedules
        the next review so you see hard cards often and easy ones rarely. A few minutes
        a day is enough.
    </p>
    <div class="choices">
        <button class="choice primary" on:click={() => dispatch("add")}>
            <span class="label">Make your first cards</span>
            <span class="hint">Type a question and an answer; that is one card.</span>
        </button>
        <button class="choice" on:click={() => dispatch("import")}>
            <span class="label">{tr.decksImportFile()}</span>
            <span class="hint">An .apkg deck or a spreadsheet exported as CSV.</span>
        </button>
        <button class="choice" on:click={() => void openLink(sharedDecks)}>
            <span class="label">{tr.decksGetShared()}</span>
            <span class="hint">
                Decks other people made, from languages to medicine.
            </span>
        </button>
    </div>
</div>

<style>
    .empty-state {
        max-width: 560px;
        margin: 0 auto;
        padding: 56px 32px;
        text-align: center;
    }
    h1 {
        font-size: 1.7rem;
        font-weight: 600;
        margin: 0 0 12px;
    }
    .lede {
        color: var(--fg-subtle);
        margin: 0 auto 28px;
        max-width: 46ch;
    }
    .choices {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .choice {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        text-align: start;
        font: inherit;
        color: var(--fg);
        background: var(--canvas-elevated);
        border: 1px solid var(--border);
        border-radius: var(--border-radius-medium);
        padding: 12px 16px;
        cursor: pointer;
    }
    .choice:hover {
        border-color: var(--button-hover-border);
    }
    .choice.primary {
        border-color: var(--button-primary-bg);
    }
    .label {
        font-weight: 600;
    }
    .hint {
        font-size: 13px;
        color: var(--fg-subtle);
    }
</style>
