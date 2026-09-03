// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { DeckConfig_Config } from "@generated/anki/deck_config_pb";
import { Deck, Deck_Normal, Deck_Normal_DayLimit } from "@generated/anki/decks_pb";
import { CongratsInfoResponse, CustomStudyDefaultsResponse } from "@generated/anki/scheduler_pb";
import { describe, expect, it } from "vitest";

import { effectiveLimits, extendStep, limitNotices } from "./limits";

const config = new DeckConfig_Config({ newPerDay: 20, reviewsPerDay: 200 });

function normalDeck(normal: Partial<Deck_Normal>): Deck {
    return new Deck({ id: 5n, name: "D", kind: { case: "normal", value: new Deck_Normal(normal) } });
}

describe("effectiveLimits", () => {
    it("falls back to the preset", () => {
        expect(effectiveLimits(normalDeck({}), config, 10)).toEqual({ newPerDay: 20, reviewsPerDay: 200 });
        expect(effectiveLimits(null, null, 10)).toEqual({ newPerDay: 20, reviewsPerDay: 200 });
    });

    it("prefers the deck's own limit, then today's override when it is for today", () => {
        expect(effectiveLimits(normalDeck({ newLimit: 5, reviewLimit: 50 }), config, 10)).toEqual({
            newPerDay: 5,
            reviewsPerDay: 50,
        });
        const withToday = normalDeck({
            newLimit: 5,
            newLimitToday: new Deck_Normal_DayLimit({ limit: 30, today: 10 }),
            reviewLimitToday: new Deck_Normal_DayLimit({ limit: 300, today: 9 }),
        });
        expect(effectiveLimits(withToday, config, 10)).toEqual({ newPerDay: 30, reviewsPerDay: 200 });
    });
});

describe("limitNotices", () => {
    it("reports each limit that stopped the queue with what is waiting", () => {
        const info = new CongratsInfoResponse({ newRemaining: true, reviewRemaining: true });
        const defaults = new CustomStudyDefaultsResponse({
            availableNew: 4,
            availableNewInChildren: 3,
            availableReview: 40,
            availableReviewInChildren: 0,
        });
        expect(limitNotices(info, defaults, { newPerDay: 20, reviewsPerDay: 200 })).toEqual([
            { kind: "new", limit: 20, waiting: 7, step: 7 },
            { kind: "review", limit: 200, waiting: 40, step: 10 },
        ]);
    });

    it("is empty when nothing is held back", () => {
        const info = new CongratsInfoResponse({ newRemaining: false, reviewRemaining: false });
        expect(limitNotices(info, new CustomStudyDefaultsResponse(), { newPerDay: 20, reviewsPerDay: 200 })).toEqual(
            [],
        );
    });
});

describe("extendStep", () => {
    it("offers up to ten and never more than are waiting", () => {
        expect(extendStep(0)).toBe(0);
        expect(extendStep(3)).toBe(3);
        expect(extendStep(50)).toBe(10);
        expect(extendStep(50, 5)).toBe(5);
    });
});
