// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { firstSentence, retentionConsequence } from "./consequences";

describe("deck option consequences", () => {
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
