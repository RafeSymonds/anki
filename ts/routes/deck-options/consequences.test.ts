// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import {
    firstSentence,
    newCardsConsequence,
    retentionConsequence,
    reviewLimitConsequence,
    reviewsAfterMonth,
} from "./consequences";

describe("deck option consequences", () => {
    it("estimates reviews from new cards", () => {
        expect(reviewsAfterMonth(20)).toBe(100);
        expect(reviewsAfterMonth(0)).toBe(0);
        expect(newCardsConsequence(20)).toBe("20 new cards a day means roughly 100 reviews a day after a month.");
        expect(newCardsConsequence(1)).toContain("1 new card a day");
        expect(newCardsConsequence(0)).toMatch(/No new cards/);
    });

    it("warns when the review limit cannot keep up", () => {
        expect(reviewLimitConsequence(200, 20)).toBe("Once 200 reviews are done, the rest wait until tomorrow.");
        expect(reviewLimitConsequence(50, 20)).toMatch(/below the roughly 100/);
        expect(reviewLimitConsequence(0, 20)).toMatch(/No reviews/);
    });

    it("turns retention into forgotten cards per hundred", () => {
        expect(retentionConsequence(0.9)).toBe(
            "At 90%, about 10 in 100 due cards will be forgotten; higher means more reviews per day.",
        );
        expect(retentionConsequence(0.99)).toContain("about 1 in 100");
    });

    it("takes the first plain sentence of markdown help", () => {
        expect(firstSentence("The **maximum** number of new cards. See [the manual](https://x) for more.")).toBe(
            "The maximum number of new cards.",
        );
        expect(firstSentence("No period here")).toBe("No period here");
    });
});
