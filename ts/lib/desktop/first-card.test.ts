// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { answerGuide, guideNeeded } from "./first-card";

describe("first card guide", () => {
    it("explains each button with the interval it shows", () => {
        const rows = answerGuide([
            { ease: 1, label: "Again", interval: "<1m" },
            { ease: 3, label: "Good", interval: "10m" },
            { ease: 4, label: "Easy", interval: "4d" },
        ]);
        expect(rows.map((r) => r.label)).toEqual(["Again", "Good", "Easy"]);
        expect(rows[0].interval).toBe("<1m");
        expect(rows[0].explanation).toMatch(/did not remember/);
        expect(rows[2].explanation).toMatch(/too easy/);
    });

    it("is needed until the flag has been stored as true", () => {
        expect(guideNeeded(null)).toBe(true);
        expect(guideNeeded(undefined)).toBe(true);
        expect(guideNeeded(false)).toBe(true);
        expect(guideNeeded(true)).toBe(false);
    });
});
