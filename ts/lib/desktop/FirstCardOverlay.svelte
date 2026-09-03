<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Shown once, above the answer buttons, the first time a profile reviews a
card. It does not take the keyboard: pressing 1-4 still answers.
-->
<script lang="ts">
    import { createEventDispatcher } from "svelte";

    import { answerGuide, type AnswerButtonInfo } from "./first-card";

    export let buttons: readonly AnswerButtonInfo[];

    const dispatch = createEventDispatcher<{ dismiss: void }>();

    $: rows = answerGuide(buttons);
</script>

<div class="guide" role="note" aria-label="How to answer">
    <h3>How to answer</h3>
    <p class="lede">
        Say how well you knew the answer. The time under each button is when you will
        see this card again.
    </p>
    <ul>
        {#each rows as row (row.ease)}
            <li>
                <span class="key ease{row.ease}">{row.ease}</span>
                <span class="name">{row.label}</span>
                <span class="interval">{row.interval}</span>
                <span class="why">{row.explanation}</span>
            </li>
        {/each}
    </ul>
    <button class="primary" on:click={() => dispatch("dismiss")}>Got it</button>
</div>

<style>
    .guide {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
        width: 460px;
        max-width: calc(100vw - 32px);
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius-medium);
        box-shadow: var(--shadow);
        padding: 14px 16px;
        text-align: start;
        z-index: 5;
    }
    .guide::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        border: 8px solid transparent;
        border-top-color: var(--border);
        transform: translateX(-50%);
    }
    h3 {
        margin: 0 0 4px;
        font-size: 1rem;
    }
    .lede {
        margin: 0 0 10px;
        color: var(--fg-subtle);
        font-size: 13px;
    }
    ul {
        list-style: none;
        margin: 0 0 12px;
        padding: 0;
        display: grid;
        grid-template-columns: auto auto auto 1fr;
        column-gap: 10px;
        row-gap: 6px;
        align-items: baseline;
        font-size: 13px;
    }
    li {
        display: contents;
    }
    .key {
        display: inline-block;
        min-width: 1.4em;
        text-align: center;
        border-radius: 4px;
        color: white;
        font-weight: 600;
        padding: 0 4px;
    }
    .ease1 {
        background: var(--state-again, #d9534f);
    }
    .ease2 {
        background: var(--state-hard, #6c757d);
    }
    .ease3 {
        background: var(--state-good, #5cb85c);
    }
    .ease4 {
        background: var(--state-easy, #5bc0de);
    }
    .name {
        font-weight: 600;
    }
    .interval {
        color: var(--fg-subtle);
        font-variant-numeric: tabular-nums;
    }
    .why {
        color: var(--fg);
    }
    button.primary {
        font: inherit;
        background: var(--button-primary-bg);
        color: white;
        border: 1px solid transparent;
        border-radius: var(--border-radius);
        padding: 5px 14px;
        cursor: pointer;
    }
</style>
