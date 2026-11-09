// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The review screen's logic: fetching the next card, rendering it into the
 * card document, showing the answer, rating, undo and the card actions.
 * A port of qt/aqt/reviewer.py against the same rslib calls.
 */

import type { AVTag } from "@generated/anki/card_rendering_pb";
import type { Card } from "@generated/anki/cards_pb";
import { ConfigKey_Bool } from "@generated/anki/config_pb";
import type { DeckConfig_Config } from "@generated/anki/deck_config_pb";
import {
    DeckConfig_Config_AnswerAction as AnswerAction,
    DeckConfig_Config_QuestionAction as QuestionAction,
} from "@generated/anki/deck_config_pb";
import { SchedulingStatesWithContext, SetSchedulingStatesRequest } from "@generated/anki/frontend_pb";
import { Empty } from "@generated/anki/generic_pb";
import type { Note } from "@generated/anki/notes_pb";
import type { Notetype } from "@generated/anki/notetypes_pb";
import type {
    QueuedCards,
    QueuedCards_QueuedCard,
    SchedulingContext,
    SchedulingState,
} from "@generated/anki/scheduler_pb";
import {
    BuryOrSuspendCardsRequest_Mode,
    CardAnswer,
    CardAnswer_Rating,
    QueuedCards_Queue,
    SchedulingStates,
} from "@generated/anki/scheduler_pb";
import {
    addNoteTags,
    answerCard,
    buryOrSuspendCards,
    cardsOfNote,
    compareAnswer,
    describeNextStates,
    encodeIriPaths,
    extractAvTags,
    extractClozeForTyping,
    getAllConfig,
    getCard,
    getConfigBool,
    getDeck,
    getDeckConfig,
    getNote,
    getNotetype,
    getQueuedCards,
    removeNotes,
    removeNoteTags,
    renderExistingCard,
    setFlag,
    stateIsLeech,
} from "@generated/backend";

import * as tr from "@generated/ftl";
import type { Writable } from "svelte/store";
import { get, writable } from "svelte/store";
import { undoLast } from "./undo";

import { avPlayer } from "./audio";
import {
    avRefsToPlayIcons,
    bodyClassesForCard,
    nodesToText,
    parseTypeAnswer,
    replaceTypeAnswer,
    stripAvRefs,
    typeAnswerComparisonHtml,
    typeAnswerInputHtml,
    withStyle,
} from "./card-html";
import { registerFrontendHandler, typedHandler } from "./frontend-service";
import { PracticeLoop } from "./practice";

export type Ease = 1 | 2 | 3 | 4;
export type ReviewerState = "idle" | "question" | "answer" | "transition" | "finished";

/** What the controller needs from the card document. */
export interface CardView {
    showQuestion(question: string, answer: string, bodyClass: string): void;
    showAnswer(answer: string): void;
    drawFlag(flag: number): void;
    drawMark(marked: boolean): void;
    getTypedAnswer(): string | null;
    /** Run the user's custom scheduling JS inside the card document. */
    runStateMutation?(key: string, js: string): Promise<void>;
    /** Show one side of a card being edited (the card layout preview). */
    showPreview?(html: string, bodyClass: string): void;
}

export interface AnswerButton {
    ease: Ease;
    label: string;
    interval: string;
}

export interface Counts {
    /** Which of the three counts the current card belongs to. */
    idx: number;
    counts: [number, number, number];
}

export const MARKED_TAG = "marked";

export function ratingFromEase(ease: Ease): CardAnswer_Rating {
    switch (ease) {
        case 1:
            return CardAnswer_Rating.AGAIN;
        case 2:
            return CardAnswer_Rating.HARD;
        case 3:
            return CardAnswer_Rating.GOOD;
        default:
            return CardAnswer_Rating.EASY;
    }
}

