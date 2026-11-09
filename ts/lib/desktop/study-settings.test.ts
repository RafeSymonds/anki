// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, test } from "vitest";

import {
    describeMinutes,
    describeSteps,
    LEARNING_PACES,
    paceMatching,
    RETENTION_CHOICES,
    retentionChoice,
    retentionSummary,
    sessionLabel,
    sessionSummary,
} from "./study-settings";

describe("learning pace", () => {
    test("matches the steps a deck has", () => {
        expect(paceMatching([1, 10])).toBe("standard");
        expect(paceMatching([10, 60, 1440])).toBe("spread");
        expect(paceMatching([1, 10, 60])).toBe(null);
        expect(paceMatching([])).toBe(null);
    });

    test("every pace ends further out than it starts", () => {
        for (const pace of LEARNING_PACES) {
            const sorted = [...pace.steps].sort((a, b) => a - b);
            expect(pace.steps).toEqual(sorted);
        }
    });

    test("describes steps in the largest unit that fits", () => {
        expect(describeMinutes(0.5)).toBe("30 seconds");
        expect(describeMinutes(1)).toBe("1 minute");
        expect(describeMinutes(10)).toBe("10 minutes");
        expect(describeMinutes(60)).toBe("1 hour");
        expect(describeMinutes(2880)).toBe("2 days");
        expect(describeSteps([1, 10])).toBe("Again after 1 minute, then 10 minutes.");
        expect(describeSteps([])).toContain("No learning steps");
    });
});

describe("target retention", () => {
    test("offers three points on the trade-off", () => {
        expect(RETENTION_CHOICES.map((choice) => choice.value)).toEqual([0.85, 0.9, 0.95]);
    });

    test("matches a stored value to a choice", () => {
        expect(retentionChoice(0.9)?.label).toBe("Balanced");
        expect(retentionChoice(0.9001)?.label).toBe("Balanced");
        expect(retentionChoice(0.8)).toBe(null);
    });

    test("states the trade-off in percentages", () => {
        expect(retentionSummary(0.9)).toContain("10%");
    });
});

describe("session length", () => {
    test("reads as a limit or as none", () => {
        expect(sessionLabel(0)).toBe("No limit");
        expect(sessionLabel(10)).toBe("10 min");
        expect(sessionSummary(0)).toContain("as long as you like");
        expect(sessionSummary(1)).toContain("1 minute,");
        expect(sessionSummary(20)).toContain("20 minutes");
    });
});
