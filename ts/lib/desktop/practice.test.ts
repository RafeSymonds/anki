// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { AGAIN_GAP, PracticeLoop, shuffled } from "./practice";

const inOrder = (cardIds: bigint[]) => [...cardIds];
const reversed = (cardIds: bigint[]) => [...cardIds].reverse();

describe("PracticeLoop", () => {
    it("shows every card once a round and starts over, without end", () => {
        const loop = new PracticeLoop([1n, 2n, 3n], inOrder);
        for (let round = 1; round <= 5; round++) {
            expect(loop.round).toBe(round);
            const seen: (bigint | null)[] = [];
            for (let i = 0; i < 3; i++) {
                seen.push(loop.current);
                loop.good();
            }
            expect([...seen].sort()).toEqual([1n, 2n, 3n]);
        }
    });

    it("counts down what is left in the round and refills it", () => {
        const loop = new PracticeLoop([1n, 2n], inOrder);
        expect(loop.remaining).toBe(2);
        loop.good();
        expect(loop.remaining).toBe(1);
        loop.good();
        expect(loop.remaining).toBe(2);
    });

    it("brings a card rated Again back after a few others, in the same round", () => {
        const loop = new PracticeLoop([1n, 2n, 3n, 4n, 5n], inOrder);
        loop.again();
        for (let i = 0; i < AGAIN_GAP; i++) {
            expect(loop.current).not.toBe(1n);
            loop.good();
        }
        expect(loop.current).toBe(1n);
        expect(loop.round).toBe(1);
    });

    it("does not finish a round while a card rated Again is outstanding", () => {
        const loop = new PracticeLoop([1n], inOrder);
        loop.again();
        expect(loop.current).toBe(1n);
        expect(loop.round).toBe(1);
        loop.good();
        expect(loop.current).toBe(1n);
        expect(loop.round).toBe(2);
    });

    it("does not show the card just answered first in the next round", () => {
        // Answered 1 then 2; a reversing shuffle would put 2 first again.
        const loop = new PracticeLoop([2n, 1n], reversed);
        loop.good();
        loop.good();
        expect(loop.round).toBe(2);
        expect(loop.current).toBe(1n);
    });

    it("drops removed cards from this round and later ones", () => {
        const loop = new PracticeLoop([1n, 2n, 3n], inOrder);
        loop.good();
        loop.remove([1n, 3n]);
        expect(loop.current).toBe(2n);
        loop.good();
        expect(loop.round).toBe(2);
        expect(loop.current).toBe(2n);
        expect(loop.remaining).toBe(1);
    });

    it("starts the next round when the rest of this one is removed", () => {
        const loop = new PracticeLoop([1n, 2n], inOrder);
        loop.good();
        loop.remove([2n]);
        expect(loop.round).toBe(2);
        expect(loop.current).toBe(1n);
    });

    it("has nothing to show once every card is removed", () => {
        const loop = new PracticeLoop([1n, 2n], inOrder);
        loop.remove([1n, 2n]);
        expect(loop.current).toBeNull();
        expect(loop.remaining).toBe(0);
        loop.good();
        loop.again();
        expect(loop.current).toBeNull();
    });
});

describe("shuffled", () => {
    it("keeps every card and leaves the input alone", () => {
        const input = [1n, 2n, 3n, 4n, 5n, 6n];
        const output = shuffled(input);
        expect([...output].sort()).toEqual(input);
        expect(input).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    });
});