export function stateForEase(states: SchedulingStates, ease: Ease): SchedulingState | undefined {
    switch (ease) {
        case 1:
            return states.again;
        case 2:
            return states.hard;
        case 3:
            return states.good;
        default:
            return states.easy;
    }
}

/** `Scheduler.build_answer` in pylib. */
export function buildCardAnswer(
    cardId: bigint,
    states: SchedulingStates,
    ease: Ease,
    answeredAtMillis: number,
    millisecondsTaken: number,
): CardAnswer {
    return new CardAnswer({
        cardId,
        currentState: states.current,
        newState: stateForEase(states, ease),
        rating: ratingFromEase(ease),
        answeredAtMillis: BigInt(answeredAtMillis),
        millisecondsTaken: Math.max(0, Math.round(millisecondsTaken)),
    });
}

/** The progress indicator next to the answer buttons: "12 left" (new + learning + review still due). */
export function remainingText(counts: Counts | null): string {
    if (!counts) {
        return "";
    }
    const total = counts.counts[0] + counts.counts[1] + counts.counts[2];
    return total === 1 ? "1 left" : `${total} left`;
}

/** `V3CardInfo.counts` in reviewer.py. */
export function countsForQueue(queued: QueuedCards): Counts {
    const top = queued.cards[0];
    let idx = 2;
    if (top?.queue === QueuedCards_Queue.NEW) {
        idx = 0;
    } else if (top?.queue === QueuedCards_Queue.LEARNING) {
        idx = 1;
    }
    return { idx, counts: [queued.newCount, queued.learningCount, queued.reviewCount] };
}

export function userFlag(card: Card): number {
    return card.flags & 0b111;
}

export function currentDeckId(card: Card): bigint {
    return card.originalDeckId !== 0n ? card.originalDeckId : card.deckId;
}

export function answerLabels(): [string, string, string, string] {
    return [tr.studyingAgain(), tr.studyingHard(), tr.studyingGood(), tr.studyingEasy()];
}

/** Practice takes two answers: see the card again soon, or next round. */
export function practiceButtons(): AnswerButton[] {
    const [again, , good] = answerLabels();
    return [
        { ease: 1, label: again, interval: "Soon" },
        { ease: 3, label: good, interval: "Next round" },
    ];
}

export interface Timebox {
    startedAt: number;
    startReps: number;
    limitSecs: number;
}

export interface TimeboxHit {
    minutes: number;
    cards: number;
}

/** `Collection.timeboxReached` in pylib: null until the limit has passed. */
export function timeboxReached(box: Timebox | null, now: number, reps: number): TimeboxHit | null {
    if (!box || !box.limitSecs) {
        return null;
    }
    const elapsed = (now - box.startedAt) / 1000;
    if (elapsed > box.limitSecs) {
        return { minutes: Math.round(box.limitSecs / 60), cards: reps - box.startReps };
    }
    return null;
}

export type AdvanceStep = { kind: "showAnswer" } | { kind: "answer"; ease: Ease } | { kind: "bury" } | {
    kind: "reminder";
};

/** What auto-advance does when the question timer runs out (reviewer.py `_on_show_answer_timeout`). */
export function questionTimeoutStep(action: QuestionAction | undefined): AdvanceStep {
    return action === QuestionAction.SHOW_REMINDER ? { kind: "reminder" } : { kind: "showAnswer" };
}

/** What auto-advance does when the answer timer runs out (reviewer.py `_on_show_question_timeout`). */
export function answerTimeoutStep(action: AnswerAction | undefined): AdvanceStep {
    switch (action) {
        case AnswerAction.ANSWER_AGAIN:
            return { kind: "answer", ease: 1 };
        case AnswerAction.ANSWER_HARD:
            return { kind: "answer", ease: 2 };
        case AnswerAction.ANSWER_GOOD:
            return { kind: "answer", ease: 3 };
        case AnswerAction.SHOW_REMINDER:
            return { kind: "reminder" };
        default:
            return { kind: "bury" };
    }
}

