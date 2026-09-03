<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The deck overview: name, description, today's counts and Study Now. When
nothing is left to study it shows the congratulations page instead, with
direct routes to the deck options and to studying more.
-->
<script lang="ts">
    import type { Deck } from "@generated/anki/decks_pb";
    import type { DeckTreeNode } from "@generated/anki/decks_pb";
    import type { CongratsInfoResponse } from "@generated/anki/scheduler_pb";
    import { UnburyDeckRequest_Mode } from "@generated/anki/scheduler_pb";
    import {
        congratsInfo,
        emptyFilteredDeck,
        getDeck,
        getQueuedCards,
        rebuildFilteredDeck,
        renderMarkdown,
        unburyDeck,
    } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import CongratsPage from "../../routes/congrats/CongratsPage.svelte";
    import { installBridgeHandler, removeBridgeHandler } from "./bridge";
    import { findNode } from "./decks";

    export let deckId: bigint;
    export let tree: DeckTreeNode | null;
    /** Bumped by the parent to force a reload. */
    export let version = 0;

    const dispatch = createEventDispatcher<{
        study: void;
        options: bigint;
        changed: void;
        customStudy: void;
    }>();

    /** Rebuild / Empty for filtered decks (overview.py _link_handler). */
    async function rebuild(): Promise<void> {
        await rebuildFilteredDeck({ did: deckId });
        dispatch("changed");
    }

    async function empty(): Promise<void> {
        await emptyFilteredDeck({ did: deckId });
        dispatch("changed");
    }

    // The congrats page's links (bridgeLink) call bridgeCommand in this window.
    onMount(() =>
        installBridgeHandler(window, (command) => {
            if (command === "customStudy") {
                dispatch("customStudy");
            } else if (command === "unbury") {
                void unbury();
            }
        }));
    onDestroy(() => removeBridgeHandler(window));

    let deck: Deck | null = null;
    let node: DeckTreeNode | undefined;
    let counts: [number, number, number] = [0, 0, 0];
    let finished = false;
    let info: CongratsInfoResponse | null = null;
    let description = "";
    let loading = true;

    async function load(id: bigint, root: DeckTreeNode | null): Promise<void> {
        loading = true;
        deck = await getDeck({ did: id });
        node = root ? findNode(root, id) : undefined;
        const queued = await getQueuedCards({
            fetchLimit: 1,
            intradayLearningOnly: false,
        });
        counts = [queued.newCount, queued.learningCount, queued.reviewCount];
        finished = queued.cards.length === 0;
        info = finished ? await congratsInfo({}) : null;
        description = await describe(deck);
        loading = false;
    }

    async function describe(deck: Deck): Promise<string> {
        if (deck.kind.case === "filtered") {
            return [
                tr.studyingThisIsASpecialDeckFor(),
                tr.studyingCardsWillBeAutomaticallyReturnedTo(),
                tr.studyingDeletingThisDeckFromTheDeck(),
            ].join(" ");
        }
        if (deck.kind.case === "normal") {
            const text = deck.kind.value.description;
            if (deck.kind.value.markdownDescription) {
                return (await renderMarkdown({ markdown: text, sanitize: true })).val;
            }
            return text;
        }
        return "";
    }

    $: (void load(deckId, tree), version);

    $: buried = node
        ? [
              node.newCount - counts[0],
              node.learnCount - counts[1],
              node.reviewCount - counts[2],
          ]
        : [0, 0, 0];

    async function unbury(): Promise<void> {
        await unburyDeck({ deckId, mode: UnburyDeckRequest_Mode.ALL });
        dispatch("changed");
    }

    function signed(n: number): string {
        if (!n) {
            return "";
        }
        return n > 0 ? `+${n}` : `${n}`;
    }
</script>

