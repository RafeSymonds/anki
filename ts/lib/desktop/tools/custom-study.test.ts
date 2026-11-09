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
    CUSTOM_STUDY_KINDS,
    customStudyRequest,
    DYN_MAX_SIZE,
    initialTagSelection,
    spinnerFor,
} from "./custom-study";

const defaults = new CustomStudyDefaultsResponse({
    tags: [
        { name: "a", include: true, exclude: false },
        { name: "b", include: false, exclude: true },
        { name: "c", include: false, exclude: false },
    ],
});

describe("spinnerFor", () => {
    it("mirrors onRadioChange in customstudy.py", () => {
        expect(spinnerFor("forgot")).toEqual({ min: 1, max: 30, value: 1 });
        expect(spinnerFor("ahead")).toEqual({ min: 1, max: DYN_MAX_SIZE, value: 1 });
        expect(spinnerFor("preview")).toEqual({ min: 1, max: DYN_MAX_SIZE, value: 1 });
        expect(spinnerFor("cram")).toEqual({ min: 1, max: DYN_MAX_SIZE, value: 100 });
    });
});

describe("CUSTOM_STUDY_KINDS", () => {
    it("offers nothing that raises a limit", () => {
        expect(CUSTOM_STUDY_KINDS).toEqual(["forgot", "ahead", "preview", "cram"]);
    });
});

describe("clampSpinner", () => {
    it("keeps typed values inside the range", () => {
        const spec = spinnerFor("forgot");
        expect(clampSpinner(45, spec)).toBe(30);
        expect(clampSpinner(0, spec)).toBe(1);
        expect(clampSpinner(2.7, spec)).toBe(2);
        expect(clampSpinner(Number.NaN, spec)).toBe(1);
    });
});

describe("customStudyRequest", () => {
    it("sets the oneof for each option (accept in customstudy.py)", () => {
        const deckId = 5n;
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
