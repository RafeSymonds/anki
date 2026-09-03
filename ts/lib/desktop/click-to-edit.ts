// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Click-to-edit on the card (plan item A7): clicking a piece of text on the
 * card opens the edit panel on the field that text came from. Cards do not
 * say which field rendered what, so the clicked element's text is matched
 * against the note's fields.
 */

/** Field HTML to comparable plain text. */
export function fieldText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * The field the clicked text belongs to: the shortest field containing the
 * whole clicked text, else the field the clicked text contains (a click on a
 * wrapper element holding a field and more). Null when nothing fits.
 */
export function fieldIndexForText(fields: readonly string[], clicked: string): number | null {
    const text = clicked.replace(/\s+/g, " ").trim();
    if (!text) {
        return null;
    }
    const texts = fields.map(fieldText);
    let best: number | null = null;
    for (const [i, field] of texts.entries()) {
        if (field && field.includes(text) && (best === null || field.length < texts[best].length)) {
            best = i;
        }
    }
    if (best !== null) {
        return best;
    }
    for (const [i, field] of texts.entries()) {
        if (field && text.includes(field) && (best === null || field.length > texts[best].length)) {
            best = i;
        }
    }
    return best;
}

const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "AUDIO", "VIDEO"]);

/** Clicks on controls inside the card are theirs, not an edit request. */
export function isInteractiveTarget(tagName: string, ancestors: readonly string[] = []): boolean {
    return [tagName, ...ancestors].some((tag) => INTERACTIVE.has(tag.toUpperCase()));
}
