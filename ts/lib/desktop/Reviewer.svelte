<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The study screen: the card frame plus the bottom bar with Show Answer, the
four rating buttons with their intervals, the remaining counts, the timer,
Edit, Undo and the card actions menu.
-->
<script lang="ts">
    import { getNote } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";

    import CardFrame from "./CardFrame.svelte";
    import { fieldIndexForText } from "./click-to-edit";
    import { settingsGet, settingsSet } from "./desktop-api";
    import EditorPanel from "./EditorPanel.svelte";
    import { FIRST_CARD_GUIDE_KEY, guideNeeded } from "./first-card";
    import FirstCardOverlay from "./FirstCardOverlay.svelte";
    import { type Ease, remainingText, type ReviewerController } from "./reviewer";
    import { onRpcDone } from "./rpc-events";
    import { isTypingTarget, ShortcutMap, shortcutLabel } from "./shortcuts";

    export let controller: ReviewerController;
    export let nightMode = false;

    const dispatch = createEventDispatcher<{
        finished: void;
        options: void;
        undone: string | null;
    }>();

    const state = controller.state;
    const counts = controller.counts;
    const buttons = controller.buttons;
    const showCounts = controller.showCounts;
    const timerLimit = controller.timerLimitSecs;
    const stopTimerOnAnswer = controller.stopTimerOnAnswer;
    const notice = controller.notice;
    const currentCard = controller.currentCard;
    const autoAdvance = controller.autoAdvance;
    const timeboxHit = controller.timeboxHit;

    let frame: CardFrame;
    let editor: EditorPanel | undefined;
    /** Cards waiting when this sitting started, for the progress bar. */
    let sessionTotal = 0;
    let editing = false;
    let menuOpen = false;
    let elapsed = 0;
    let ticker: ReturnType<typeof setInterval> | undefined;
    let offRpcDone: (() => void) | undefined;

    const easeKeys: Record<Ease, string> = { 1: "1", 2: "2", 3: "3", 4: "4" };

    // The bar across the top: how much of what was waiting is done. Cards
    // rated Again come back, so the total can grow; keep the high-water mark
    // rather than letting the bar jump backwards.
    $: remainingCards = $counts
        ? $counts.counts[0] + $counts.counts[1] + $counts.counts[2]
        : 0;
    $: rememberHighWater(remainingCards);
    $: donePercent = sessionTotal
        ? Math.round(((sessionTotal - remainingCards) / sessionTotal) * 100)
        : 0;

    function rememberHighWater(remaining: number): void {
        if (remaining > sessionTotal) {
            sessionTotal = remaining;
        }
    }

    // One-time guide over the answer buttons (per profile). It goes away
    // with "Got it" or with the first answer, and is not shown again.
    let showGuide = false;
    void settingsGet("profile", FIRST_CARD_GUIDE_KEY)
        .then((stored) => (showGuide = guideNeeded(stored)))
        .catch(() => (showGuide = false));
    let guideRequested = false;
    $: guideVisible =
        (showGuide || guideRequested) && $state === "answer" && $buttons.length > 0;
    $: if (showGuide && $state === "transition") {
        dismissGuide();
    }
    function dismissGuide(): void {
        guideRequested = false;
        if (!showGuide) {
            return;
        }
        showGuide = false;
        void settingsSet("profile", FIRST_CARD_GUIDE_KEY, true);
    }

    /** The "?" next to the answer buttons brings the guide back. */
    function toggleGuide(): void {
        guideRequested = !guideVisible;
        showGuide = false;
    }

    const shortcuts = new ShortcutMap().addAll([
        ["e", () => toggleEditing()],
        [" ", () => void controller.onEnter()],
        ["Enter", () => void controller.onEnter()],
        ["m", () => (menuOpen = !menuOpen)],
        ["r", () => controller.replayAudio()],
        ["F5", () => controller.replayAudio()],
        ["Ctrl+1", () => void controller.setCardFlag(1)],
        ["Ctrl+2", () => void controller.setCardFlag(2)],
        ["Ctrl+3", () => void controller.setCardFlag(3)],
        ["Ctrl+4", () => void controller.setCardFlag(4)],
        ["Ctrl+5", () => void controller.setCardFlag(5)],
        ["Ctrl+6", () => void controller.setCardFlag(6)],
        ["Ctrl+7", () => void controller.setCardFlag(7)],
        ["*", () => void controller.toggleMark()],
        ["=", () => void controller.buryNote()],
        ["-", () => void controller.buryCard()],
        ["!", () => void controller.suspendNote()],
        ["@", () => void controller.suspendCard()],
        ["Ctrl+Backspace", () => void deleteNote()],
        ["o", () => dispatch("options")],
        ["1", () => void controller.answer(1)],
        ["2", () => void controller.answer(2)],
        ["3", () => void controller.answer(3)],
        ["4", () => void controller.answer(4)],
        ["u", () => void undoLast()],
        ["Ctrl+z", () => void undoLast()],
        ["5", () => controller.pauseAudio()],
        ["6", () => controller.seekAudio(-5)],
        ["7", () => controller.seekAudio(5)],
        ["Escape", () => void closeEditor()],
        ["Shift+A", () => controller.toggleAutoAdvance()],
    ]);

    /** `check_timebox` in reviewer.py: Continue keeps studying, Finish leaves. */
    async function onTimebox(hit: { minutes: number; cards: number }): Promise<void> {
        const message = tr.studyingCardStudiedInMinute({
            cards: hit.cards,
            minutes: String(hit.minutes),
        });
        const keepGoing = confirm(
            `${message}\n\nOK: ${tr.studyingContinue()}   Cancel: ${tr.studyingFinish()}`,
        );
        if (keepGoing) {
            await controller.continueAfterTimebox();
        } else {
            timeboxHit.set(null);
            dispatch("finished");
        }
    }

    $: if ($timeboxHit) {
        void onTimebox($timeboxHit);
    }

    export function handleKey(event: KeyboardEvent): boolean {
        if (isTypingTarget(event.target)) {
            // Enter in the type-answer box is handled by the card document.
            return false;
        }
        if (shortcuts.handle(event)) {
            event.preventDefault();
            return true;
        }
        return false;
    }

    /** A click on card text opens the edit panel on that field (A7). */
    async function onCardClick(text: string): Promise<void> {
        const card = $currentCard;
        if (!card) {
            return;
        }
        const note = await getNote({ nid: card.noteId });
        const index = fieldIndexForText(note.fields, text);
        if (index === null) {
            return;
        }
        editing = true;
        await tick();
        editor?.focusField(index);
    }

    function toggleEditing(): void {
        if (editing) {
            void closeEditor();
        } else if ($currentCard) {
            editing = true;
        }
    }

    async function closeEditor(): Promise<void> {
        if (!editing) {
            return;
        }
        await editor?.saveNow();
        editing = false;
        await controller.redrawCurrent();
    }

    async function undoLast(): Promise<void> {
        const operation = await controller.undo();
        dispatch("undone", operation);
    }

    async function deleteNote(): Promise<void> {
        if (confirm(tr.studyingDeleteNote())) {
            await controller.deleteNote();
        }
    }

    function resetTimer(): void {
        elapsed = 0;
    }

    $: if ($state === "question") {
        resetTimer();
    }

    function formatTime(secs: number): string {
        const limit = $timerLimit;
        const shown = limit ? Math.min(secs, limit) : secs;
        const m = Math.floor(shown / 60);
        const s = String(shown % 60).padStart(2, "0");
        return `${m}:${s}`;
    }

    onMount(() => {
        controller.attach(frame.view);
        controller.onFinished = () => dispatch("finished");
        void controller.start();
        // The editor saves through updateNotes; redraw once that has landed,
        // the way Qt's reviewer reacts to note_text changes.
        offRpcDone = onRpcDone((method) => {
            if (editing && method === "updateNotes") {
                void controller.redrawCurrent();
            }
        });
        ticker = setInterval(() => {
            const stopped = $state === "answer" && $stopTimerOnAnswer;
            if (($state === "question" || $state === "answer") && !stopped) {
                elapsed += 1;
            }
        }, 1000);
    });

    onDestroy(() => {
        clearInterval(ticker);
        offRpcDone?.();
        controller.onFinished = null;
        controller.stop();
    });

    $: if ($notice) {
        setTimeout(() => notice.set(null), 4000);
    }