interface Rendered {
    css: string;
    question: string;
    answer: string;
    questionTags: AVTag[];
    answerTags: AVTag[];
}

interface TypeAnswer {
    correct: string | null;
    font: { font: string; size: number };
    combining: boolean;
}

export class ReviewerController {
    readonly state: Writable<ReviewerState> = writable("idle");
    readonly counts: Writable<Counts | null> = writable(null);
    readonly buttons: Writable<AnswerButton[]> = writable([]);
    readonly flag: Writable<number> = writable(0);
    readonly marked: Writable<boolean> = writable(false);
    readonly showCounts: Writable<boolean> = writable(true);
    /** Seconds before the bottom bar timer turns red; 0 hides it. */
    readonly timerLimitSecs: Writable<number> = writable(0);
    readonly stopTimerOnAnswer: Writable<boolean> = writable(false);
    /** Short notices such as "card was a leech". */
    readonly notice: Writable<string | null> = writable(null);
    /** The card being shown, for the edit panel. */
    readonly currentCard: Writable<Card | null> = writable(null);
    readonly autoAdvance: Writable<boolean> = writable(false);
    /** Set when the timebox limit passes; the UI asks whether to continue. */
    readonly timeboxHit: Writable<TimeboxHit | null> = writable(null);
    /** The round being practiced; null when studying through the scheduler. */
    readonly practiceRound: Writable<number | null> = writable(null);

    card: Card | null = null;
    private note: Note | null = null;
    private notetype: Notetype | null = null;
    private states: SchedulingStates | null = null;
    private context: SchedulingContext | null = null;
    private rendered: Rendered | null = null;
    private config: DeckConfig_Config | null = null;
    private readonly configCache = new Map<bigint, DeckConfig_Config>();
    private view: CardView | null = null;
    private timerStarted = 0;
    private typedAnswer: string | null = null;
    private typeAnswer: TypeAnswer = { correct: null, font: { font: "Arial", size: 20 }, combining: true };
    private readonly stateMutationKey = String(Math.floor(Math.random() * 2 ** 52));
    private stateMutationJs = "";
    private statesMutated = true;
    private unregister: (() => void)[] = [];
    private hidePlayButtons = false;
    private nightMode = false;
    private running = false;
    private reps = 0;
    private timeLimitSecs = 0;
    private timebox: Timebox | null = null;
    private advanceTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingAdvance: (() => void) | null = null;
    private practice: PracticeLoop | null = null;
    /** Called when the queue runs dry. */
    onFinished: (() => void) | null = null;

    attach(view: CardView): void {
        this.view = view;
    }

    setNightMode(nightMode: boolean): void {
        this.nightMode = nightMode;
    }

    /** Make the next `start` go over these cards instead of the scheduler's
     * queue. Answers then stay in the loop, and `stop` ends it. */
    preparePractice(cardIds: bigint[]): void {
        this.practice = new PracticeLoop(cardIds);
    }

    async start(): Promise<void> {
        this.running = true;
        this.unregister.push(
            registerFrontendHandler(
                "getSchedulingStatesWithContext",
                typedHandler(Empty, () =>
                    new SchedulingStatesWithContext({
                        states: this.states ?? undefined,
                        context: this.context ?? undefined,
                    })),
            ),
            registerFrontendHandler(
                "setSchedulingStates",
                typedHandler(SetSchedulingStatesRequest, (request) => {
                    if (request.key === this.stateMutationKey && request.states) {
                        this.states = request.states;
                    }
                    return new Empty();
                }),
            ),
        );
        await this.loadPrefs();
        this.startTimebox();
        avPlayer.onQueueEnded = () => {
            const pending = this.pendingAdvance;
            this.pendingAdvance = null;
            pending?.();
        };
        await this.nextCard();
    }

