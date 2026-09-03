// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Browser table columns and sorting: the config keys and defaults from
 * pylib/anki/browser.py, the header-click rules from
 * qt/aqt/browser/table/table.py, and how a BrowserRow's colour and cells map
 * onto CSS.
 */

import type { BrowserColumns_Column } from "@generated/anki/search_pb";
import { BrowserColumns_Sorting, BrowserRow_Cell_TextElideMode, BrowserRow_Color } from "@generated/anki/search_pb";

/** `BrowserConfig` in pylib/anki/browser.py. */
export const ACTIVE_CARD_COLUMNS_KEY = "activeCols";
export const ACTIVE_NOTE_COLUMNS_KEY = "activeNoteCols";
export const CARDS_SORT_COLUMN_KEY = "sortType";
export const NOTES_SORT_COLUMN_KEY = "noteSortType";
export const CARDS_SORT_BACKWARDS_KEY = "sortBackwards";
export const NOTES_SORT_BACKWARDS_KEY = "browserNoteSortBackwards";

/** `BrowserDefaults` in pylib/anki/browser.py. */
export const DEFAULT_CARD_COLUMNS = ["noteFld", "template", "cardDue", "deck"];
export const DEFAULT_NOTE_COLUMNS = ["noteFld", "note", "template", "noteTags"];

/** The column used when the configured one no longer exists (DataModel._search_inner). */
export const FALLBACK_SORT_COLUMN = "noteCrt";

export function activeColumnsKey(notesMode: boolean): string {
    return notesMode ? ACTIVE_NOTE_COLUMNS_KEY : ACTIVE_CARD_COLUMNS_KEY;
}

export function sortColumnKey(notesMode: boolean): string {
    return notesMode ? NOTES_SORT_COLUMN_KEY : CARDS_SORT_COLUMN_KEY;
}

export function sortBackwardsKey(notesMode: boolean): string {
    return notesMode ? NOTES_SORT_BACKWARDS_KEY : CARDS_SORT_BACKWARDS_KEY;
}

export function defaultColumns(notesMode: boolean): string[] {
    return [...(notesMode ? DEFAULT_NOTE_COLUMNS : DEFAULT_CARD_COLUMNS)];
}

export function columnLabel(column: BrowserColumns_Column, notesMode: boolean): string {
    return notesMode ? column.notesModeLabel : column.cardsModeLabel;
}

export function columnTooltip(column: BrowserColumns_Column, notesMode: boolean): string {
    return notesMode ? column.notesModeTooltip : column.cardsModeTooltip;
}

export function columnSorting(column: BrowserColumns_Column, notesMode: boolean): BrowserColumns_Sorting {
    return notesMode ? column.sortingNotes : column.sortingCards;
}

/**
 * Add or remove a column (`ItemState.toggle_active_column`). Returns null when
 * the change would leave no columns, which the Qt table refuses.
 */
export function toggleColumn(active: readonly string[], key: string): string[] | null {
    if (active.includes(key)) {
        if (active.length < 2) {
            return null;
        }
        return active.filter((k) => k !== key);
    }
    return [...active, key];
}

export interface SortState {
    column: string;
    reverse: boolean;
}

export type SortChange =
    | { kind: "unsupported" }
    | { kind: "unchanged" }
    /** A different column: run the search again. */
    | { kind: "search"; sort: SortState }
    /** Same column, other direction: the rows can simply be reversed. */
    | { kind: "reverse"; sort: SortState };

/**
 * What a click on a header means (`Table._on_sort_column_changed`). A new
 * column starts ascending unless it defaults to descending; clicking the
 * current column flips the direction.
 */
export function sortAfterHeaderClick(
    current: SortState,
    column: BrowserColumns_Column,
    notesMode: boolean,
): SortChange {
    const sorting = columnSorting(column, notesMode);
    if (sorting === BrowserColumns_Sorting.NONE) {
        return { kind: "unsupported" };
    }
    if (current.column !== column.key) {
        return {
            kind: "search",
            sort: { column: column.key, reverse: sorting === BrowserColumns_Sorting.DESCENDING },
        };
    }
    return { kind: "reverse", sort: { column: column.key, reverse: !current.reverse } };
}

/** The sort to use for a search; falls back like `DataModel._search_inner`. */
export function effectiveSort(sort: SortState, columns: readonly BrowserColumns_Column[]): SortState {
    if (columns.some((c) => c.key === sort.column)) {
        return sort;
    }
    return { column: FALLBACK_SORT_COLUMN, reverse: sort.reverse };
}

/** The theme variable behind a row colour (`backend_color_to_aqt_color`). */
export function rowColorVariable(color: BrowserRow_Color): string | null {
    switch (color) {
        case BrowserRow_Color.MARKED:
            return "--state-marked";
        case BrowserRow_Color.SUSPENDED:
            return "--state-suspended";
        case BrowserRow_Color.BURIED:
            return "--state-buried";
        case BrowserRow_Color.FLAG_RED:
            return "--flag-1";
        case BrowserRow_Color.FLAG_ORANGE:
            return "--flag-2";
        case BrowserRow_Color.FLAG_GREEN:
            return "--flag-3";
        case BrowserRow_Color.FLAG_BLUE:
            return "--flag-4";
        case BrowserRow_Color.FLAG_PINK:
            return "--flag-5";
        case BrowserRow_Color.FLAG_TURQUOISE:
            return "--flag-6";
        case BrowserRow_Color.FLAG_PURPLE:
            return "--flag-7";
        default:
            return null;
    }
}

/** A stable name for the colour, used as a data attribute for styling and tests. */
export function rowColorName(color: BrowserRow_Color): string {
    return BrowserRow_Color[color]?.toLowerCase().replace(/_/g, "-") ?? "default";
}

/** CSS `text-overflow`/`direction` for a cell's elide mode. */
export function elideClass(mode: BrowserRow_Cell_TextElideMode): string {
    switch (mode) {
        case BrowserRow_Cell_TextElideMode.ElideLeft:
            return "elide-left";
        case BrowserRow_Cell_TextElideMode.ElideNone:
            return "elide-none";
        default:
            return "elide-right";
    }
}

/** Starting widths in pixels; the sort field gets the most room. */
export function defaultColumnWidth(key: string): number {
    switch (key) {
        case "noteFld":
        case "question":
        case "answer":
            return 320;
        case "noteTags":
        case "deck":
            return 160;
        case "template":
        case "note":
            return 140;
        default:
            return 110;
    }
}
