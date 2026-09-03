// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import {
    clampRow,
    clickRow,
    EMPTY_SELECTION,
    invertSelection,
    moveCurrent,
    removalCandidates,
    restoreSelection,
    rowAfterRemoval,
    selectAll,
    selectedIndices,
    selectionForItems,
    selectSingle,
} from "./selection";

describe("clickRow", () => {
    it("selects one row and sets the anchor", () => {
        const sel = clickRow(EMPTY_SELECTION, 3);
        expect(selectedIndices(sel)).toEqual([3]);
        expect(sel.current).toBe(3);
        expect(sel.anchor).toBe(3);
    });

    it("ctrl toggles rows and moves the anchor", () => {
        let sel = clickRow(EMPTY_SELECTION, 1);
        sel = clickRow(sel, 4, { ctrl: true });
        expect(selectedIndices(sel)).toEqual([1, 4]);
        sel = clickRow(sel, 1, { ctrl: true });
        expect(selectedIndices(sel)).toEqual([4]);
        expect(sel.current).toBe(1);
    });

    it("shift selects the range from the anchor in either direction", () => {
        let sel = clickRow(EMPTY_SELECTION, 5);
        sel = clickRow(sel, 2, { shift: true });
        expect(selectedIndices(sel)).toEqual([2, 3, 4, 5]);
        expect(sel.anchor).toBe(5);
        sel = clickRow(sel, 7, { shift: true });
        expect(selectedIndices(sel)).toEqual([5, 6, 7]);
    });

    it("shift without an anchor selects a single row", () => {
        expect(selectedIndices(clickRow(EMPTY_SELECTION, 2, { shift: true }))).toEqual([2]);
    });
});

describe("moveCurrent", () => {
    it("moves to a single row or extends with shift", () => {
        let sel = selectSingle(2);
        sel = moveCurrent(sel, 3, false);
        expect(selectedIndices(sel)).toEqual([3]);
        sel = moveCurrent(sel, 5, true);
        expect(selectedIndices(sel)).toEqual([3, 4, 5]);
        expect(sel.current).toBe(5);
        expect(sel.anchor).toBe(3);
    });

    it("clamps keyboard targets", () => {
        expect(clampRow(-3, 10)).toBe(0);
        expect(clampRow(12, 10)).toBe(9);
        expect(clampRow(4, 10)).toBe(4);
    });
});

describe("select all and invert", () => {
    it("covers every row and keeps the current row", () => {
        const sel = selectAll(selectSingle(2), 4);
        expect(selectedIndices(sel)).toEqual([0, 1, 2, 3]);
        expect(sel.current).toBe(2);
    });

    it("inverts against the row count", () => {
        const sel = invertSelection(clickRow(selectSingle(1), 3, { ctrl: true }), 5);
        expect(selectedIndices(sel)).toEqual([0, 2, 4]);
    });
});

describe("selectionForItems", () => {
    const items = [10n, 20n, 30n, 40n];

    it("keeps rows whose items survived, with the current row if selected", () => {
        const sel = selectionForItems([40n, 20n, 99n], [20n, 40n, 55n], 40n);
        expect(selectedIndices(sel)).toEqual([0, 1]);
        expect(sel.current).toBe(0);
    });

    it("uses the first surviving row as current when the old current is gone", () => {
        const sel = selectionForItems(items, [30n, 40n], 10n);
        expect(selectedIndices(sel)).toEqual([2, 3]);
        expect(sel.current).toBe(2);
    });

    it("falls back to the old current row, then the first row", () => {
        expect(selectionForItems(items, [], 30n)).toEqual(selectSingle(2));
        expect(selectionForItems(items, [99n], null)).toEqual(selectSingle(0));
    });

    it("is empty for no rows", () => {
        expect(selectionForItems([], [10n], 10n)).toEqual(EMPTY_SELECTION);
    });

    it("restoreSelection maps the old selection through the old items", () => {
        const sel = clickRow(selectSingle(1), 3, { ctrl: true });
        const restored = restoreSelection(items, sel, [40n, 10n, 20n]);
        expect(selectedIndices(restored)).toEqual([0, 2]);
        expect(restored.current).toBe(0);
    });
});

describe("rowAfterRemoval", () => {
    it("tries the rows below top-down, then the rows above bottom-up", () => {
        const sel = clickRow(selectSingle(2), 3, { ctrl: true });
        expect(removalCandidates(sel, 6)).toEqual([4, 5, 1, 0]);
        expect(removalCandidates(EMPTY_SELECTION, 6)).toEqual([]);
    });

    it("prefers the row below the selection that is not skipped", () => {
        const sel = clickRow(selectSingle(1), 2, { ctrl: true });
        expect(rowAfterRemoval(sel, 6, (i) => i === 3)).toBe(4);
    });

    it("falls back to the row above, then null", () => {
        const sel = clickRow(selectSingle(4), 5, { ctrl: true });
        expect(rowAfterRemoval(sel, 6, () => false)).toBe(3);
        expect(rowAfterRemoval(sel, 6, (i) => i !== 1)).toBe(1);
        expect(rowAfterRemoval(sel, 6, () => true)).toBeNull();
        expect(rowAfterRemoval(EMPTY_SELECTION, 6, () => false)).toBeNull();
    });
});