    stop(): void {
        this.running = false;
        this.clearAdvanceTimer();
        avPlayer.onQueueEnded = null;
        this.autoAdvance.set(false);
        for (const fn of this.unregister) {
            fn();
        }
        this.unregister = [];
        avPlayer.stop();
        this.card = null;
        this.currentCard.set(null);
        this.state.set("idle");
        this.practice = null;
        this.practiceRound.set(null);
    }

    /** Re-render the current card after its note was edited, keeping the
     * side that is showing (`_redraw_current_card` in reviewer.py). */
    async redrawCurrent(): Promise<void> {
        const card = this.card;
        if (!card || !this.running) {
            return;
        }
        const wasAnswer = get(this.state) === "answer";
        this.note = await getNote({ nid: card.noteId });
        this.marked.set(this.note.tags.some((t) => t.toLowerCase() === MARKED_TAG));
        await this.render();
        if (wasAnswer) {
            await this.presentAnswer();
        } else {
            await this.showQuestion();
        }
    }

    /** Re-fetch the queue, e.g. after undo or an edit. */
    async refresh(): Promise<void> {
        if (this.running) {
            await this.nextCard();
        }
    }

    private async loadPrefs(): Promise<void> {
        this.hidePlayButtons = await this.configBool(ConfigKey_Bool.HIDE_AUDIO_PLAY_BUTTONS);
        // Legacy JSON keys; read them all at once so missing ones do not error.
        const config = await this.allConfig();
        // The answer buttons always show the interval they buy (A23); the
        // Qt "show next review time" option (estTimes) no longer hides it.
        this.showCounts.set((config.dueCounts as boolean | undefined) ?? true);
        this.stateMutationJs = (config.cardStateCustomizer as string | undefined) ?? "";
        this.timeLimitSecs = (config.timeLim as number | undefined) ?? 0;
    }

    /** `Collection.startTimebox` in pylib. */
    startTimebox(): void {
        this.timebox = { startedAt: Date.now(), startReps: this.reps, limitSecs: this.timeLimitSecs };
    }

    /** The user chose to keep going after the timebox prompt. */
    async continueAfterTimebox(): Promise<void> {
        this.timeboxHit.set(null);
        this.startTimebox();
        await this.nextCard();
    }

    private async configBool(key: ConfigKey_Bool): Promise<boolean> {
        try {
            return (await getConfigBool({ key }, { alertOnError: false })).val;
        } catch {
            return false;
        }
    }

    private async allConfig(): Promise<Record<string, unknown>> {
        try {
            const response = await getAllConfig({}, { alertOnError: false });
            return JSON.parse(new TextDecoder().decode(response.json)) as Record<string, unknown>;
        } catch {
            return {};
        }
    }

    async nextCard(): Promise<void> {
        if (this.practice) {
            await this.nextPracticeCard(this.practice);
            return;
        }
        const queued = await getQueuedCards({ fetchLimit: 1, intradayLearningOnly: false });
        if (!queued.cards.length) {
            this.finish();
            return;
        }
        this.counts.set(countsForQueue(queued));
        await this.loadQueuedCard(queued.cards[0]);
        await this.render();
        await this.showQuestion();
    }

    private finish(): void {
        this.card = null;
        this.currentCard.set(null);
        this.state.set("finished");
        this.onFinished?.();
    }

    private async nextPracticeCard(loop: PracticeLoop): Promise<void> {
        for (let id = loop.current; id !== null; id = loop.current) {
            let card: Card;
            try {
                card = await getCard({ cid: id }, { alertOnError: false });
            } catch {
                // Gone since practice started, e.g. deleted by a sync.
                loop.remove([id]);
                continue;
            }
            this.practiceRound.set(loop.round);
            this.counts.set({ idx: 2, counts: [0, 0, loop.remaining] });
            this.states = null;
            this.context = null;
            await this.loadCard(card);
            await this.render();
            await this.showQuestion();
            return;
        }
        this.finish();
    }

