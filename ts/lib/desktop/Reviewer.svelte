<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The study screen: the card frame plus the bottom bar with Show Answer, the
four rating buttons with their intervals, the remaining counts, the timer,
Edit, Undo and the card actions menu.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import CardFrame from "./CardFrame.svelte";
    import EditorPanel from "./EditorPanel.svelte";
    import type { Ease, ReviewerController } from "./reviewer";
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

    let frame: CardFrame;
    let editor: EditorPanel | undefined;
    let editing = false;
    let menuOpen = false;
    let elapsed = 0;
    let ticker: ReturnType<typeof setInterval> | undefined;
    let offRpcDone: (() => void) | undefined;

    const easeKeys: Record<Ease, string> = { 1: "1", 2: "2", 3: "3", 4: "4" };

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
    ]);

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
    <div class="card-area" class:split={editing}>
        <div class="card-pane">
            <CardFrame
                bind:this={frame}
                {nightMode}
                onCommand={(command) => controller.onBridgeCommand(command)}
                onKeydown={(event) => handleKey(event)}
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
            {:else if $state === "transition"}
                <span class="fg-subtle">…</span>
            {/if}
        </div>

        <div class="right">
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
    .card-area {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
    }
    .card-area.split {
        grid-template-columns: minmax(0, 1fr) minmax(320px, 45%);
    }
    .card-pane {
        position: relative;
        min-height: 0;
    }
    .editor-pane {
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-inline-start: 1px solid var(--border);
        background: var(--canvas);
    }
    .editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--canvas-elevated);
        font-weight: 600;
    }
    button.active {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .notice {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--canvas-overlay);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 6px 12px;
        box-shadow: var(--shadow);
    }
    .bottom {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-top: 1px solid var(--border);
        background: var(--canvas-elevated);
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
        display: flex;
        gap: 8px;
        align-items: stretch;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 5px 12px;
        cursor: pointer;
    }
    button:hover {
        border-color: var(--button-hover-border);
    }
    .show-answer {
        min-width: 220px;
        padding: 8px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
    }
    .counts {
        font-size: 12px;
        color: var(--fg-subtle);
    }
    .counts .current {
        text-decoration: underline;
    }
    .ease {
        min-width: 96px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 6px 14px;
    }
    .ease .interval {
        font-size: 12px;
        color: var(--fg-subtle);
        min-height: 1.2em;
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
        border-color: var(--border-strong);
    }
    .timer {
        font-variant-numeric: tabular-nums;
        color: var(--fg-subtle);
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
        bottom: calc(100% + 4px);
        min-width: 240px;
        background: var(--canvas-elevated);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow);
        padding: 4px;
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
        border: 0;
        background: transparent;
        padding: 6px 10px;
    }
    .menu button:hover {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .menu kbd {
        font-size: 11px;
        color: var(--fg-subtle);
    }
    .divider {
        height: 1px;
        background: var(--border);
        margin: 4px 0;
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
