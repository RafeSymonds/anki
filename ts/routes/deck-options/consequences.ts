// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * One sentence of consequence under each essential setting (plan item
 * A31), and the first sentence of a setting's help shown inline (A32).
 * The review estimate is a rule of thumb, not a simulation: a month in,
 * each new card a day costs about five reviews a day.
 */

export const REVIEWS_PER_NEW_CARD = 5;

export function reviewsAfterMonth(newPerDay: number): number {
    return Math.round(Math.max(0, newPerDay) * REVIEWS_PER_NEW_CARD);
}

export function newCardsConsequence(newPerDay: number): string {
    if (newPerDay <= 0) {
        return "No new cards: you only review what you already learned.";
    }
    return `${newPerDay} new ${newPerDay === 1 ? "card" : "cards"} a day means roughly ${
        reviewsAfterMonth(newPerDay)
    } reviews a day after a month.`;
}

export function reviewLimitConsequence(reviewsPerDay: number, newPerDay: number): string {
    const needed = reviewsAfterMonth(newPerDay);
    if (reviewsPerDay <= 0) {
        return "No reviews: cards that come due wait until you raise this.";
    }
    if (needed > reviewsPerDay) {
        return `${reviewsPerDay} a day is below the roughly ${needed} your new cards will need; due cards will pile up.`;
    }
    return `Once ${reviewsPerDay} reviews are done, the rest wait until tomorrow.`;
}

export function retentionConsequence(retention: number): string {
    const forgotten = Math.max(1, Math.round((1 - retention) * 100));
    const percent = Math.round(retention * 100);
    return `At ${percent}%, about ${forgotten} in 100 due cards will be forgotten; higher means more reviews per day.`;
}

/** The first sentence of a help text, without markdown emphasis or links. */
export function firstSentence(markdown: string): string {
    const plain = markdown
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const match = /^(.+?[.!?])(\s|$)/.exec(plain);
    return match ? match[1] : plain;
}