    private async loadQueuedCard(top: QueuedCards_QueuedCard): Promise<void> {
        const card = top.card!;
        const states = top.states ?? new SchedulingStates();
        if (states.current) {
            states.current.customData = card.customData;
        }
        this.states = states;
        this.context = top.context ?? null;
        await this.loadCard(card);
    }

    private async loadCard(card: Card): Promise<void> {
        this.card = card;
        this.currentCard.set(card);
        this.timerStarted = Date.now();
        this.typedAnswer = null;
        this.note = await getNote({ nid: card.noteId });
        this.notetype = await getNotetype({ ntid: this.note.notetypeId });
        this.config = await this.deckConfig(currentDeckId(card));
        this.flag.set(userFlag(card));
        this.marked.set(this.note.tags.some((t) => t.toLowerCase() === MARKED_TAG));
        const showTimer = this.config?.showTimer ?? false;
        this.timerLimitSecs.set(showTimer ? this.config?.capAnswerTimeToSecs ?? 0 : 0);
        this.stopTimerOnAnswer.set(this.config?.stopTimerOnAnswer ?? false);
    }

    private async deckConfig(deckId: bigint): Promise<DeckConfig_Config | null> {
        const deck = await getDeck({ did: deckId });
        if (deck.kind.case !== "normal") {
            return null;
        }
        const configId = deck.kind.value.configId;
        let config = this.configCache.get(configId);
        if (!config) {
            config = (await getDeckConfig({ dcid: configId })).config ?? undefined;
            if (config) {
                this.configCache.set(configId, config);
            }
        }
        return config ?? null;
    }

    /** Forget cached deck presets, e.g. after deck options were saved. */
    invalidateConfig(): void {
        this.configCache.clear();
    }

    private async render(): Promise<void> {
        const card = this.card!;
        const output = await renderExistingCard({ cardId: card.id, browser: false, partialRender: false });
        const question = await extractAvTags({ text: nodesToText(output.questionNodes), questionSide: true });
        const answer = await extractAvTags({ text: nodesToText(output.answerNodes), questionSide: false });
        this.rendered = {
            css: output.css,
            question: question.text,
            answer: answer.text,
            questionTags: question.avTags,
            answerTags: answer.avTags,
        };
    }

    private get autoplay(): boolean {
        return !(this.config?.disableAutoplay ?? false);
    }

    private async prepareText(text: string): Promise<string> {
        const escaped = (await encodeIriPaths({ val: text })).val;
        return this.hidePlayButtons ? stripAvRefs(escaped) : avRefsToPlayIcons(escaped);
    }

    async showQuestion(): Promise<void> {
        const card = this.card;
        const rendered = this.rendered;
        if (!card || !rendered || !this.view) {
            return;
        }
        this.state.set("question");
        this.typedAnswer = null;
        if (this.autoplay) {
            avPlayer.playTags(rendered.questionTags);
        }
        let question = await this.prepareText(rendered.question);
        question = await this.typeAnswerQuestion(question);
        const answer = (await encodeIriPaths({ val: rendered.answer })).val;
        this.view.showQuestion(
            withStyle(rendered.css, question),
            withStyle(rendered.css, answer),
            bodyClassesForCard(card.templateIdx, this.nightMode),
        );
        this.view.drawFlag(get(this.flag));
        this.view.drawMark(get(this.marked));
        this.buttons.set([]);
        this.runStateMutation();
        this.scheduleAdvance(this.config?.secondsToShowQuestion ?? 0, () => this.onQuestionTimeout());
    }

