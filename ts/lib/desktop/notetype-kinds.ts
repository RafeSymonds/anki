// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The three kinds of card most people make, offered as a segmented picker
 * above the Add editor (plan item A9). They map onto the stock note types by
 * their (localised) names; a renamed or deleted stock type drops out.
 */

export type NotetypeKind = "basic" | "reversed" | "cloze";

export interface NotetypeKindOption {
    kind: NotetypeKind;
    /** What the picker shows. */
    label: string;
    /** One line for the tooltip. */
    hint: string;
    id: bigint;
}

export interface StockNames {
    basic: string;
    reversed: string;
    cloze: string;
}

const LABELS: Record<NotetypeKind, { label: string; hint: string }> = {
    basic: { label: "Basic", hint: "A question on the front, the answer on the back." },
    reversed: { label: "Both directions", hint: "Two cards: front to back, and back to front." },
    cloze: { label: "Fill in the blank", hint: "Hide words in a sentence; each blank is a card." },
};

/** The picker's options, in order, for the note types that exist. */
export function notetypeKindOptions(
    entries: readonly { id: bigint; name: string }[],
    names: StockNames,
): NotetypeKindOption[] {
    const byName = new Map(entries.map((e) => [e.name, e.id]));
    const options: NotetypeKindOption[] = [];
    for (const kind of ["basic", "reversed", "cloze"] as const) {
        const id = byName.get(names[kind]);
        if (id !== undefined) {
            options.push({ kind, ...LABELS[kind], id });
        }
    }
    return options;
}

/** Which option the editor's current note type is, if any. */
export function kindOfNotetype(options: readonly NotetypeKindOption[], notetypeId: bigint | null): NotetypeKind | null {
    return options.find((o) => o.id === notetypeId)?.kind ?? null;
}
