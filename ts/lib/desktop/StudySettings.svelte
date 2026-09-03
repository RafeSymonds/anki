<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

How this deck is studied, in the four choices that change how it feels: how
much a day, how soon a new card comes back, how firmly it should stick, and
how long a sitting runs. Everything here writes through the same calls Deck
Options uses; Deck Options is one click away for the rest.
-->
<script lang="ts">
    import type { DeckConfig } from "@generated/anki/deck_config_pb";
    import { UpdateDeckConfigsMode } from "@generated/anki/deck_config_pb";
    import type { Preferences } from "@generated/anki/config_pb";
    import {
        getDeckConfigsForUpdate,
        getPreferences,
        setPreferences,
        updateDeckConfigs,
    } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    import Modal from "./tools/Modal.svelte";
    import {
        clampLimit,
        describeSteps,
        LEARNING_PACES,
        type PaceId,
        paceMatching,
        RETENTION_CHOICES,
        retentionChoice,
        retentionSummary,
        SESSION_CHOICES,
        sessionLabel,
        sessionSummary,
        STUDY_STYLES,
        type StudyStyleId,
        styleMatching,
        workloadSummary,
    } from "./study-settings";

    export let deckId: bigint;
    /** Shown in the title so it is clear which deck is being changed. */
    export let deckName = "";

    const dispatch = createEventDispatcher<{
        close: void;
        saved: void;
        options: void;
        notify: string;
    }>();

    let loading = true;
    let saving = false;
    let config: DeckConfig | null = null;
    let preferences: Preferences | null = null;
    /** Everything getDeckConfigsForUpdate returned, for the save call. */
    let source: Awaited<ReturnType<typeof getDeckConfigsForUpdate>> | null = null;

    let newPerDay = 20;
    let reviewsPerDay = 200;
    let steps: number[] = [1, 10];
    let retention = 0.9;
    let sessionMinutes = 0;
    let burySiblings = false;
    let showTimer = false;

    $: fsrs = source?.fsrs ?? false;
    $: plan = { newPerDay, reviewsPerDay };
    $: style = styleMatching(plan);
    $: pace = paceMatching(steps);

    onMount(load);

    async function load(): Promise<void> {
        source = await getDeckConfigsForUpdate({ did: deckId });
        const configId = source.currentDeck?.configId ?? 1n;
        config =
            source.allConfig.find((entry) => entry.config?.id === configId)?.config ??
            source.allConfig[0]?.config ??
            null;
        const values = config?.config;
        if (values) {
            newPerDay = values.newPerDay;
            reviewsPerDay = values.reviewsPerDay;
            steps = [...values.learnSteps];
            retention = values.desiredRetention || 0.9;
            burySiblings = values.buryNew || values.buryReviews;
            showTimer = values.showTimer;
        }
        // A per-deck limit for today wins over the preset; show the number
        // the user will actually get.
        const limits = source.currentDeck?.limits;
        newPerDay = limits?.new ?? newPerDay;
        reviewsPerDay = limits?.review ?? reviewsPerDay;
        preferences = await getPreferences({});
        sessionMinutes = Math.round((preferences.reviewing?.timeLimitSecs ?? 0) / 60);
        loading = false;
    }

    function applyStyle(id: StudyStyleId): void {
        const chosen = STUDY_STYLES.find((entry) => entry.id === id);
        if (chosen) {
            newPerDay = chosen.plan.newPerDay;
            reviewsPerDay = chosen.plan.reviewsPerDay;
        }
    }

    function applyPace(id: PaceId): void {
        const chosen = LEARNING_PACES.find((entry) => entry.id === id);
        if (chosen) {
            steps = [...chosen.steps];
        }
    }

    async function save(): Promise<void> {
        if (!config?.config || !source) {
            dispatch("close");
            return;
        }
        saving = true;
        try {
            config.config.newPerDay = clampLimit(newPerDay);
            config.config.reviewsPerDay = clampLimit(reviewsPerDay);
            config.config.learnSteps = steps;
            config.config.desiredRetention = retention;
            config.config.buryNew = burySiblings;
            config.config.buryReviews = burySiblings;
            config.config.showTimer = showTimer;
            const limits = source.currentDeck?.limits;
            if (limits) {
                // The deck's own limits would otherwise override what was
                // just set on the preset.
                limits.new = undefined;
                limits.review = undefined;
            }
            await updateDeckConfigs({
                targetDeckId: deckId,
                configs: [config],
                removedConfigIds: [],
                mode: UpdateDeckConfigsMode.NORMAL,
                cardStateCustomizer: source.cardStateCustomizer,
                limits,
                newCardsIgnoreReviewLimit: source.newCardsIgnoreReviewLimit,
                fsrs: source.fsrs,
                applyAllParentLimits: source.applyAllParentLimits,
                fsrsReschedule: false,
                fsrsHealthCheck: source.fsrsHealthCheck,
            });
            if (preferences?.reviewing) {
                preferences.reviewing.timeLimitSecs = Math.max(0, sessionMinutes) * 60;
                await setPreferences(preferences);
            }
            dispatch("notify", "Study settings saved");
            dispatch("saved");
        } catch (err) {
            dispatch("notify", err instanceof Error ? err.message : String(err));
        } finally {
            saving = false;
            dispatch("close");
        }
    }
</script>

<Modal
    title={deckName ? `How you study ${deckName}` : "How you study"}
    width="580px"
    on:close
