// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { filterNames, initialSelection, matchesFilter, moveSelection } from "./study-deck";

describe("matchesFilter", () => {
    it("needs every word, ignoring case (StudyDeck._matches)", () => {
        expect(matchesFilter("Japanese::Vocab", "")).toBe(true);
        expect(matchesFilter("Japanese::Vocab", "jap voc")).toBe(true);
        expect(matchesFilter("Japanese::Vocab", "jap kanji")).toBe(false);
        expect(matchesFilter("Japanese::Vocab", "  vocab ")).toBe(true);
    });
});

describe("filterNames", () => {
    it("keeps the original order", () => {
        expect(filterNames(["Default", "Music::Theory", "Music"], "mus")).toEqual(["Music::Theory", "Music"]);
    });
});

describe("initialSelection", () => {
    it("selects the current deck when listed, else the first row", () => {
        expect(initialSelection(["A", "B", "C"], "B")).toBe(1);
        expect(initialSelection(["A", "B"], "Z")).toBe(0);
        expect(initialSelection([], null)).toBe(0);
    });
});

describe("moveSelection", () => {
    it("wraps at both ends", () => {
        expect(moveSelection(0, 3, -1)).toBe(2);
        expect(moveSelection(2, 3, 1)).toBe(0);
        expect(moveSelection(1, 3, 1)).toBe(2);
        expect(moveSelection(0, 0, 1)).toBe(0);
    });
});