<div class="overview">
    {#if loading}
        <p class="subtle">…</p>
    {:else if deck}
        <h1>{deck.name}</h1>
        {#if description}
            <div class="description" class:filtered={deck.kind.case === "filtered"}>
                {@html description}
            </div>
        {/if}

        {#if finished && info}
            <div class="congrats">
                <CongratsPage {info} refreshPeriodically={true} />
                <div class="actions">
                    <button on:click={() => dispatch("options", deckId)}>
                        {tr.actionsOptions()}
                    </button>
                    {#if deck.kind.case === "filtered"}
                        <button on:click={rebuild}>{tr.actionsRebuild()}</button>
                        <button on:click={empty}>{tr.studyingEmpty()}</button>
                    {/if}
                    {#if info.haveSchedBuried || info.haveUserBuried}
                        <button on:click={unbury}>{tr.studyingUnbury()}</button>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="study">
                <table class="counts">
                    <tbody>
                        <tr>
                            <td>{tr.actionsNew()}:</td>
                            <td>
                                <b><span class="new-count">{counts[0]}</span></b>
                                <span
                                    class="bury-count"
                                    title={tr.studyingCountsDiffer()}
                                >
                                    {signed(buried[0])}
                                </span>
                            </td>
                        </tr>
                        <tr>
                            <td>{tr.schedulingLearning()}:</td>
                            <td>
                                <b><span class="learn-count">{counts[1]}</span></b>
                                <span
                                    class="bury-count"
                                    title={tr.studyingCountsDiffer()}
                                >
                                    {signed(buried[1])}
                                </span>
                            </td>
                        </tr>
                        <tr>
                            <td>{tr.studyingToReview()}:</td>
                            <td>
                                <b><span class="review-count">{counts[2]}</span></b>
                                <span
                                    class="bury-count"
                                    title={tr.studyingCountsDiffer()}
                                >
                                    {signed(buried[2])}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <!-- svelte-ignore a11y-autofocus -->
                <button class="primary" autofocus on:click={() => dispatch("study")}>
                    {tr.studyingStudyNow()}
                </button>
            </div>
            <div class="actions">
                <button
                    title={tr.actionsShortcutKey({ val: "O" })}
                    on:click={() => dispatch("options", deckId)}
                >
                    {tr.actionsOptions()}
                </button>
                {#if deck.kind.case === "filtered"}
                    <button on:click={rebuild}>{tr.actionsRebuild()}</button>
                    <button on:click={empty}>{tr.studyingEmpty()}</button>
                {:else}
                    <button
                        title={tr.actionsShortcutKey({ val: "C" })}
                        on:click={() => dispatch("customStudy")}
                    >
                        {tr.actionsCustomStudy()}
                    </button>
                {/if}
                {#if buried.some((n) => n !== 0)}
                    <button
                        title={tr.actionsShortcutKey({ val: "U" })}
                        on:click={unbury}
                    >
                        {tr.studyingUnbury()}
                    </button>
                {/if}
            </div>
        {/if}
    {/if}
</div>

<style>
    .overview {
        max-width: 640px;
        margin: 0 auto;
        padding: 48px 32px;
        text-align: center;
    }
    h1 {
        font-size: 1.6rem;
        font-weight: 600;
        margin: 0 0 16px;
    }
    .description {
        margin: 0 auto 24px;
        max-width: 520px;
        text-align: start;
        color: var(--fg);
    }
    .description.filtered {
        color: var(--fg-subtle);
    }
    .study {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 40px;
        margin: 24px 0;
    }
    .counts {
        border-collapse: collapse;
        font-size: 1.05rem;
    }
    .counts td {
        padding: 4px 8px;
        text-align: start;
    }
    .counts td:last-child {
        text-align: end;
    }
    .new-count {
        color: var(--state-new);
    }
    .learn-count {
        color: var(--state-learn);
    }
    .review-count {
        color: var(--state-review);
    }
    .bury-count {
        color: var(--fg-disabled);
        font-weight: bold;
        margin-inline-start: 2px;
    }
    .bury-count:empty {
        display: none;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 6px 14px;
        cursor: pointer;
    }
    button:hover {
        border-color: var(--button-hover-border);
    }
    button.primary {
        background: var(--button-primary-bg);
        color: white;
        border-color: transparent;
        font-size: 1.05rem;
        padding: 10px 24px;
    }
    .actions {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin-top: 16px;
    }
    .congrats :global(.congrats) {
        text-align: start;
    }
    .subtle {
        color: var(--fg-subtle);
    }
</style>
