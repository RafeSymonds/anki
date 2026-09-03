// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The study settings a person actually wants to change, in their words: how
 * much work a day, how hard to hold on to what they learn, how soon a new
 * card comes back, and how long a sitting lasts. Deck Options still has
 * every knob; this is the handful that change how studying feels, with the
 * consequence of each spelled out.
 */

import { reviewsAfterMonth } from "../../routes/deck-options/consequences";

export interface StudyPlan {
    newPerDay: number;
    reviewsPerDay: number;
}

export type StudyStyleId = "gentle" | "steady" | "fast";

export interface StudyStyle {
    id: StudyStyleId;
    label: string;
    /** What choosing it means, in one line. */
    hint: string;
    plan: StudyPlan;
}

/**
 * Three workloads, from a few minutes a day to an hour. The review limits
 * leave room for the reviews the new cards will generate (five a day for
 * each new card a day, a month in).
 */
export const STUDY_STYLES: StudyStyle[] = [
    {
        id: "gentle",
        label: "Gentle",
        hint: "5 new cards a day, about 5 minutes",
        plan: { newPerDay: 5, reviewsPerDay: 50 },
    },
    {
        id: "steady",
        label: "Steady",
        hint: "20 new cards a day, about 20 minutes",
        plan: { newPerDay: 20, reviewsPerDay: 200 },
    },
    {
        id: "fast",
        label: "Fast",
        hint: "40 new cards a day, about 40 minutes",
        plan: { newPerDay: 40, reviewsPerDay: 400 },
    },
];

/** Which of the three the deck currently matches, if any. */
export function styleMatching(plan: StudyPlan): StudyStyleId | null {
    return (
        STUDY_STYLES.find(
            (style) =>
                style.plan.newPerDay === plan.newPerDay
                && style.plan.reviewsPerDay === plan.reviewsPerDay,
        )?.id ?? null
    );
}

/** Minutes a day this plan costs, at ten seconds a card once it settles. */
export function estimatedMinutes(plan: StudyPlan): number {
    const reviews = Math.min(reviewsAfterMonth(plan.newPerDay), plan.reviewsPerDay);
    const cards = plan.newPerDay + reviews;
    return Math.max(1, Math.round((cards * 10) / 60));
}

export function workloadSummary(plan: StudyPlan): string {
    if (plan.newPerDay <= 0) {
        return "No new cards; you only review what you already learned.";
    }
    return `About ${estimatedMinutes(plan)} minutes a day once your reviews build up.`;
}

export type PaceId = "short" | "standard" | "spread";

export interface LearningPace {
    id: PaceId;
    label: string;
    hint: string;
    /** Learning steps in minutes, as deck config stores them. */
    steps: number[];
}

/**
 * How soon a card you just met comes back. Anki's default is 1m then 10m;
 * the other two suit people who want the card again in the same sitting, or
 * spread over the first day.
 */
export const LEARNING_PACES: LearningPace[] = [
    {
        id: "short",
        label: "Right away",
        hint: "Again in 1 and 5 minutes, then it graduates",
        steps: [1, 5],
    },
    {
        id: "standard",
        label: "Standard",
        hint: "Again in 1 and 10 minutes, then it graduates",
        steps: [1, 10],
    },
    {
        id: "spread",
        label: "Over the first day",
        hint: "Again after 10 minutes, an hour, then a day",
        steps: [10, 60, 1440],
    },
];

export function paceMatching(steps: number[]): PaceId | null {
    return (
        LEARNING_PACES.find(
            (pace) =>
                pace.steps.length === steps.length
                && pace.steps.every((step, i) => step === steps[i]),
        )?.id ?? null
    );
}

/** Free text for steps that match none of the three. */
export function describeSteps(steps: number[]): string {
    if (!steps.length) {
        return "No learning steps: a new card is scheduled by the algorithm at once.";
    }
    return `Again after ${steps.map(describeMinutes).join(", then ")}.`;
}

export function describeMinutes(minutes: number): string {
    if (minutes < 1) {
        return `${Math.round(minutes * 60)} seconds`;
    }
    if (minutes < 60) {
        return `${round(minutes)} minute${minutes === 1 ? "" : "s"}`;
    }
    if (minutes < 1440) {
        const hours = minutes / 60;
        return `${round(hours)} hour${hours === 1 ? "" : "s"}`;
    }
    const days = minutes / 1440;
    return `${round(days)} day${days === 1 ? "" : "s"}`;
}

function round(value: number): string {
    return String(Math.round(value * 10) / 10);
}

export interface RetentionChoice {
    value: number;
    label: string;
    hint: string;
}

/** Target retention, as the trade-off it is. */
export const RETENTION_CHOICES: RetentionChoice[] = [
    { value: 0.85, label: "Lighter", hint: "Forget about 15 in 100; the fewest reviews" },
    { value: 0.9, label: "Balanced", hint: "Forget about 10 in 100; Anki's default" },
    { value: 0.95, label: "Thorough", hint: "Forget about 5 in 100; many more reviews" },
];

/** The choice a stored value belongs to, so one of three can look selected. */
export function retentionChoice(value: number): RetentionChoice | null {
    return RETENTION_CHOICES.find((choice) => Math.abs(choice.value - value) < 0.005) ?? null;
}

export function retentionSummary(value: number): string {
    const percent = Math.round(value * 100);
    return `Cards are scheduled to come back when you have about a ${100 - percent}% chance of having forgotten them.`;
}

/** Session length, stored in seconds; 0 means no reminder. */
export function sessionSummary(minutes: number): string {
    if (minutes <= 0) {
        return "Study for as long as you like; Anki will not interrupt.";
    }
    return `After ${minutes} minute${minutes === 1 ? "" : "s"}, Anki asks whether to keep going.`;
}

export const SESSION_CHOICES = [0, 5, 10, 20, 30];

export function sessionLabel(minutes: number): string {
    return minutes <= 0 ? "No limit" : `${minutes} min`;
}

/** Keep a typed number sane before it reaches the backend. */
export function clampLimit(value: number, max = 9999): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(max, Math.max(0, Math.round(value)));
}
