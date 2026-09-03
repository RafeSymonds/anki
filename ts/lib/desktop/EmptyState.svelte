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
    import { GETTING_STARTED_URL } from "./links";

    const dispatch = createEventDispatcher<{ add: void; import: void; shared: void }>();
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
        <button class="choice" on:click={() => dispatch("shared")}>
            <span class="label">Get a deck someone else made</span>
            <span class="hint">
                Thousands are shared free on AnkiWeb, from languages to medicine.
            </span>
        </button>
        <button class="choice" on:click={() => dispatch("import")}>
            <span class="label">{tr.decksImportFile()}</span>
            <span class="hint">An .apkg deck or a spreadsheet exported as CSV.</span>
        </button>
    </div>
    <p class="more">
        New to spaced repetition?
        <a
            href={GETTING_STARTED_URL}
            on:click|preventDefault={() => void openLink(GETTING_STARTED_URL)}
        >
            Read the getting started guide
        </a>
    </p>
</div>

<style>
    .empty-state {
        max-width: 560px;
        margin: 0 auto;
        padding: 48px 32px;
        text-align: center;
    }
    h1 {
        font-family: var(--app-font-display);
        font-size: 32px;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 0 0 12px;
        text-wrap: balance;
    }
    .lede {
        color: var(--fg-subtle);
        margin: 0 auto 28px;
        max-width: 46ch;
        line-height: 1.55;
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
        gap: 3px;
        text-align: start;
        font: inherit;
        color: var(--fg);
        background: var(--app-surface);
        border: 1px solid transparent;
        border-radius: var(--app-radius);
        padding: 14px 18px;
        cursor: pointer;
        box-shadow: var(--app-shadow-card);
        transition:
            border-color var(--transition),
            transform var(--transition);
    }
    .choice:hover {
        border-color: var(--app-accent);
        transform: translateY(-1px);
    }
    .choice.primary {
        background: var(--app-accent);
        color: var(--app-accent-fg);
    }
    .choice.primary .hint {
        color: inherit;
        opacity: 0.82;
    }
    .label {
        font-family: var(--app-font-display);
        font-weight: 600;
        font-size: 15px;
    }
    .hint {
        font-size: 13px;
        color: var(--fg-subtle);
    }
    .more {
        margin: 24px 0 0;
        font-size: 13px;
        color: var(--fg-subtle);
    }
    .more a {
        color: var(--fg-link);
    }
</style>