>
    {#if loading}
        <p class="muted">Loading…</p>
    {:else}
        <section>
            <h3>How much a day</h3>
            <div class="choices">
                {#each STUDY_STYLES as entry (entry.id)}
                    <button
                        class="choice"
                        class:selected={style === entry.id}
                        aria-pressed={style === entry.id}
                        on:click={() => applyStyle(entry.id)}
                    >
                        <span class="label">{entry.label}</span>
                        <span class="hint">{entry.hint}</span>
                    </button>
                {/each}
            </div>
            <div class="numbers">
                <label>
                    <span>New cards a day</span>
                    <input
                        type="number"
                        min="0"
                        max="9999"
                        bind:value={newPerDay}
                        on:change={() => (newPerDay = clampLimit(newPerDay))}
                    />
                </label>
                <label>
                    <span>Most reviews a day</span>
                    <input
                        type="number"
                        min="0"
                        max="9999"
                        bind:value={reviewsPerDay}
                        on:change={() => (reviewsPerDay = clampLimit(reviewsPerDay))}
                    />
                </label>
            </div>
            <p class="consequence">{workloadSummary(plan)}</p>
        </section>

        <section>
            <h3>When a new card comes back</h3>
            <div class="choices">
                {#each LEARNING_PACES as entry (entry.id)}
                    <button
                        class="choice"
                        class:selected={pace === entry.id}
                        aria-pressed={pace === entry.id}
                        on:click={() => applyPace(entry.id)}
                    >
                        <span class="label">{entry.label}</span>
                        <span class="hint">{entry.hint}</span>
                    </button>
                {/each}
            </div>
            <p class="consequence">{describeSteps(steps)}</p>
        </section>

        {#if fsrs}
            <section>
                <h3>How much you want to remember</h3>
                <div class="choices">
                    {#each RETENTION_CHOICES as choice (choice.value)}
                        <button
                            class="choice"
                            class:selected={retentionChoice(retention)?.value ===
                                choice.value}
                            aria-pressed={retentionChoice(retention)?.value ===
                                choice.value}
                            on:click={() => (retention = choice.value)}
                        >
                            <span class="label">
                                {choice.label} · {Math.round(choice.value * 100)}%
                            </span>
                            <span class="hint">{choice.hint}</span>
                        </button>
                    {/each}
                </div>
                <p class="consequence">{retentionSummary(retention)}</p>
            </section>
        {/if}

        <section>
            <h3>A sitting lasts</h3>
            <div class="session">
                {#each SESSION_CHOICES as minutes (minutes)}
                    <button
                        class="pill"
                        class:selected={sessionMinutes === minutes}
                        aria-pressed={sessionMinutes === minutes}
                        on:click={() => (sessionMinutes = minutes)}
                    >
                        {sessionLabel(minutes)}
                    </button>
                {/each}
            </div>
            <p class="consequence">{sessionSummary(sessionMinutes)}</p>
        </section>

        <section class="toggles">
            <label>
                <input type="checkbox" bind:checked={burySiblings} />
                <span>
                    <span class="label">Keep related cards apart</span>
                    <span class="hint">
                        Two cards made from the same note wait for another day.
                    </span>
                </span>
            </label>
            <label>
                <input type="checkbox" bind:checked={showTimer} />
                <span>
                    <span class="label">Show a timer while studying</span>
                    <span class="hint">Counts how long the current card takes.</span>
                </span>
            </label>
        </section>
    {/if}

    <svelte:fragment slot="footer">
        <button on:click={() => dispatch("options")}>
            {tr.actionsOptions()}…
        </button>
        <span class="spacer"></span>
        <button on:click={() => dispatch("close")}>{tr.actionsCancel()}</button>
        <button class="primary" disabled={loading || saving} on:click={save}>
            {tr.actionsSave()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    section {
        padding: 12px 0;
        border-bottom: 1px solid var(--app-line);
    }
    section:last-of-type {
        border-bottom: 0;
    }
    h3 {
        font-family: var(--app-font-display);
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--fg-subtle);
        margin: 0 0 10px;
    }
    .choices {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }
    .choice {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 3px;
        text-align: start;
        font: inherit;
        color: var(--fg);
        background: var(--app-surface-sunken);
        border: 1px solid transparent;
        border-radius: var(--app-radius);
        padding: 10px 12px;
        cursor: pointer;
    }
    .choice:hover {
        border-color: var(--button-hover-border);
    }
    .choice.selected {
        border-color: var(--app-accent);
        background: var(--app-accent-soft);
    }
    .choice .label {
        font-weight: 600;
        font-size: 13px;
    }
    .choice .hint {
        font-size: 12px;
        color: var(--fg-subtle);
        line-height: 1.35;
    }
    .numbers {
        display: flex;
        gap: 16px;
        margin-top: 12px;
    }
    .numbers label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
    }
    .numbers input {
        width: 74px;
        font-variant-numeric: tabular-nums;
    }
    .session {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    .pill {
        font: inherit;
        font-size: 13px;
        color: var(--fg);
        background: var(--app-surface-sunken);
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 6px 14px;
        cursor: pointer;
    }
    .pill.selected {
        border-color: var(--app-accent);
        background: var(--app-accent-soft);
        color: var(--app-accent);
        font-weight: 600;
    }
    .consequence {
        margin: 10px 0 0;
        font-size: 13px;
        color: var(--fg-subtle);
        line-height: 1.45;
    }
    .toggles {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .toggles label {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        cursor: pointer;
    }
    .toggles .label {
        display: block;
        font-size: 13px;
        font-weight: 600;
    }
    .toggles .hint {
        display: block;
        font-size: 12px;
        color: var(--fg-subtle);
    }
    .muted {
        color: var(--fg-subtle);
    }
    .spacer {
        flex: 1;
    }
</style>
