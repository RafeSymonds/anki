// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Going over a deck's cards as often as you like. The loop lives only in the
 * reviewer and never answers through the scheduler, so due dates, the review
 * history and what syncs all stay as they were.
 */

import { SortOrder } from "@generated/anki/search_pb";
import { searchCards } from "@generated/backend";

/** How many other cards pass before one rated Again comes back. */
export const AGAIN_GAP = 3;

/** The selected deck and its subdecks, leaving out what the user suspended. */
const PRACTICE_SEARCH = "deck:current -is:suspended";

export async function practiceCardIds(): Promise<bigint[]> {
    const response = await searchCards({
        search: PRACTICE_SEARCH,
        order: new SortOrder({ value: { case: "none", value: {} } }),
    });
    return response.ids;
}

export type Shuffle = (cardIds: bigint[]) => bigint[];

export function shuffled(cardIds: bigint[]): bigint[] {
    const result = [...cardIds];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/** One pass over the cards after another, without end. */
export class PracticeLoop {
    round = 1;
    private upcoming: bigint[];
    private passed: bigint[] = [];
    private readonly shuffle: Shuffle;

    constructor(cardIds: bigint[], shuffle: Shuffle = shuffled) {
        this.shuffle = shuffle;
        this.upcoming = shuffle(cardIds);
    }

    /** The card to show, or null once no cards are left to practice. */
    get current(): bigint | null {
        return this.upcoming[0] ?? null;
    }

    /** Cards still to go in this round, the current one included. */
    get remaining(): number {
        return this.upcoming.length;
    }

    /** Show the current card again a few cards from now. */
    again(): void {
        const card = this.upcoming.shift();
        if (card !== undefined) {
            this.upcoming.splice(AGAIN_GAP, 0, card);
        }
    }

    /** Done with the current card until the next round. */
    good(): void {
        const card = this.upcoming.shift();
        if (card === undefined) {
            return;
        }
        this.passed.push(card);
        if (!this.upcoming.length) {
            this.startNextRound(card);
        }
    }

    /** Drop cards that were buried, suspended or deleted during practice. */
    remove(cardIds: bigint[]): void {
        const gone = new Set(cardIds);
        this.upcoming = this.upcoming.filter((card) => !gone.has(card));
        this.passed = this.passed.filter((card) => !gone.has(card));
        if (!this.upcoming.length && this.passed.length) {
            this.startNextRound(this.passed[this.passed.length - 1]);
        }
    }

    private startNextRound(lastShown: bigint): void {
        this.upcoming = this.shuffle(this.passed);
        this.passed = [];
        this.round += 1;
        // The shuffle must not show the card just answered straight away.
        if (this.upcoming.length > 1 && this.upcoming[0] === lastShown) {
            const [first, second] = this.upcoming;
            this.upcoming[0] = second;
            this.upcoming[1] = first;
        }
    }
}
