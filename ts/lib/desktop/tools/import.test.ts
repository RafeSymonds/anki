// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { importTargetFor, isCollectionPackage, quotePath } from "./import";

describe("importTargetFor", () => {
    it("routes each file type to the page importing.py used", () => {
        expect(importTargetFor("/Users/me/My Deck.apkg")).toEqual({
            kind: "page",
            route: "/import-anki-package//Users/me/My%20Deck.apkg",
        });
        expect(importTargetFor("/x/notes.CSV")).toEqual({ kind: "page", route: "/import-csv//x/notes.CSV" });
        expect(importTargetFor("/x/a.tsv").kind).toBe("page");
        expect(importTargetFor("/x/a.txt").kind).toBe("page");
        expect(importTargetFor("/x/a.zip")).toEqual({ kind: "page", route: "/import-anki-package//x/a.zip" });
        expect(importTargetFor("/x/a.anki-json")).toEqual({ kind: "page", route: "/import-page//x/a.anki-json" });
    });

    it("sends collection packages to the native side", () => {
        expect(importTargetFor("/x/collection.apkg")).toEqual({ kind: "collection" });
        expect(importTargetFor("/x/backup-2024.apkg")).toEqual({ kind: "collection" });
        expect(importTargetFor("/x/Everything.colpkg")).toEqual({ kind: "collection" });
    });

    it("rejects what Python needed for", () => {
        expect(importTargetFor("/x/mnemosyne.db")).toEqual({ kind: "unsupported" });
        expect(importTargetFor("/x/readme")).toEqual({ kind: "unsupported" });
    });
});

describe("isCollectionPackage", () => {
    it("matches ColpkgImporter.can_import", () => {
        expect(isCollectionPackage("collection.apkg")).toBe(true);
        expect(isCollectionPackage("backup-1.apkg")).toBe(true);
        expect(isCollectionPackage("deck.apkg")).toBe(false);
        expect(isCollectionPackage("x.colpkg")).toBe(true);
    });
});

describe("quotePath", () => {
    it("escapes segments the way urllib.parse.quote does, keeping slashes", () => {
        expect(quotePath("/a b/c#d.csv")).toBe("/a%20b/c%23d.csv");
        expect(quotePath("plain.csv")).toBe("plain.csv");
    });
});