</script>

<div class="reviewer">
    <div
        class="progress"
        role="progressbar"
        aria-label="Cards done in this session"
        aria-valuenow={donePercent}
        aria-valuemin="0"
        aria-valuemax="100"
    >
        <span class="progress-fill" style="width: {donePercent}%"></span>
    </div>
    <div class="card-area" class:split={editing}>
        <div class="card-pane">
            <CardFrame
                bind:this={frame}
                {nightMode}
                onCommand={(command) => controller.onBridgeCommand(command)}
                onKeydown={(event) => handleKey(event)}
                onClick={(text) => void onCardClick(text)}
            />
            {#if $notice}
                <div class="notice">{$notice}</div>
            {/if}
        </div>
        {#if editing && $currentCard}
            <div class="editor-pane">
                <div class="editor-header">
                    <span>{tr.editingEditCurrent()}</span>
                    <button on:click={closeEditor}>{tr.actionsClose()}</button>
                </div>
                <EditorPanel
                    bind:this={editor}
                    mode="current"
                    noteId={$currentCard.noteId}
                    cardId={$currentCard.id}
                    {nightMode}
                    on:close={closeEditor}
                />
            </div>
        {/if}
    </div>

    <div class="bottom">
        <div class="left">
            <button
                class:active={editing}
                title={tr.actionsShortcutKey({ val: "E" })}
                on:click={toggleEditing}
            >
                {tr.studyingEdit()}
            </button>
            <button title={tr.actionsShortcutKey({ val: "U" })} on:click={undoLast}>
                {tr.undoUndo()}
            </button>
        </div>

        <div class="middle">
            {#if $state === "question"}
                <button
                    class="show-answer"
                    title={tr.actionsShortcutKey({ val: tr.studyingSpace() })}
                    on:click={() => controller.showAnswer()}
                >
                    {tr.studyingShowAnswer()}
                    {#if $showCounts && $counts}
                        <span class="counts">
                            <span class="new-count" class:current={$counts.idx === 0}>
                                {$counts.counts[0]}
                            </span>
                            +
                            <span class="learn-count" class:current={$counts.idx === 1}>
                                {$counts.counts[1]}
                            </span>
                            +
                            <span
                                class="review-count"
                                class:current={$counts.idx === 2}
                            >
                                {$counts.counts[2]}
                            </span>
                        </span>
                    {/if}
                </button>
            {:else if $state === "answer"}
                {#if guideVisible}
                    <FirstCardOverlay buttons={$buttons} on:dismiss={dismissGuide} />
                {/if}
                {#each $buttons as button (button.ease)}
                    <button
                        class="ease ease{button.ease}"
                        class:default={button.ease === 3}
                        title={tr.actionsShortcutKey({ val: easeKeys[button.ease] })}
                        on:click={() => controller.answer(button.ease)}
                    >
                        <span class="interval">{button.interval}</span>
                        <span class="label">{button.label}</span>
                    </button>
                {/each}
                <button
                    class="explain"
                    aria-label="What do these buttons mean?"
                    title="What do these buttons mean?"
                    aria-expanded={guideVisible}
                    on:click={toggleGuide}
                >
                    ?
                </button>
            {:else if $state === "transition"}
                <span class="fg-subtle">…</span>
            {/if}
        </div>

        <div class="right">
            {#if $counts}
                <span
                    class="remaining"
                    title="New, learning and review cards still due today"
                >
                    {remainingText($counts)}
                </span>
            {/if}
            {#if $timerLimit}
                <span class="timer" class:over={elapsed >= $timerLimit}>
                    {formatTime(elapsed)}
                </span>
            {/if}
            <div class="menu-anchor">
                <button
                    title={tr.actionsShortcutKey({ val: "M" })}
                    on:click={() => (menuOpen = !menuOpen)}
                >
                    {tr.studyingMore()} ▾
                </button>
                {#if menuOpen}
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="menu" on:mouseleave={() => (menuOpen = false)}>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                void controller.toggleMark();
                            }}
                        >
                            {tr.studyingMarkNote()}
                            <kbd>*</kbd>
                        </button>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                void controller.buryCard();
                            }}
                        >
                            {tr.studyingBuryCard()}
                            <kbd>-</kbd>
                        </button>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                void controller.buryNote();
                            }}
                        >
                            {tr.studyingBuryNote()}
                            <kbd>=</kbd>
                        </button>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                void controller.suspendCard();
                            }}
                        >
                            {tr.actionsSuspendCard()}
                            <kbd>@</kbd>
                        </button>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                void controller.suspendNote();
                            }}
                        >
                            {tr.studyingSuspendNote()}
                            <kbd>!</kbd>
                        </button>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                void deleteNote();
                            }}
                        >
                            {tr.studyingDeleteNote()}
                            <kbd>{shortcutLabel("Ctrl+Backspace")}</kbd>
                        </button>
                        <div class="divider"></div>
                        {#each [1, 2, 3, 4, 5, 6, 7] as flag}
                            <button
                                on:click={() => {
                                    menuOpen = false;
                                    void controller.setCardFlag(flag);
                                }}
                            >
                                <span
                                    class="flag-dot"
                                    style="background: var(--flag-{flag})"
                                ></span>
                                {tr.studyingFlagCard()}
                                {flag}
                                <kbd>{shortcutLabel(`Ctrl+${flag}`)}</kbd>
                            </button>
                        {/each}
                        <div class="divider"></div>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                controller.replayAudio();
                            }}
                        >
                            {tr.actionsReplayAudio()}
                            <kbd>R</kbd>
                        </button>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                controller.toggleAutoAdvance();
                            }}
                        >
                            {$autoAdvance ? "✓ " : ""}{tr.actionsAutoAdvance()}
                            <kbd>{shortcutLabel("Shift+A")}</kbd>
                        </button>
                        <button
                            on:click={() => {
                                menuOpen = false;
                                dispatch("options");
                            }}
                        >
                            {tr.actionsOptions()}
                            <kbd>O</kbd>
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    .reviewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
    }
    .progress {
        flex: none;
        height: 4px;
        margin: 0 24px 12px;
        border-radius: 999px;
        background: var(--app-surface-sunken);
        overflow: hidden;
    }
    .progress-fill {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: var(--app-accent);
        transition: width var(--transition) ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
        .progress-fill {
            transition: none;
        }
    }
    .card-area {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        padding: 0 24px;
    }
    .card-area.split {
        grid-template-columns: minmax(0, 1fr) minmax(320px, 45%);
    }
    /* The card sits on its own sheet, the way a physical card would. */
    .card-pane {
        position: relative;
        min-height: 0;
        background: var(--app-surface);
        border-radius: var(--app-radius-large);
        box-shadow: var(--app-shadow-card);
        overflow: hidden;
    }
    .editor-pane {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--app-surface);
        border-radius: var(--app-radius-large);
        box-shadow: var(--app-shadow-card);
        overflow: hidden;
    }
    .editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        border-bottom: 1px solid var(--app-line);
        font-family: var(--app-font-display);
        font-weight: 600;
    }
    button.active {
        background: var(--app-accent-soft);
        color: var(--app-accent);
    }
    .notice {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--app-surface);
        color: var(--fg);
        border-radius: var(--app-radius);
        padding: 8px 14px;
        box-shadow: var(--app-shadow-pop);
    }
    .bottom {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 8px;
        padding: 14px 24px 18px;
    }
    .left {
        display: flex;
        gap: 6px;
    }
    .right {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 10px;
    }
    .middle {
        position: relative;
        display: flex;
        gap: 8px;
        align-items: stretch;
    }
    button {
        font: inherit;
        color: var(--fg-subtle);
        background: transparent;
        border: 0;
        border-radius: var(--app-radius);
        padding: 7px 12px;
        cursor: pointer;
        transition:
            background var(--transition),
            color var(--transition);
    }
    button:hover {
        background: var(--app-surface);
        color: var(--fg);
    }
    .show-answer {
        min-width: 260px;
        padding: 12px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        background: var(--app-accent);
        color: var(--app-accent-fg);
        font-family: var(--app-font-display);
        font-size: 15px;
        font-weight: 600;
        box-shadow: var(--app-shadow-card);
    }
    .show-answer:hover {
        background: var(--app-accent-hover);
        color: var(--app-accent-fg);
    }
    .counts {
        font-size: 12px;
        font-weight: 400;
        opacity: 0.8;
    }
    .counts .current {
        text-decoration: underline;
    }
    /* One pill per rating, coloured by what it means, interval on top. */
    .ease {
        min-width: 104px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: 9px 16px;
        background: var(--app-surface);
        box-shadow: var(--app-shadow-card);
        color: var(--fg);
    }
    .ease:hover {
        transform: translateY(-1px);
    }
    .ease .interval {
        font-size: 11px;
        color: var(--fg-subtle);
        min-height: 1.2em;
        font-variant-numeric: tabular-nums;
    }
    .ease .label {
        font-family: var(--app-font-display);
        font-weight: 600;
    }
    .ease1 .label {
        color: var(--accent-danger);
    }
    .ease2 .label {
        color: var(--state-learn);
    }
    .ease3 .label {
        color: var(--state-review);
    }
    .ease4 .label {
        color: var(--state-new);
    }
    .ease.default {
        outline: 2px solid var(--app-accent-soft);
    }
    .explain {
        width: 30px;
        padding: 0;
        align-self: center;
        border-radius: 50%;
        aspect-ratio: 1;
        color: var(--fg-faint);
        font-size: 13px;
    }
    .explain:hover,
    .explain[aria-expanded="true"] {
        background: var(--app-accent-soft);
        color: var(--app-accent);
    }
    .remaining {
        color: var(--fg-subtle);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        font-size: 13px;
    }
    .timer {
        font-variant-numeric: tabular-nums;
        color: var(--fg-subtle);
        font-size: 13px;
    }
    .timer.over {
        color: var(--accent-danger);
    }
    .menu-anchor {
        position: relative;
    }
    .menu {
        position: absolute;
        right: 0;
        bottom: calc(100% + 6px);
        min-width: 250px;
        background: var(--app-surface);
        border: 1px solid var(--app-line);
        border-radius: var(--app-radius);
        box-shadow: var(--app-shadow-pop);
        padding: 6px;
        display: flex;
        flex-direction: column;
        z-index: 10;
    }
    .menu button {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        text-align: start;
        color: var(--fg);
        padding: 7px 10px;
    }
    .menu button:hover {
        background: var(--app-accent-soft);
    }
    .menu kbd {
        font-size: 11px;
        color: var(--fg-subtle);
        font-family: var(--app-font-mono);
    }
    .divider {
        height: 1px;
        background: var(--app-line);
        margin: 5px 0;
    }
    .flag-dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-inline-end: 6px;
    }
    .fg-subtle {
        color: var(--fg-subtle);
    }
</style>
