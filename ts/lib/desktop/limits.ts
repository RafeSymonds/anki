// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * What to tell the user when today's daily limit stopped the queue, and
 * how much more to offer. The Qt congrats page only says "consider
 * increasing the limit in the options"; here the numbers and a one-click
 * extension are shown instead.
 */

import type { DeckConfig_Config } from "@generated/anki/deck_config_pb";
import type { Deck } from "@generated/anki/decks_pb";
import type { CongratsInfoResponse, CustomStudyDefaultsResponse } from "@generated/anki/scheduler_pb";

export interface DailyLimits {
    newPerDay: number;
    reviewsPerDay: number;
}

/** The limits in force today: a "today only" override, else the deck's
 * own limit, else the preset's, matching rslib's precedence. `today` is
 * the collection's day count, as in `Deck_Normal_DayLimit.today`. */
export function effectiveLimits(
    deck: Deck | null,
    config: DeckConfig_Config | null,
    today: number,
): DailyLimits {
    const base = {
        newPerDay: config?.newPerDay ?? 20,
        reviewsPerDay: config?.reviewsPerDay ?? 200,
    };
    if (deck?.kind.case !== "normal") {
        return base;
    }
    const normal = deck.kind.value;
    const newToday = normal.newLimitToday?.today === today ? normal.newLimitToday.limit : undefined;
    const reviewToday = normal.reviewLimitToday?.today === today ? normal.reviewLimitToday.limit : undefined;
    return {
        newPerDay: newToday ?? normal.newLimit ?? base.newPerDay,
        reviewsPerDay: reviewToday ?? normal.reviewLimit ?? base.reviewsPerDay,
    };
}

export interface LimitNotice {
    kind: "new" | "review";
    /** The limit that was reached. */
    limit: number;
    /** Cards available beyond it, children included. */
    waiting: number;
    /** How many more one click offers. */
    step: number;
}

/** A sensible one-click extension: up to ten, never more than are waiting. */
export function extendStep(waiting: number, max = 10): number {
    return Math.max(0, Math.min(waiting, max));
}

export function limitNotices(
    info: CongratsInfoResponse,
    defaults: CustomStudyDefaultsResponse,
    limits: DailyLimits,
): LimitNotice[] {
    const notices: LimitNotice[] = [];
    if (info.newRemaining) {
        const waiting = defaults.availableNew + defaults.availableNewInChildren;
        notices.push({ kind: "new", limit: limits.newPerDay, waiting, step: extendStep(waiting) });
    }
    if (info.reviewRemaining) {
        const waiting = defaults.availableReview + defaults.availableReviewInChildren;
        notices.push({ kind: "review", limit: limits.reviewsPerDay, waiting, step: extendStep(waiting) });
    }
    return notices;
}
