// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { EmptyCardsReport } from "@generated/anki/card_rendering_pb";
import { describe, expect, it } from "vitest";

import { chunked, databaseCheckMessage, emptyCardsReportHtml, emptyCardsToDelete } from "./maintenance";

describe("databaseCheckMessage", () => {
    it("lists the problems and ends with the rebuilt line (fix_integrity)", () => {
        // Translations are not loaded under vitest; the last line is the "rebuilt" notice.
        const rebuilt = databaseCheckMessage([]);
        expect(rebuilt).not.toContain("\n");
        expect(databaseCheckMessage(["Fixed 2 cards", "Missing deck"])).toBe(
            `Fixed 2 cards\nMissing deck\n${rebuilt}`,
        );
    });
});

describe("emptyCardsToDelete", () => {
    const report = new EmptyCardsReport({
        report: "",
        notes: [
            { noteId: 1n, cardIds: [11n, 12n], willDeleteNote: true },
            { noteId: 2n, cardIds: [21n], willDeleteNote: false },
            { noteId: 3n, cardIds: [31n, 32n, 33n], willDeleteNote: true },
        ],
    });

    it("keeps one card of each note that would otherwise vanish (_delete_cards)", () => {
        expect(emptyCardsToDelete(report, true)).toEqual([12n, 21n, 32n, 33n]);
    });

    it("deletes everything when notes need not be kept", () => {
        expect(emptyCardsToDelete(report, false)).toEqual([11n, 12n, 21n, 31n, 32n, 33n]);
    });
});

describe("emptyCardsReportHtml", () => {
    it("turns the note id markers into plain text", () => {
        expect(emptyCardsReportHtml("<div>[anki:nid:1234]Card 2</div>")).toBe("<div>1234: Card 2</div>");
    });
});

describe("chunked", () => {
    it("splits into fixed-size groups", () => {
        expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunked([], 25)).toEqual([]);
    });
});
