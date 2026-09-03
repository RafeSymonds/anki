// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import {
    Deck_Filtered,
    Deck_Filtered_SearchTerm,
    Deck_Filtered_SearchTerm_Order,
    FilteredDeckForUpdate,
} from "@generated/anki/decks_pb";
import { describe, expect, it } from "vitest";

import { availableOrders, deckFromForm, DEFAULT_ORDER, formFromDeck, orderOrDefault } from "./filtered-deck";

const labels = [
    "Oldest seen first",
    "Random",
    "Increasing intervals",
    "Decreasing intervals",
    "Most lapses",
    "Order added",
    "Order due",
    "Latest added first",
    "Ascending retrievability",
    "Descending retrievability",
    "Relative overdueness",
];

function newDeck(): FilteredDeckForUpdate {
    return new FilteredDeckForUpdate({
        id: 0n,
        name: "Filtered Deck 1",
        allowEmpty: false,
        config: new Deck_Filtered({
            reschedule: true,
            searchTerms: [{ search: "deck:Default", limit: 100, order: Deck_Filtered_SearchTerm_Order.RANDOM }],
            previewAgainSecs: 60,
            previewHardSecs: 600,
            previewGoodSecs: 0,
        }),
    });
}

describe("availableOrders", () => {
    it("hides the retrievability orders unless FSRS is on (_available_order_values)", () => {
        const without = availableOrders(labels, false);
        expect(without.map((o) => o.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 10]);
        expect(without[1]).toEqual({ value: 1, label: "Random" });
        expect(availableOrders(labels, true)).toHaveLength(labels.length);
    });
});

describe("orderOrDefault", () => {
    it("falls back to random for an order that is not offered (_combo_row)", () => {
        const orders = availableOrders(labels, false);
        expect(orderOrDefault(Deck_Filtered_SearchTerm_Order.RETRIEVABILITY_ASCENDING, orders)).toBe(DEFAULT_ORDER);
        expect(orderOrDefault(Deck_Filtered_SearchTerm_Order.LAPSES, orders)).toBe(
            Deck_Filtered_SearchTerm_Order.LAPSES,
        );
    });
});

describe("formFromDeck", () => {
    it("fills the form from a new deck with the second filter hidden (_load_deck)", () => {
        const form = formFromDeck(newDeck(), availableOrders(labels, false));
        expect(form).toMatchObject({
            name: "Filtered Deck 1",
            search: "deck:Default",
            limit: 100,
            order: Deck_Filtered_SearchTerm_Order.RANDOM,
            secondFilter: false,
            limit2: 20,
            order2: DEFAULT_ORDER,
            reschedule: true,
            previewAgain: 60,
            previewHard: 600,
            previewGood: 0,
            allowEmpty: false,
        });
    });

    it("shows the second filter for an existing deck that has one", () => {
        const deck = newDeck();
        deck.id = 9n;
        deck.config!.searchTerms.push(
            new Deck_Filtered_SearchTerm({ search: "is:due", limit: 5, order: Deck_Filtered_SearchTerm_Order.DUE }),
        );
        const form = formFromDeck(deck, availableOrders(labels, false));
        expect(form.secondFilter).toBe(true);
        expect(form.search2).toBe("is:due");
        expect(form.limit2).toBe(5);
        expect(form.order2).toBe(Deck_Filtered_SearchTerm_Order.DUE);
    });
});

describe("deckFromForm", () => {
    it("writes the form back into a copy of the deck (_update_deck)", () => {
        const deck = newDeck();
        const orders = availableOrders(labels, false);
        const form = formFromDeck(deck, orders);
        form.name = "Cram";
        form.search = "tag:hard";
        form.limit = 30;
        form.order = Deck_Filtered_SearchTerm_Order.LAPSES;
        form.secondFilter = true;
        form.search2 = "is:new";
        form.limit2 = 10;
        form.order2 = Deck_Filtered_SearchTerm_Order.ADDED;
        form.reschedule = false;
        form.previewGood = 30;
        form.allowEmpty = true;

        const updated = deckFromForm(deck, form);
        expect(updated.name).toBe("Cram");
        expect(updated.allowEmpty).toBe(true);
        expect(updated.config!.reschedule).toBe(false);
        expect(updated.config!.searchTerms.map((t) => [t.search, t.limit, t.order])).toEqual([
            ["tag:hard", 30, Deck_Filtered_SearchTerm_Order.LAPSES],
            ["is:new", 10, Deck_Filtered_SearchTerm_Order.ADDED],
        ]);
        expect(updated.config!.previewGoodSecs).toBe(30);
        // The original is untouched.
        expect(deck.name).toBe("Filtered Deck 1");
        expect(deck.config!.searchTerms).toHaveLength(1);

        form.secondFilter = false;
        expect(deckFromForm(deck, form).config!.searchTerms).toHaveLength(1);
    });
});