    private async typeAnswerQuestion(text: string): Promise<string> {
        this.typeAnswer = { correct: null, font: { font: "Arial", size: 20 }, combining: true };
        const spec = parseTypeAnswer(text, this.card!.templateIdx);
        if (!spec) {
            return text;
        }
        this.typeAnswer.combining = spec.combining;
        const fields = this.notetype?.fields ?? [];
        const index = fields.findIndex((f) => f.name === spec.fieldName);
        if (index === -1) {
            const warning = spec.clozeOrdinal
                ? tr.studyingPleaseRunToolsemptyCards()
                : tr.studyingTypeAnswerUnknownField({ val: spec.fieldName });
            return replaceTypeAnswer(text, warning);
        }
        const field = fields[index];
        this.typeAnswer.font = {
            font: field.config?.fontName || "Arial",
            size: field.config?.fontSize || 20,
        };
        let correct: string | null = this.note?.fields[index] ?? "";
        if (spec.clozeOrdinal) {
            const extracted = await extractClozeForTyping({ text: correct, ordinal: spec.clozeOrdinal });
            correct = extracted.val || null;
            if (correct === null) {
                return replaceTypeAnswer(text, tr.studyingPleaseRunToolsemptyCards());
            }
        }
        if (!correct) {
            // Empty field: nothing to compare against.
            return replaceTypeAnswer(text, "");
        }
        this.typeAnswer.correct = correct;
        return typeAnswerInputHtml(text, this.typeAnswer.font);
    }

    private runStateMutation(): void {
        if (this.practice || !this.stateMutationJs || !this.view?.runStateMutation) {
            this.statesMutated = true;
            return;
        }
        this.statesMutated = false;
        this.view
            .runStateMutation(this.stateMutationKey, this.stateMutationJs)
            .catch((err) => console.warn("custom scheduling failed", err))
            .finally(() => {
                this.statesMutated = true;
            });
    }

    async showAnswer(): Promise<void> {
        if (get(this.state) !== "question" || !this.view) {
            return;
        }
        this.typedAnswer = this.view.getTypedAnswer();
        this.state.set("answer");
        if (this.autoplay && this.rendered) {
            avPlayer.playTags(this.rendered.answerTags);
        }
        await this.presentAnswer();
        this.scheduleAdvance(this.config?.secondsToShowAnswer ?? 0, () => this.onAnswerTimeout());
    }

    private async presentAnswer(): Promise<void> {
        const rendered = this.rendered;
        if (!this.card || !rendered || !this.view) {
            return;
        }
        this.state.set("answer");
        let answer = await this.prepareText(rendered.answer);
        answer = await this.typeAnswerAnswer(answer);
        this.view.showAnswer(withStyle(rendered.css, answer));
        await this.showEaseButtons();
    }

    private async typeAnswerAnswer(text: string): Promise<string> {
        const { correct, font, combining } = this.typeAnswer;
        if (!correct) {
            return replaceTypeAnswer(text, "");
        }
        const output = await compareAnswer({ expected: correct, provided: this.typedAnswer ?? "", combining });
        return typeAnswerComparisonHtml(text, output.val, font);
    }

    private async showEaseButtons(): Promise<void> {
        if (this.practice) {
            this.buttons.set(practiceButtons());
            return;
        }
        // Custom scheduling JS may still be adjusting the next states.
        for (let i = 0; i < 40 && !this.statesMutated; i++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!this.states || get(this.state) !== "answer") {
            return;
        }
        const labels = answerLabels();
        const intervals = (await describeNextStates(this.states)).vals;
        this.buttons.set(
            labels.map((label, i) => ({
                ease: (i + 1) as Ease,
                label,
                interval: intervals[i] ?? "",
            })),
        );
    }

