// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, test } from "vitest";

import {
    categoryUrl,
    displayName,
    fileSubtitle,
    formatSize,
    isCollectionFile,
    relativeTime,
    SHARED_CATEGORIES,
    SHARED_DECKS_URL,
} from "./shared-decks";

describe("links to AnkiWeb", () => {
    test("searches the shared list for a subject", () => {
        expect(categoryUrl("japanese")).toBe(`${SHARED_DECKS_URL}?search=japanese`);
    });

    test("escapes a term with a space in it", () => {
        expect(categoryUrl("exam prep")).toBe(`${SHARED_DECKS_URL}?search=exam%20prep`);
    });

    test("offers subjects with a hint each", () => {
        expect(SHARED_CATEGORIES.length).toBeGreaterThanOrEqual(6);
        for (const category of SHARED_CATEGORIES) {
            expect(category.label).not.toBe("");
            expect(category.hint).not.toBe("");
            expect(category.search).not.toBe("");
        }
    });
});

describe("naming a downloaded file", () => {
    test("drops the extension", () => {
        expect(displayName("Japanese Core 2000.apkg")).toBe("Japanese Core 2000");
        expect(displayName("backup.colpkg")).toBe("backup");
        expect(displayName("Mixed.APKG")).toBe("Mixed");
    });

    test("reads underscores as spaces", () => {
        expect(displayName("French_Verbs_1000.apkg")).toBe("French Verbs 1000");
    });

    test("keeps a name that is only an extension", () => {
        expect(displayName(".apkg")).toBe(".apkg");
    });
});

describe("file sizes", () => {
    test("scales to the unit a person would use", () => {
        expect(formatSize(400)).toBe("400 bytes");
        expect(formatSize(840_000)).toBe("820 KB");
        expect(formatSize(14_800_000)).toBe("14.1 MB");
        expect(formatSize(400_000_000)).toBe("381 MB");
    });

    test("says nothing for a size that makes no sense", () => {
        expect(formatSize(-1)).toBe("");
        expect(formatSize(NaN)).toBe("");
    });
});

describe("how long ago it was downloaded", () => {
    const now = 1_700_000_000_000;
    const secondsAgo = (n: number) => now / 1000 - n;

    test("counts in the largest unit that fits", () => {
        expect(relativeTime(secondsAgo(5), now)).toBe("just now");
        expect(relativeTime(secondsAgo(60), now)).toBe("1 minute ago");
        expect(relativeTime(secondsAgo(3 * 60), now)).toBe("3 minutes ago");
        expect(relativeTime(secondsAgo(60 * 60), now)).toBe("1 hour ago");
        expect(relativeTime(secondsAgo(5 * 3600), now)).toBe("5 hours ago");
        expect(relativeTime(secondsAgo(3 * 86400), now)).toBe("3 days ago");
        expect(relativeTime(secondsAgo(90 * 86400), now)).toBe("3 months ago");
    });

    test("treats a file from the future as new", () => {
        expect(relativeTime(secondsAgo(-500), now)).toBe("just now");
    });
});

describe("the line under a file", () => {
    const file = { name: "Japanese.apkg", path: "/d/Japanese.apkg", size: 2_100_000, modified: 1_699_996_400 };

    test("gives the size and the age", () => {
        expect(fileSubtitle(file, 1_700_000_000_000)).toBe("2.0 MB · downloaded 1 hour ago");
    });

    test("warns that a collection package replaces everything", () => {
        expect(isCollectionFile("backup.colpkg")).toBe(true);
        expect(isCollectionFile("deck.apkg")).toBe(false);
        const collection = { ...file, name: "backup.colpkg" };
        expect(fileSubtitle(collection, 1_700_000_000_000)).toContain(
            "replaces your whole collection",
        );
    });
});
