// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { defaultFilename, defaultFormat, defaultOptions, exportCall, exportFormats, exportLimit } from "./export";

describe("export formats", () => {
    it("lists the four exporters with the options each one shows", () => {
        const ids = exportFormats().map((f) => [f.id, f.extension, f.deckList, f.options.join(",")]);
        expect(ids).toEqual([
            ["apkg", "apkg", true, "scheduling,deckConfigs,media,legacy"],
            ["colpkg", "colpkg", false, "media,legacy"],
            ["notes", "txt", true, "html,tags,deck,notetype,guid"],
            ["cards", "txt", true, "html"],
        ]);
    });

    it("defaults to a collection package from the menu and a deck package from a deck", () => {
        expect(defaultFormat(null)).toBe("colpkg");
        expect(defaultFormat(3n)).toBe("apkg");
        expect(defaultOptions(null).scheduling).toBe(true);
        expect(defaultOptions(3n).scheduling).toBe(false);
        expect(defaultOptions(null)).toMatchObject({ media: true, html: true, tags: true, legacy: false, guid: false });
    });
});

describe("defaultFilename", () => {
    it("uses the deck name with unsafe characters replaced", () => {
        expect(defaultFilename("apkg", "Japanese::Vocab/Verbs?")).toBe("Japanese__Vocab_Verbs_.apkg");
        expect(defaultFilename("notes", "All Decks")).toBe("All Decks.txt");
    });

    it("stamps collection packages with the time", () => {
        const now = new Date(2024, 0, 5, 9, 7, 3);
        // The stem is the translated word "collection"; translations are not loaded under vitest.
        expect(defaultFilename("colpkg", "ignored", now)).toMatch(/^.+-2024-01-05@09-07-03\.colpkg$/);
    });
});

describe("exportCall", () => {
    const options = { ...defaultOptions(null), deckConfigs: true, legacy: true, guid: true };

    it("maps the options onto each backend request (Exporter.export)", () => {
        expect(exportCall("apkg", options, "/out/a.apkg", 7n)).toEqual({
            method: "exportAnkiPackage",
            input: {
                outPath: "/out/a.apkg",
                options: { withScheduling: true, withDeckConfigs: true, withMedia: true, legacy: true },
                limit: { limit: { case: "deckId", value: 7n } },
            },
        });
        expect(exportCall("colpkg", options, "/out/c.colpkg", null)).toEqual({
            method: "exportCollectionPackage",
            input: { outPath: "/out/c.colpkg", includeMedia: true, legacy: true },
        });
        expect(exportCall("notes", options, "/out/n.txt", null)).toEqual({
            method: "exportNoteCsv",
            input: {
                outPath: "/out/n.txt",
                withHtml: true,
                withTags: true,
                withDeck: false,
                withNotetype: false,
                withGuid: true,
                limit: { limit: { case: "wholeCollection", value: {} } },
            },
        });
        expect(exportCall("cards", { ...options, html: false }, "/out/k.txt", 2n)).toEqual({
            method: "exportCardCsv",
            input: { outPath: "/out/k.txt", withHtml: false, limit: { limit: { case: "deckId", value: 2n } } },
        });
    });

    it("exports the whole collection when no deck is chosen", () => {
        expect(exportLimit(null)).toEqual({ limit: { case: "wholeCollection", value: {} } });
        expect(exportLimit(0n)).toEqual({ limit: { case: "wholeCollection", value: {} } });
    });
});