    async answer(ease: Ease): Promise<void> {
        const card = this.card;
        if (!card || get(this.state) !== "answer") {
            return;
        }
        if (this.practice) {
            if (ease !== 1 && ease !== 3) {
                return;
            }
            this.state.set("transition");
            this.clearAdvanceTimer();
            if (ease === 1) {
                this.practice.again();
            } else {
                this.practice.good();
            }
        } else {
            if (!this.states) {
                return;
            }
            const answer = buildCardAnswer(card.id, this.states, ease, Date.now(), Date.now() - this.timerStarted);
            this.state.set("transition");
            this.clearAdvanceTimer();
            await answerCard(answer);
            if (answer.newState && (await stateIsLeech(answer.newState)).val) {
                this.notice.set(tr.studyingCardWasALeech());
            }
        }
        this.reps += 1;
        // `check_timebox` in reviewer.py: pause for the prompt instead of moving on.
        const hit = timeboxReached(this.timebox, Date.now(), this.reps);
        if (hit) {
            this.timeboxHit.set(hit);
            return;
        }
        await this.nextCard();
    }

    // ---- auto advance ----

    toggleAutoAdvance(): void {
        const enabled = !get(this.autoAdvance);
        this.autoAdvance.set(enabled);
        this.notice.set(enabled ? tr.actionsAutoAdvanceActivated() : tr.actionsAutoAdvanceDeactivated());
        if (!enabled) {
            this.clearAdvanceTimer();
        } else if (get(this.state) === "question") {
            this.scheduleAdvance(this.config?.secondsToShowQuestion ?? 0, () => this.onQuestionTimeout());
        } else if (get(this.state) === "answer") {
            this.scheduleAdvance(this.config?.secondsToShowAnswer ?? 0, () => this.onAnswerTimeout());
        }
    }

    private clearAdvanceTimer(): void {
        clearTimeout(this.advanceTimer);
        this.advanceTimer = undefined;
        this.pendingAdvance = null;
    }

    private scheduleAdvance(seconds: number, action: () => void): void {
        this.clearAdvanceTimer();
        if (!get(this.autoAdvance) || !seconds) {
            return;
        }
        this.advanceTimer = setTimeout(() => this.runAdvance(action), seconds * 1000);
    }

    /** Honour "wait for audio" and switch auto-advance off when the app is
     * in the background, like the Qt reviewer. */
    private runAdvance(action: () => void): void {
        if (!this.card || !get(this.autoAdvance)) {
            return;
        }
        if ((this.config?.waitForAudio ?? false) && avPlayer.playing) {
            this.pendingAdvance = () => this.runAdvance(action);
            return;
        }
        if (typeof document !== "undefined" && !document.hasFocus()) {
            this.autoAdvance.set(false);
            return;
        }
        action();
    }

    private onQuestionTimeout(): void {
        const step = questionTimeoutStep(this.config?.questionAction);
        if (step.kind === "showAnswer") {
            void this.showAnswer();
        } else {
            this.notice.set(tr.studyingQuestionTimeElapsed());
        }
    }

    private onAnswerTimeout(): void {
        if (this.practice) {
            // The preset's action could bury the card, which practice must not do on its own.
            void this.answer(3);
            return;
        }
        const step = answerTimeoutStep(this.config?.answerAction);
        switch (step.kind) {
            case "answer":
                void this.answer(step.ease);
                break;
            case "bury":
                void this.buryCard();
                break;
            case "reminder":
                this.notice.set(tr.studyingAnswerTimeElapsed());
                break;
            default:
                break;
        }
    }

    /** Enter/space: reveal the answer, or rate Good once it is shown. */
    async onEnter(): Promise<void> {
        const state = get(this.state);
        if (state === "question") {
            await this.showAnswer();
        } else if (state === "answer") {
            await this.answer(3);
        }
    }

    /** Undo the last operation; returns its name, or null if nothing to undo. */
    async undo(): Promise<string | null> {
        try {
            const result = await undoLast();
            if (result.kind === "nothing") {
                return null;
            }
            await this.refresh();
            return result.operation || null;
        } catch {
            return null;
        }
    }

