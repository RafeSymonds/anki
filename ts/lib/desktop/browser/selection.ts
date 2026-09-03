// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Row selection for the browser table, modelled on QItemSelectionModel as
 * qt/aqt/browser/table/table.py uses it: a set of selected rows, a current
 * row (the one with keyboard focus) and an anchor for shift-extends.
 * Everything here is pure; the table applies the returned selection.
 */

export interface Selection {
    /** Row indices. */
    readonly selected: ReadonlySet<number>;
    /** The row with keyboard focus; Qt's "current index". */
    readonly current: number | null;
    /** The row a shift-click or shift-arrow extends from. */
    readonly anchor: number | null;
}

export const EMPTY_SELECTION: Selection = { selected: new Set(), current: null, anchor: null };

export interface ClickModifiers {
    shift?: boolean;
    ctrl?: boolean;
}

function range(a: number, b: number): Set<number> {
    const out = new Set<number>();
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    for (let i = lo; i <= hi; i++) {
        out.add(i);
    }
    return out;
}

export function selectSingle(index: number): Selection {
    return { selected: new Set([index]), current: index, anchor: index };
}

/** A mouse click on a row. Ctrl toggles, shift extends from the anchor. */
export function clickRow(sel: Selection, index: number, mods: ClickModifiers = {}): Selection {
    if (mods.ctrl) {
        const selected = new Set(sel.selected);
        if (selected.has(index)) {
            selected.delete(index);
        } else {
            selected.add(index);
        }
        return { selected, current: index, anchor: index };
    }
    if (mods.shift && sel.anchor !== null) {
        return { selected: range(sel.anchor, index), current: index, anchor: sel.anchor };
    }
    return selectSingle(index);
}

/** Arrow/Home/End keys: move the current row, extending the selection with shift. */
export function moveCurrent(sel: Selection, target: number, extend: boolean): Selection {
    if (extend && sel.anchor !== null) {
        return { selected: range(sel.anchor, target), current: target, anchor: sel.anchor };
    }
    return selectSingle(target);
}

export function selectAll(sel: Selection, count: number): Selection {
    return { selected: range(0, count - 1), current: sel.current, anchor: sel.anchor };
}

export function invertSelection(sel: Selection, count: number): Selection {
    const selected = new Set<number>();
    for (let i = 0; i < count; i++) {
        if (!sel.selected.has(i)) {
            selected.add(i);
        }
    }
    return { selected, current: sel.current, anchor: sel.anchor };
}

export function selectedIndices(sel: Selection): number[] {
    return [...sel.selected].sort((a, b) => a - b);
}

/**
 * The selection to use after the rows changed (a new search, a mode toggle,
 * a reversal): the rows whose items were selected before, else the row of
 * the old current item, else the first row (`Table._restore_selection`).
 */
export function selectionForItems(
    newItems: readonly bigint[],
    selectedItems: Iterable<bigint>,
    currentItem: bigint | null,
): Selection {
    if (newItems.length === 0) {
        return EMPTY_SELECTION;
    }
    const indexOf = new Map<bigint, number>();
    newItems.forEach((item, index) => indexOf.set(item, index));
    const selected = new Set<number>();
    for (const item of selectedItems) {
        const index = indexOf.get(item);
        if (index !== undefined) {
            selected.add(index);
        }
    }
    const currentIndex = currentItem === null ? undefined : indexOf.get(currentItem);
    if (selected.size === 0) {
        const index = currentIndex ?? 0;
        return selectSingle(index);
    }
    const current = currentIndex !== undefined && selected.has(currentIndex) ? currentIndex : selectedIndices({
        selected,
        current: null,
        anchor: null,
    })[0];
    return { selected, current, anchor: current };
}

/** Same as selectionForItems, taking the previous item list and selection. */
export function restoreSelection(oldItems: readonly bigint[], sel: Selection, newItems: readonly bigint[]): Selection {
    const selectedItems = selectedIndices(sel).map((i) => oldItems[i]).filter((item) => item !== undefined);
    const currentItem = sel.current !== null ? oldItems[sel.current] ?? null : null;
    return selectionForItems(newItems, selectedItems, currentItem);
}

/**
 * Rows to try, in order, when moving off a selection that is about to be
 * deleted: the rows below the bottom-most selected row top-down, then the
 * rows above the top-most bottom-up (`Table.to_row_of_unselected_note`).
 */
export function removalCandidates(sel: Selection, count: number): number[] {
    const indices = selectedIndices(sel);
    if (indices.length === 0) {
        return [];
    }
    const out: number[] = [];
    for (let row = indices[indices.length - 1] + 1; row < count; row++) {
        out.push(row);
    }
    for (let row = indices[0] - 1; row >= 0; row--) {
        out.push(row);
    }
    return out;
}

/** The first removal candidate `skip` does not reject, or null. */
export function rowAfterRemoval(sel: Selection, count: number, skip: (index: number) => boolean): number | null {
    return removalCandidates(sel, count).find((row) => !skip(row)) ?? null;
}

/** Clamp a keyboard move to the table. */
export function clampRow(index: number, count: number): number {
    return Math.max(0, Math.min(count - 1, index));
}
