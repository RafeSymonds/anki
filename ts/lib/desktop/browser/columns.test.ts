// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import {
    BrowserColumns_Column,
    BrowserColumns_Sorting,
    BrowserRow_Cell_TextElideMode,
    BrowserRow_Color,
} from "@generated/anki/search_pb";
import { describe, expect, it } from "vitest";

import {
    activeColumnsKey,
    columnLabel,
    columnTemplate,
    columnWidth,
    defaultColumns,
    effectiveSort,
    elideClass,
    resizedWidth,
    rowColorName,
    rowColorVariable,
    sanitizeColumnWidths,
    sortAfterHeaderClick,
    sortBackwardsKey,
    sortColumnKey,
    toggleColumn,
} from "./columns";

function column(key: string, cards: BrowserColumns_Sorting, notes = cards): BrowserColumns_Column {
    return new BrowserColumns_Column({
        key,
        cardsModeLabel: `${key} (cards)`,
        notesModeLabel: `${key} (notes)`,
        sortingCards: cards,
        sortingNotes: notes,
    });
}

describe("config keys", () => {
    it("match the Python BrowserConfig", () => {
        expect(activeColumnsKey(false)).toBe("activeCols");
        expect(activeColumnsKey(true)).toBe("activeNoteCols");
        expect(sortColumnKey(false)).toBe("sortType");
        expect(sortColumnKey(true)).toBe("noteSortType");
        expect(sortBackwardsKey(false)).toBe("sortBackwards");
        expect(sortBackwardsKey(true)).toBe("browserNoteSortBackwards");
        expect(defaultColumns(false)).toEqual(["noteFld", "template", "cardDue", "deck"]);
        expect(defaultColumns(true)).toEqual(["noteFld", "note", "template", "noteTags"]);
        // A fresh copy each time, so callers can mutate.
        expect(defaultColumns(true)).not.toBe(defaultColumns(true));
    });
});

describe("toggleColumn", () => {
    it("appends missing columns and removes present ones", () => {
        expect(toggleColumn(["a", "b"], "c")).toEqual(["a", "b", "c"]);
        expect(toggleColumn(["a", "b"], "a")).toEqual(["b"]);
    });

    it("refuses to remove the last column", () => {
        expect(toggleColumn(["a"], "a")).toBeNull();
    });
});

describe("sortAfterHeaderClick", () => {
    const due = column("cardDue", BrowserColumns_Sorting.DESCENDING, BrowserColumns_Sorting.NONE);
    const field = column("noteFld", BrowserColumns_Sorting.ASCENDING);

    it("rejects columns that cannot sort in this mode", () => {
        expect(sortAfterHeaderClick({ column: "noteFld", reverse: false }, due, true)).toEqual({
            kind: "unsupported",
        });
    });

    it("starts a new column in its default direction and searches again", () => {
        expect(sortAfterHeaderClick({ column: "noteFld", reverse: true }, due, false)).toEqual({
            kind: "search",
            sort: { column: "cardDue", reverse: true },
        });
        expect(sortAfterHeaderClick({ column: "cardDue", reverse: true }, field, false)).toEqual({
            kind: "search",
            sort: { column: "noteFld", reverse: false },
        });
    });

    it("flips the direction of the current column without a search", () => {
        expect(sortAfterHeaderClick({ column: "noteFld", reverse: false }, field, false)).toEqual({
            kind: "reverse",
            sort: { column: "noteFld", reverse: true },
        });
    });

    it("labels depend on the mode", () => {
        expect(columnLabel(field, false)).toBe("noteFld (cards)");
        expect(columnLabel(field, true)).toBe("noteFld (notes)");
    });
});

describe("effectiveSort", () => {
    it("falls back to creation time when the configured column is unknown", () => {
        const columns = [column("noteFld", BrowserColumns_Sorting.ASCENDING)];
        expect(effectiveSort({ column: "addonCol", reverse: true }, columns)).toEqual({
            column: "noteCrt",
            reverse: true,
        });
        expect(effectiveSort({ column: "noteFld", reverse: false }, columns)).toEqual({
            column: "noteFld",
            reverse: false,
        });
    });
});

describe("row appearance", () => {
    it("maps colours onto theme variables", () => {
        expect(rowColorVariable(BrowserRow_Color.DEFAULT)).toBeNull();
        expect(rowColorVariable(BrowserRow_Color.MARKED)).toBe("--state-marked");
        expect(rowColorVariable(BrowserRow_Color.SUSPENDED)).toBe("--state-suspended");
        expect(rowColorVariable(BrowserRow_Color.BURIED)).toBe("--state-buried");
        expect(rowColorVariable(BrowserRow_Color.FLAG_RED)).toBe("--flag-1");
        expect(rowColorVariable(BrowserRow_Color.FLAG_PURPLE)).toBe("--flag-7");
        expect(rowColorName(BrowserRow_Color.FLAG_RED)).toBe("flag-red");
        expect(rowColorName(BrowserRow_Color.DEFAULT)).toBe("default");
    });

    it("maps elide modes onto classes", () => {
        expect(elideClass(BrowserRow_Cell_TextElideMode.ElideLeft)).toBe("elide-left");
        expect(elideClass(BrowserRow_Cell_TextElideMode.ElideMiddle)).toBe("elide-right");
        expect(elideClass(BrowserRow_Cell_TextElideMode.ElideNone)).toBe("elide-none");
    });
});

describe("column widths", () => {
    it("builds the grid template from stored widths with defaults, last column stretching", () => {
        expect(columnTemplate(["noteFld", "deck", "cardDue"], { deck: 200 })).toBe(
            "320px 200px minmax(110px, 1fr)",
        );
        expect(columnTemplate(["noteFld"], {})).toBe("minmax(320px, 1fr)");
        expect(columnWidth("deck", { deck: 90 })).toBe(90);
    });

    it("clamps a drag to the minimum width", () => {
        expect(resizedWidth(200, 35.4)).toBe(235);
        expect(resizedWidth(200, -500)).toBe(48);
    });

    it("drops malformed stored widths", () => {
        expect(sanitizeColumnWidths({ deck: 150.6, noteFld: "wide", tags: 10, cardDue: NaN })).toEqual({ deck: 151 });
        expect(sanitizeColumnWidths(null)).toEqual({});
    });
});
