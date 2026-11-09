// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * One sentence of consequence under each essential setting (plan item
 * A31), and the first sentence of a setting's help shown inline (A32).
 */

export function retentionConsequence(retention: number): string {
    const forgotten = Math.max(1, Math.round((1 - retention) * 100));
    const percent = Math.round(retention * 100);
    return `At ${percent}%, about ${forgotten} in 100 due cards will be forgotten; higher means more reviews per day.`;
}

/** The first sentence of a help text, without markdown emphasis or links. */
export function firstSentence(markdown: string): string {
    const plain = markdown
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const match = /^(.+?[.!?])(\s|$)/.exec(plain);
    return match ? match[1] : plain;
}
