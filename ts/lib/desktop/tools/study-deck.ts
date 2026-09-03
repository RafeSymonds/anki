// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The Study Deck quick switcher's matching and selection, ported from
 * qt/aqt/studydeck.py (_matches, redraw, eventFilter).
 */

/** Every space-separated word of the filter must appear in the name. */
export function matchesFilter(name: string, filter: string): boolean {
    const lowerName = name.toLowerCase();
    const words = filter.toLowerCase().split(" ").filter((w) => w !== "");
    return words.every((word) => lowerName.includes(word));
}

export function filterNames(names: string[], filter: string): string[] {
    return names.filter((name) => matchesFilter(name, filter));
}

/** redraw: keep the current deck selected when it is still listed, else the first. */
export function initialSelection(names: string[], current: string | null): number {
    const idx = current === null ? -1 : names.indexOf(current);
    return idx === -1 ? 0 : idx;
}

/** Up/Down wrap around the list (eventFilter). */
export function moveSelection(current: number, count: number, delta: number): number {
    if (count === 0) {
        return 0;
    }
    return (((current + delta) % count) + count) % count;
}
