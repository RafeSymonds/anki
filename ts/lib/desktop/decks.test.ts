// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { DeckTreeNode } from "@generated/anki/decks_pb";
import { describe, expect, it } from "vitest";

import { findNode, flattenTree, isFreshCollection, shortName } from "./decks";

function node(id: number, name: string, extra: Partial<DeckTreeNode> = {}): DeckTreeNode {
    return new DeckTreeNode({ deckId: BigInt(id), name, level: name.split("::").length, ...extra });
}

function tree(): DeckTreeNode {
    return new DeckTreeNode({
        deckId: 0n,
        name: "",
        level: 0,
        children: [
            node(1, "Default", { newCount: 2 }),
            node(10, "Japanese", {
                collapsed: true,
                reviewCount: 5,
                children: [node(11, "Japanese::Vocab"), node(12, "Japanese::Kanji")],
            }),
            node(20, "Music", { children: [node(21, "Music::Theory")] }),
        ],
    });
}

describe("flattenTree", () => {
    it("lists visible rows in order and hides collapsed children", () => {
        const rows = flattenTree(tree());
        expect(rows.map((r) => r.shortName)).toEqual(["Default", "Japanese", "Music", "Theory"]);
        expect(rows[1]).toMatchObject({ collapsed: true, hasChildren: true, reviewCount: 5, level: 1 });
        expect(rows[3]).toMatchObject({ name: "Music::Theory", level: 2, hasChildren: false });
    });
});

describe("findNode", () => {
    it("finds nested decks", () => {
        expect(findNode(tree(), 12n)?.name).toBe("Japanese::Kanji");
        expect(findNode(tree(), 99n)).toBeUndefined();
    });
});

describe("shortName", () => {
    it("takes the last component", () => {
        expect(shortName("A::B::C")).toBe("C");
        expect(shortName("Solo")).toBe("Solo");
    });
});

describe("isFreshCollection", () => {
    it("is true only while no deck holds any card", () => {
        const fresh = new DeckTreeNode({ children: [node(1, "Default")] });
        expect(isFreshCollection(fresh)).toBe(true);
        const emptyDecks = new DeckTreeNode({ children: [node(1, "Default"), node(2, "Demo")] });
        expect(isFreshCollection(emptyDecks)).toBe(true);
        const used = new DeckTreeNode({ children: [node(1, "Default", { totalIncludingChildren: 3 })] });
        expect(isFreshCollection(used)).toBe(false);
        expect(isFreshCollection(new DeckTreeNode({ children: [] }))).toBe(true);
    });
});
