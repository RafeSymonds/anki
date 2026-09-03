// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import {
    CustomStudyDefaultsResponse,
    CustomStudyRequest,
    CustomStudyRequest_Cram_CramKind,
} from "@generated/anki/scheduler_pb";
import { describe, expect, it } from "vitest";

import {
    clampSpinner,
    countWithChildren,
    customStudyRequest,
    DYN_MAX_SIZE,
    initialTagSelection,
    spinnerFor,
} from "./custom-study";

const defaults = new CustomStudyDefaultsResponse({
    extendNew: 3,
    extendReview: 7,
    availableNew: 12,
    availableNewInChildren: 4,
    availableReview: 0,
    availableReviewInChildren: 0,
    tags: [
        { name: "a", include: true, exclude: false },
        { name: "b", include: false, exclude: true },
        { name: "c", include: false, exclude: false },
    ],
});

describe("spinnerFor", () => {
    it("mirrors onRadioChange in customstudy.py", () => {
        expect(spinnerFor("new", defaults)).toEqual({ min: -DYN_MAX_SIZE, max: DYN_MAX_SIZE, value: 3 });
        expect(spinnerFor("review", defaults)).toEqual({ min: -DYN_MAX_SIZE, max: DYN_MAX_SIZE, value: 7 });
        expect(spinnerFor("forgot", defaults)).toEqual({ min: 1, max: 30, value: 1 });
        expect(spinnerFor("ahead", defaults)).toEqual({ min: 1, max: DYN_MAX_SIZE, value: 1 });
        expect(spinnerFor("preview", defaults)).toEqual({ min: 1, max: DYN_MAX_SIZE, value: 1 });
        expect(spinnerFor("cram", defaults)).toEqual({ min: 1, max: DYN_MAX_SIZE, value: 100 });
    });
});

describe("clampSpinner", () => {
    it("keeps typed values inside the range", () => {
        const spec = spinnerFor("forgot", defaults);
        expect(clampSpinner(45, spec)).toBe(30);
        expect(clampSpinner(0, spec)).toBe(1);
        expect(clampSpinner(2.7, spec)).toBe(2);
        expect(clampSpinner(Number.NaN, spec)).toBe(1);
    });
});

describe("countWithChildren", () => {
    it("adds the subdeck count only when there is one", () => {
        expect(countWithChildren(12, 0)).toBe("12");
        // Translations are not loaded under vitest; the child count is appended as its own phrase.
        expect(countWithChildren(12, 4)).toMatch(/^12 .+/);
    });
});

describe("customStudyRequest", () => {
    it("sets the oneof for each option (accept in customstudy.py)", () => {
        const deckId = 5n;
        expect(new CustomStudyRequest(customStudyRequest(deckId, "new", -2)).value).toEqual({
            case: "newLimitDelta",
            value: -2,
        });
        expect(new CustomStudyRequest(customStudyRequest(deckId, "review", 9)).value).toEqual({
            case: "reviewLimitDelta",
            value: 9,
        });
        expect(new CustomStudyRequest(customStudyRequest(deckId, "forgot", 3)).value).toEqual({
            case: "forgotDays",
            value: 3,
        });
        expect(new CustomStudyRequest(customStudyRequest(deckId, "ahead", 2)).value).toEqual({
            case: "reviewAheadDays",
            value: 2,
        });
        expect(new CustomStudyRequest(customStudyRequest(deckId, "preview", 1)).value).toEqual({
            case: "previewDays",
            value: 1,
        });
    });

    it("builds a cram with its kind, limit and tags", () => {
        const request = new CustomStudyRequest(
            customStudyRequest(1n, "cram", 50, { type: "review", include: ["a"], exclude: ["b"] }),
        );
        expect(request.deckId).toBe(1n);
        expect(request.value.case).toBe("cram");
        const cram = request.value.case === "cram" ? request.value.value : undefined;
        expect(cram?.kind).toBe(CustomStudyRequest_Cram_CramKind.REVIEW);
        expect(cram?.cardLimit).toBe(50);
        expect(cram?.tagsToInclude).toEqual(["a"]);
        expect(cram?.tagsToExclude).toEqual(["b"]);
        const all = customStudyRequest(1n, "cram", 1, { type: "all", include: [], exclude: [] });
        expect(all.value.case === "cram" && all.value.value.kind).toBe(CustomStudyRequest_Cram_CramKind.ALL);
    });
});

describe("initialTagSelection", () => {
    it("preselects the tags remembered from last time", () => {
        expect(initialTagSelection(defaults.tags)).toEqual({ include: ["a"], exclude: ["b"] });
    });
});