    onBridgeCommand(command: string): void {
        if (command === "ans") {
            void this.showAnswer();
        } else if (command.startsWith("ease")) {
            const ease = Number(command.slice(4)) as Ease;
            if (ease >= 1 && ease <= 4) {
                void this.answer(ease);
            }
        } else if (command.startsWith("play:")) {
            this.playClicked(command);
        } else if (command === "statesMutated") {
            this.statesMutated = true;
        } else if (command === "updateToolbar" || command === "repaintNeeded") {
            // Qt-only concerns.
        } else {
            console.warn("unhandled reviewer bridge command", command);
        }
    }

    private playClicked(command: string): void {
        const [, side, index] = command.split(":");
        const tags = side === "q" ? this.rendered?.questionTags : this.rendered?.answerTags;
        const tag = tags?.[Number(index)];
        if (tag) {
            avPlayer.playTags([tag]);
        }
    }

    replayAudio(): void {
        const rendered = this.rendered;
        if (!rendered) {
            return;
        }
        if (get(this.state) === "question") {
            avPlayer.playTags(rendered.questionTags);
        } else if (get(this.state) === "answer") {
            const replayQuestion = !(this.config?.skipQuestionWhenReplayingAnswer ?? false);
            avPlayer.playTags(
                replayQuestion ? [...rendered.questionTags, ...rendered.answerTags] : rendered.answerTags,
            );
        }
    }

    async setCardFlag(flag: number): Promise<void> {
        const card = this.card;
        if (!card) {
            return;
        }
        const next = get(this.flag) === flag ? 0 : flag;
        await setFlag({ cardIds: [card.id], flag: next });
        card.flags = (card.flags & ~0b111) | next;
        this.flag.set(next);
        this.view?.drawFlag(next);
    }

    async toggleMark(): Promise<void> {
        const note = this.note;
        if (!note) {
            return;
        }
        if (get(this.marked)) {
            await removeNoteTags({ noteIds: [note.id], tags: MARKED_TAG });
            note.tags = note.tags.filter((t) => t.toLowerCase() !== MARKED_TAG);
            this.marked.set(false);
        } else {
            await addNoteTags({ noteIds: [note.id], tags: MARKED_TAG });
            note.tags = [...note.tags, MARKED_TAG];
            this.marked.set(true);
        }
        this.view?.drawMark(get(this.marked));
    }

    private async buryOrSuspend(mode: BuryOrSuspendCardsRequest_Mode, wholeNote: boolean): Promise<void> {
        const card = this.card;
        if (!card) {
            return;
        }
        await this.removeFromPractice(card, wholeNote);
        await buryOrSuspendCards({
            cardIds: wholeNote ? [] : [card.id],
            noteIds: wholeNote ? [card.noteId] : [],
            mode,
        });
        await this.nextCard();
    }

    /** Practice picks its own next card, so it has to hear what just left the deck. */
    private async removeFromPractice(card: Card, wholeNote: boolean): Promise<void> {
        if (this.practice) {
            this.practice.remove(wholeNote ? (await cardsOfNote({ nid: card.noteId })).cids : [card.id]);
        }
    }

    buryCard(): Promise<void> {
        return this.buryOrSuspend(BuryOrSuspendCardsRequest_Mode.BURY_USER, false);
    }

    buryNote(): Promise<void> {
        return this.buryOrSuspend(BuryOrSuspendCardsRequest_Mode.BURY_USER, true);
    }

    suspendCard(): Promise<void> {
        return this.buryOrSuspend(BuryOrSuspendCardsRequest_Mode.SUSPEND, false);
    }

    suspendNote(): Promise<void> {
        return this.buryOrSuspend(BuryOrSuspendCardsRequest_Mode.SUSPEND, true);
    }

    async deleteNote(): Promise<void> {
        const card = this.card;
        if (!card) {
            return;
        }
        await this.removeFromPractice(card, true);
        await removeNotes({ noteIds: [card.noteId], cardIds: [] });
        await this.nextCard();
    }

    pauseAudio(): void {
        avPlayer.togglePause();
    }

    seekAudio(seconds: number): void {
        avPlayer.seekRelative(seconds);
    }
}
