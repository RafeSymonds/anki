<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The deck overview: what is waiting today, one button to start, and a plain
account of how this deck is scheduled with the settings behind it. When
nothing is left it shows the congratulations page instead, with routes to
more cards and to the settings that decide how much comes back tomorrow.
-->
<script lang="ts">
    import type { DeckConfig_Config } from "@generated/anki/deck_config_pb";
    import type { Deck } from "@generated/anki/decks_pb";
    import type { DeckTreeNode } from "@generated/anki/decks_pb";
    import type { CongratsInfoResponse } from "@generated/anki/scheduler_pb";
    import { UnburyDeckRequest_Mode } from "@generated/anki/scheduler_pb";
    import {
        congratsInfo,
        customStudyDefaults,
        emptyFilteredDeck,
        extendLimits,
        getAllConfig,
        getDeck,
        getDeckConfig,
        getQueuedCards,
        rebuildFilteredDeck,
        renderMarkdown,
        schedTimingToday,
        unburyDeck,
    } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import CongratsPage from "../../routes/congrats/CongratsPage.svelte";
    import {
        newCardsConsequence,
        reviewLimitConsequence,
    } from "../../routes/deck-options/consequences";
    import { installBridgeHandler, removeBridgeHandler } from "./bridge";
    import { findNode, isFreshCollection } from "./decks";
    import EmptyState from "./EmptyState.svelte";
    import type { LimitNotice } from "./limits";
    import { effectiveLimits, limitNotices } from "./limits";
    import { estimatedMinutes, retentionSummary } from "./study-settings";

    export let deckId: bigint;
    export let tree: DeckTreeNode | null;
    /** Bumped by the parent to force a reload. */
    export let version = 0;

    const dispatch = createEventDispatcher<{
        study: void;
        options: bigint;
        studySettings: bigint;
        changed: void;
        customStudy: void;
        add: void;
        import: void;
        shared: void;
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
        }),
    );
    onDestroy(() => removeBridgeHandler(window));

    let deck: Deck | null = null;
    let node: DeckTreeNode | undefined;
    let counts: [number, number, number] = [0, 0, 0];
    let finished = false;
    let info: CongratsInfoResponse | null = null;
    let description = "";
    let loading = true;
    let notices: LimitNotice[] = [];
    let config: DeckConfig_Config | null = null;
    let fsrs = false;
    let limits = { newPerDay: 20, reviewsPerDay: 200 };
    $: fresh = tree !== null && isFreshCollection(tree);
    $: total = counts[0] + counts[1] + counts[2];
    $: filtered = deck?.kind.case === "filtered";

    async function load(id: bigint, root: DeckTreeNode | null): Promise<void> {
        // Only the first load shows a placeholder; a refresh keeps the
        // previous numbers on screen instead of blanking the page.
        loading = deck === null || deck.id !== id;
        deck = await getDeck({ did: id });
        node = root ? findNode(root, id) : undefined;
        const queued = await getQueuedCards({
            fetchLimit: 1,
            intradayLearningOnly: false,
        });
        counts = [queued.newCount, queued.learningCount, queued.reviewCount];
        finished = queued.cards.length === 0;
        info = finished ? await congratsInfo({}) : null;
        await loadSettings(deck);
        notices = info ? await loadNotices(deck, info) : [];
        description = await describe(deck);
        loading = false;
    }

    /** The deck's limits and algorithm, for the panel that explains them. */
    async function loadSettings(deck: Deck): Promise<void> {
        if (deck.kind.case !== "normal") {
            config = null;
            return;
        }
        config =
            (await getDeckConfig({ dcid: deck.kind.value.configId })).config ?? null;
        fsrs = await fsrsEnabled();
        const timing = await schedTimingToday({});
        limits = effectiveLimits(deck, config, timing.daysElapsed);
    }

    /** Whether the collection schedules with FSRS; it is a collection-level
     * flag that has no typed config key, so the raw config is read. */
    async function fsrsEnabled(): Promise<boolean> {
        try {
            const response = await getAllConfig({}, { alertOnError: false });
            const all = JSON.parse(new TextDecoder().decode(response.json)) as Record<
                string,
                unknown
            >;
            return all["fsrs"] === true;
        } catch {
            return false;
        }
    }

    /** The numbers behind "the daily limit has been reached". */
    async function loadNotices(
        deck: Deck,
        info: CongratsInfoResponse,
    ): Promise<LimitNotice[]> {
        if (!info.newRemaining && !info.reviewRemaining) {
            return [];
        }
        const defaults = await customStudyDefaults({ deckId: deck.id });
        return limitNotices(info, defaults, limits);
    }

    /** One click more for today, through the same call custom study uses. */
    async function extend(notice: LimitNotice): Promise<void> {
        await extendLimits({
            deckId,
            newDelta: notice.kind === "new" ? notice.step : 0,
            reviewDelta: notice.kind === "review" ? notice.step : 0,
        });
        dispatch("changed");
    }

    function noticeText(notice: LimitNotice): string {
        return notice.kind === "new"
            ? `Today's limit of ${notice.limit} new cards is done. ${notice.waiting} more new cards are waiting.`
            : `Today's limit of ${notice.limit} reviews is done. ${notice.waiting} more cards are due.`;
    }

    function extendLabel(notice: LimitNotice): string {
        return notice.kind === "new"
            ? `Study ${notice.step} more new cards today`
            : `Review ${notice.step} more cards today`;
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

    /** Roughly how long today's cards take, at ten seconds each. */
    function minutesToday(cards: number): string {
        const minutes = Math.max(1, Math.round((cards * 10) / 60));
        return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
    }

    /** Width of each band in the bar above Study Now. */
    function share(count: number): string {
        return total > 0 ? `${(count / total) * 100}%` : "0%";
    }
</script>

<div class="overview">
    {#if fresh}
        <EmptyState
            on:add={() => dispatch("add")}
            on:import={() => dispatch("import")}
            on:shared={() => dispatch("shared")}
        />
    {:else if loading}
        <p class="subtle">…</p>
    {:else if deck}
        <header>
            <h1>{deck.name}</h1>
            {#if description}
                <div class="description" class:filtered>
                    {@html description}
                </div>
            {/if}
        </header>

        {#if finished && info}
            <div class="card congrats">
                <CongratsPage {info} refreshPeriodically={true} />
                {#each notices as notice (notice.kind)}
                    <div class="limit-notice">
                        <p>{noticeText(notice)}</p>
                        {#if notice.step > 0}
                            <button class="primary" on:click={() => extend(notice)}>
                                {extendLabel(notice)}
                            </button>
                        {/if}
                    </div>
                {/each}
                <div class="actions">
                    <button on:click={() => dispatch("options", deckId)}>
                        {tr.actionsOptions()}
                    </button>
                    {#if filtered}
                        <button on:click={rebuild}>{tr.actionsRebuild()}</button>
                        <button on:click={empty}>{tr.studyingEmpty()}</button>
                    {/if}
                    {#if info.haveSchedBuried || info.haveUserBuried}
                        <button on:click={unbury}>{tr.studyingUnbury()}</button>
                    {/if}
                </div>
            </div>

            <div class="card next">
                <h2>While you wait for tomorrow</h2>
                <div class="next-choices">
                    <button class="next-choice" on:click={() => dispatch("add")}>
                        <span class="label">Make more cards</span>
                        <span class="hint">Add to this deck yourself.</span>
                    </button>
                    <button class="next-choice" on:click={() => dispatch("shared")}>
                        <span class="label">Get a shared deck</span>
                        <span class="hint">Thousands are free on AnkiWeb.</span>
                    </button>
                    {#if !filtered}
                        <button
                            class="next-choice"
                            on:click={() => dispatch("customStudy")}
                        >
                            <span class="label">{tr.actionsCustomStudy()}</span>
                            <span class="hint">Study ahead or review past cards.</span>
                        </button>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="card study">
                <div class="counts">
                    <div class="count-row">
                        <span class="dot new" aria-hidden="true"></span>
                        <span class="count-label">{tr.actionsNew()}</span>
                        <span class="count new-count">{counts[0]}</span>
                        <span class="bury-count" title={tr.studyingCountsDiffer()}>
                            {signed(buried[0])}
                        </span>
                    </div>
                    <div class="count-row">
                        <span class="dot learn" aria-hidden="true"></span>
                        <span class="count-label">{tr.schedulingLearning()}</span>
                        <span class="count learn-count">{counts[1]}</span>
                        <span class="bury-count" title={tr.studyingCountsDiffer()}>
                            {signed(buried[1])}
                        </span>
                    </div>
                    <div class="count-row">
                        <span class="dot review" aria-hidden="true"></span>
                        <span class="count-label">{tr.studyingToReview()}</span>
                        <span class="count review-count">{counts[2]}</span>
                        <span class="bury-count" title={tr.studyingCountsDiffer()}>
                            {signed(buried[2])}
                        </span>
                    </div>
                </div>

                <div class="start">
                    <!-- svelte-ignore a11y-autofocus -->
                    <button
                        class="primary"
                        autofocus
                        on:click={() => dispatch("study")}
                    >
                        {tr.studyingStudyNow()}
                    </button>
                    <p class="estimate">
                        {total}
                        {total === 1 ? "card" : "cards"} waiting, {minutesToday(total)}
                    </p>
                </div>

                <div class="bar" aria-hidden="true">
                    <span class="band new" style="width: {share(counts[0])}"></span>
                    <span class="band learn" style="width: {share(counts[1])}"></span>
                    <span class="band review" style="width: {share(counts[2])}"></span>
                </div>
            </div>

            {#if !filtered}
                <div class="card explain">
                    <h2>How this deck is scheduled</h2>
                    <p class="plain">
                        Anki shows a card again just before you would forget it. How you
                        rate a card decides when it comes back: Again in minutes, Easy
                        in days or months.
                    </p>
                    <ul class="settings">
                        <li>
                            <span class="setting">
                                {limits.newPerDay} new cards a day
                            </span>
                            <span class="because">
                                {newCardsConsequence(limits.newPerDay)}
                            </span>
                        </li>
                        <li>
                            <span class="setting">
                                Up to {limits.reviewsPerDay} reviews a day
                            </span>
                            <span class="because">
                                {reviewLimitConsequence(
                                    limits.reviewsPerDay,
                                    limits.newPerDay,
                                )}
                            </span>
                        </li>
                        <li>
                            <span class="setting">
                                {#if fsrs}
                                    Aiming to remember {Math.round(
                                        (config?.desiredRetention || 0.9) * 100,
                                    )}%
                                {:else}
                                    Intervals grow as you keep getting a card right
                                {/if}
                            </span>
                            <span class="because">
                                {#if fsrs}
                                    {retentionSummary(config?.desiredRetention || 0.9)}
                                {:else}
                                    Each correct answer multiplies the wait; a lapse
                                    sends the card back to learning.
                                {/if}
                            </span>
                        </li>
                    </ul>
                    <p class="estimate">
                        At this rate, studying takes about {estimatedMinutes(limits)} minutes
                        a day once your reviews build up.
                    </p>
                    <div class="actions">
                        <button
                            class="primary quiet"
                            on:click={() => dispatch("studySettings", deckId)}
                        >
                            Adjust studying
                        </button>
                        <button
                            title={tr.actionsShortcutKey({ val: "O" })}
                            on:click={() => dispatch("options", deckId)}
                        >
                            {tr.actionsOptions()}
                        </button>
                        <button
                            title={tr.actionsShortcutKey({ val: "C" })}
                            on:click={() => dispatch("customStudy")}
                        >
                            {tr.actionsCustomStudy()}
                        </button>
                        {#if buried.some((n) => n !== 0)}
                            <button
                                title={tr.actionsShortcutKey({ val: "U" })}
                                on:click={unbury}
                            >
                                {tr.studyingUnbury()}
                            </button>
                        {/if}
                    </div>
                </div>
            {:else}
                <div class="card explain">
                    <h2>This is a filtered deck</h2>
                    <p class="plain">
                        It gathers cards from your other decks by a search, and returns
                        them when you are done.
                    </p>
                    <div class="actions">
                        <button on:click={() => dispatch("options", deckId)}>
                            {tr.actionsOptions()}
                        </button>
                        <button on:click={rebuild}>{tr.actionsRebuild()}</button>
                        <button on:click={empty}>{tr.studyingEmpty()}</button>
                        {#if buried.some((n) => n !== 0)}
                            <button on:click={unbury}>{tr.studyingUnbury()}</button>
                        {/if}
                    </div>
                </div>
            {/if}
        {/if}
    {/if}
</div>

<style>
    .overview {
        max-width: 680px;
        margin: 0 auto;
        padding: 8px 32px 56px;
    }
    header {
        margin-bottom: 20px;
    }
    h1 {
        font-family: var(--app-font-display);
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 0 0 6px;
        text-wrap: balance;
    }
    h2 {
        font-family: var(--app-font-display);
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--fg-subtle);
        margin: 0 0 10px;
    }
    .description {
        color: var(--fg-subtle);
        line-height: 1.5;
    }
    .description.filtered {
        font-size: 13px;
    }
    .card {
        background: var(--app-surface);
        border-radius: var(--app-radius-large);
        box-shadow: var(--app-shadow-card);
        padding: 22px 24px;
        margin-bottom: 16px;
    }
    .study {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 240px);
        gap: 28px;
        align-items: center;
    }
    .counts {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .count-row {
        display: grid;
        grid-template-columns: 10px minmax(0, 1fr) auto auto;
        align-items: baseline;
        gap: 10px;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
    }
    .dot.new {
        background: var(--state-new);
    }
    .dot.learn {
        background: var(--state-learn);
    }
    .dot.review {
        background: var(--state-review);
    }
    .count-label {
        color: var(--fg-subtle);
    }
    .count {
        font-family: var(--app-font-display);
        font-size: 22px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
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
        color: var(--fg-faint);
        font-size: 12px;
    }
    .bury-count:empty {
        display: none;
    }
    .start {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    /* Today's mix, across the foot of the card. */
    .bar {
        grid-column: 1 / -1;
        display: flex;
        height: 6px;
        border-radius: 999px;
        overflow: hidden;
        background: var(--app-surface-sunken);
    }
    .band.new {
        background: var(--state-new);
    }
    .band.learn {
        background: var(--state-learn);
    }
    .band.review {
        background: var(--state-review);
    }
    .estimate {
        margin: 0;
        font-size: 12px;
        color: var(--fg-subtle);
        text-align: center;
    }
    .explain .estimate {
        text-align: start;
        margin-top: 14px;
    }
    .plain {
        margin: 0 0 14px;
        line-height: 1.55;
        max-width: 58ch;
    }
    .settings {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .settings li {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-inline-start: 14px;
        border-inline-start: 2px solid var(--app-accent-soft);
    }
    .setting {
        font-family: var(--app-font-display);
        font-weight: 600;
    }
    .because {
        font-size: 13px;
        color: var(--fg-subtle);
        line-height: 1.45;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--app-surface-sunken);
        border: 1px solid var(--app-line);
        border-radius: var(--app-radius);
        padding: 7px 14px;
        cursor: pointer;
    }
    button:hover {
        border-color: var(--button-hover-border);
    }
    button.primary {
        background: var(--app-accent);
        color: var(--app-accent-fg);
        border-color: transparent;
        font-family: var(--app-font-display);
        font-size: 16px;
        font-weight: 600;
        padding: 12px 24px;
    }
    button.primary:hover {
        background: var(--app-accent-hover);
    }
    button.primary.quiet {
        font-size: 14px;
        padding: 7px 16px;
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
    }
    /* The upstream page centres a 450px column inside its own window; here
     * it should fill the card it sits in. */
    .congrats :global(.congrats) {
        text-align: start;
        max-width: none;
        width: 100%;
    }
    .congrats :global(.container) {
        padding: 0;
        max-width: none;
    }
    /* The upstream page is sized for a window of its own. */
    .congrats :global(h1) {
        font-family: var(--app-font-display);
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.01em;
        margin: 0 0 8px;
    }
    .congrats :global(.congrats p) {
        margin: 0 0 6px;
        color: var(--fg-subtle);
        line-height: 1.5;
    }
    .congrats :global(a) {
        color: var(--fg-link);
    }
    .limit-notice {
        margin: 12px 0 0;
        padding: 14px 16px;
        border-radius: var(--app-radius);
        background: var(--app-accent-soft);
    }
    .limit-notice p {
        margin: 0 0 10px;
    }
    .limit-notice button.primary {
        font-size: 14px;
        padding: 8px 16px;
    }
    .next-choices {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 10px;
    }
    .next-choice {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        text-align: start;
        padding: 12px 14px;
    }
    .next-choice .label {
        font-family: var(--app-font-display);
        font-weight: 600;
    }
    .next-choice .hint {
        font-size: 12px;
        color: var(--fg-subtle);
    }
    .subtle {
        color: var(--fg-subtle);
    }
</style>
