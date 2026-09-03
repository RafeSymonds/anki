// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Deck list data for the sidebar, and the deck operations it offers. */

import type { DeckTreeNode } from "@generated/anki/decks_pb";
import { SetDeckCollapsedRequest_Scope } from "@generated/anki/decks_pb";
import {
    addDeck,
    deckTree,
    getCurrentDeck,
    newDeck,
    removeDecks,
    renameDeck,
    setCurrentDeck,
    setDeckCollapsed,
} from "@generated/backend";

export interface DeckRow {
    id: bigint;
    /** Full name, e.g. "Japanese::Vocab". */
    name: string;
    /** Last component of the name. */
    shortName: string;
    level: number;
    collapsed: boolean;
    hasChildren: boolean;
    filtered: boolean;
    newCount: number;
    learnCount: number;
    reviewCount: number;
}

export function shortName(name: string): string {
    const parts = name.split("::");
    return parts[parts.length - 1];
}

/** Rows in display order, omitting the children of collapsed decks. */
export function flattenTree(root: DeckTreeNode): DeckRow[] {
    const rows: DeckRow[] = [];
    const visit = (node: DeckTreeNode): void => {
        rows.push({
            id: node.deckId,
            name: node.name,
            shortName: shortName(node.name),
            level: node.level,
            collapsed: node.collapsed,
            hasChildren: node.children.length > 0,
            filtered: node.filtered,
            newCount: node.newCount,
            learnCount: node.learnCount,
            reviewCount: node.reviewCount,
        });
        if (!node.collapsed) {
            for (const child of node.children) {
                visit(child);
            }
        }
    };
    for (const child of root.children) {
        visit(child);
    }
    return rows;
}

export function findNode(root: DeckTreeNode, deckId: bigint): DeckTreeNode | undefined {
    if (root.deckId === deckId) {
        return root;
    }
    for (const child of root.children) {
        const found = findNode(child, deckId);
        if (found) {
            return found;
        }
    }
    return undefined;
}

/** True when the collection holds nothing but an empty Default deck. */
export function isFreshCollection(root: DeckTreeNode): boolean {
    if (root.children.length !== 1) {
        return false;
    }
    const only = root.children[0];
    return only.deckId === 1n && only.children.length === 0 && only.totalIncludingChildren === 0;
}

export async function fetchDeckTree(): Promise<DeckTreeNode> {
    return await deckTree({ now: BigInt(Math.floor(Date.now() / 1000)) });
}

export async function fetchCurrentDeckId(): Promise<bigint> {
    const deck = await getCurrentDeck({});
    return deck.id;
}

export async function selectDeck(deckId: bigint): Promise<void> {
    await setCurrentDeck({ did: deckId });
}

export async function setCollapsed(deckId: bigint, collapsed: boolean): Promise<void> {
    await setDeckCollapsed({ deckId, collapsed, scope: SetDeckCollapsedRequest_Scope.REVIEWER });
}

export async function createDeck(name: string): Promise<bigint> {
    const deck = await newDeck({});
    deck.name = name;
    const changes = await addDeck(deck);
    return changes.id;
}

export async function renameDeckTo(deckId: bigint, newName: string): Promise<void> {
    await renameDeck({ deckId, newName });
}

export async function deleteDeck(deckId: bigint): Promise<number> {
    const changes = await removeDecks({ dids: [deckId] });
    return changes.count;
}
