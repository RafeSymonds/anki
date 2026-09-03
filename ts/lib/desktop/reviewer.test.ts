// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { Card } from "@generated/anki/cards_pb";
import {
    CardAnswer_Rating,
    QueuedCards,
    QueuedCards_Queue,
    QueuedCards_QueuedCard,
    SchedulingState,
    SchedulingStates,
} from "@generated/anki/scheduler_pb";
import { describe, expect, it } from "vitest";

import {
    DeckConfig_Config_AnswerAction as AnswerAction,
    DeckConfig_Config_QuestionAction as QuestionAction,
} from "@generated/anki/deck_config_pb";

import {
    answerTimeoutStep,
    buildCardAnswer,
    countsForQueue,
    currentDeckId,
    questionTimeoutStep,
    ratingFromEase,
    remainingText,
    stateForEase,
    timeboxReached,
    userFlag,
} from "./reviewer";

function states(): SchedulingStates {
    const state = (secs: number) =>
        new SchedulingState({
            kind: {
                case: "normal",
                value: { kind: { case: "learning", value: { scheduledSecs: secs, remainingSteps: 1 } } },
            },
        });
    return new SchedulingStates({
        current: state(0),
        again: state(60),
        hard: state(300),
        good: state(600),
        easy: state(86400),
    });
}

describe("ratings", () => {
    it("maps the four ease buttons onto ratings and states", () => {
        expect(ratingFromEase(1)).toBe(CardAnswer_Rating.AGAIN);
        expect(ratingFromEase(2)).toBe(CardAnswer_Rating.HARD);
        expect(ratingFromEase(3)).toBe(CardAnswer_Rating.GOOD);
        expect(ratingFromEase(4)).toBe(CardAnswer_Rating.EASY);
        const s = states();
        expect(stateForEase(s, 1)).toBe(s.again);
        expect(stateForEase(s, 4)).toBe(s.easy);
    });
});

describe("buildCardAnswer", () => {
    it("carries the chosen state, timing and rating like pylib's build_answer", () => {
        const s = states();
        const answer = buildCardAnswer(42n, s, 3, 1_700_000_000_000, 4321.6);
        expect(answer.cardId).toBe(42n);
        expect(answer.rating).toBe(CardAnswer_Rating.GOOD);
        expect(answer.currentState).toBe(s.current);
        expect(answer.newState).toBe(s.good);
        expect(answer.answeredAtMillis).toBe(1_700_000_000_000n);
        expect(answer.millisecondsTaken).toBe(4322);
    });

    it("never reports negative time", () => {
        expect(buildCardAnswer(1n, states(), 1, 0, -5).millisecondsTaken).toBe(0);
    });
});

describe("countsForQueue", () => {
    it("highlights the count the top card belongs to", () => {
        const queued = new QueuedCards({
            newCount: 3,
            learningCount: 2,
            reviewCount: 9,
            cards: [new QueuedCards_QueuedCard({ queue: QueuedCards_Queue.LEARNING })],
        });
        expect(countsForQueue(queued)).toEqual({ idx: 1, counts: [3, 2, 9] });
        const review = new QueuedCards({ cards: [new QueuedCards_QueuedCard({ queue: QueuedCards_Queue.REVIEW })] });
        expect(countsForQueue(review).idx).toBe(2);
    });
});

describe("card helpers", () => {
    it("reads the user flag from the low bits and the home deck of a filtered card", () => {
        const card = new Card({ flags: 0b1011, deckId: 5n, originalDeckId: 0n });
        expect(userFlag(card)).toBe(3);
        expect(currentDeckId(card)).toBe(5n);
        const filtered = new Card({ deckId: 7n, originalDeckId: 5n });
        expect(currentDeckId(filtered)).toBe(5n);
    });
});

describe("timebox", () => {
    it("is off without a limit and fires once the limit has passed", () => {
        expect(timeboxReached(null, 1000, 5)).toBeNull();
        expect(timeboxReached({ startedAt: 0, startReps: 0, limitSecs: 0 }, 10_000_000, 5)).toBeNull();
        const box = { startedAt: 0, startReps: 3, limitSecs: 600 };
        expect(timeboxReached(box, 599_000, 10)).toBeNull();
        expect(timeboxReached(box, 601_000, 10)).toEqual({ minutes: 10, cards: 7 });
    });
});

describe("auto advance", () => {
    it("maps deck options onto the reviewer's steps", () => {
        expect(questionTimeoutStep(QuestionAction.SHOW_ANSWER)).toEqual({ kind: "showAnswer" });
        expect(questionTimeoutStep(undefined)).toEqual({ kind: "showAnswer" });
        expect(questionTimeoutStep(QuestionAction.SHOW_REMINDER)).toEqual({ kind: "reminder" });
        expect(answerTimeoutStep(AnswerAction.BURY_CARD)).toEqual({ kind: "bury" });
        expect(answerTimeoutStep(AnswerAction.ANSWER_AGAIN)).toEqual({ kind: "answer", ease: 1 });
        expect(answerTimeoutStep(AnswerAction.ANSWER_HARD)).toEqual({ kind: "answer", ease: 2 });
        expect(answerTimeoutStep(AnswerAction.ANSWER_GOOD)).toEqual({ kind: "answer", ease: 3 });
        expect(answerTimeoutStep(AnswerAction.SHOW_REMINDER)).toEqual({ kind: "reminder" });
        expect(answerTimeoutStep(undefined)).toEqual({ kind: "bury" });
    });
});

describe("remaining indicator", () => {
    it("adds up the three queues", () => {
        expect(remainingText({ idx: 0, counts: [5, 3, 4] })).toBe("12 left");
        expect(remainingText({ idx: 2, counts: [0, 0, 1] })).toBe("1 left");
        expect(remainingText({ idx: 0, counts: [0, 0, 0] })).toBe("0 left");
    });

    it("is empty until the counts are known", () => {
        expect(remainingText(null)).toBe("");
    });
});
