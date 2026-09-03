// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The filtered deck dialog's logic, ported from qt/aqt/filtered_deck.py:
 * which sort orders are offered (_available_order_values), how a deck fills
 * the form (_load_deck) and how the form goes back into the deck
 * (_update_deck).
 */

import type { FilteredDeckForUpdate } from "@generated/anki/decks_pb";
import { Deck_Filtered_SearchTerm, Deck_Filtered_SearchTerm_Order } from "@generated/anki/decks_pb";
import {
    addOrUpdateFilteredDeck,
    filteredDeckOrderLabels,
    getDeckConfigsForUpdate,
    getOrCreateFilteredDeck,
} from "@generated/backend";

/** Retrievability orders need FSRS memory states. */
export const FSRS_ONLY_ORDERS: number[] = [
    Deck_Filtered_SearchTerm_Order.RETRIEVABILITY_ASCENDING,
    Deck_Filtered_SearchTerm_Order.RETRIEVABILITY_DESCENDING,
];
export const DEFAULT_ORDER: number = Deck_Filtered_SearchTerm_Order.RANDOM;

export interface OrderOption {
    value: number;
    label: string;
}

/** The order combo's rows: every label from the backend, minus FSRS-only ones. */
export function availableOrders(labels: string[], fsrsEnabled: boolean): OrderOption[] {
    return labels
        .map((label, value) => ({ value, label }))
        .filter((o) => fsrsEnabled || !FSRS_ONLY_ORDERS.includes(o.value));
}

/** _combo_row: a saved order that is not offered falls back to random. */
export function orderOrDefault(order: number, orders: OrderOption[]): number {
    return orders.some((o) => o.value === order) ? order : DEFAULT_ORDER;
}

export interface FilteredDeckForm {
    name: string;
    search: string;
    limit: number;
    order: number;
    secondFilter: boolean;
    search2: string;
    limit2: number;
    order2: number;
    reschedule: boolean;
    previewAgain: number;
    previewHard: number;
    previewGood: number;
    allowEmpty: boolean;
}

/** _load_deck in filtered_deck.py. */
export function formFromDeck(deck: FilteredDeckForUpdate, orders: OrderOption[]): FilteredDeckForm {
    const config = deck.config;
    const terms = config?.searchTerms ?? [];
    const term1 = terms[0];
    const term2 = terms[1];
    const existing = deck.id !== 0n;
    return {
        name: deck.name,
        search: term1?.search ?? "",
        limit: term1?.limit ?? 100,
        order: orderOrDefault(term1?.order ?? DEFAULT_ORDER, orders),
        // A second filter is only shown when an existing deck already has one.
        secondFilter: existing && term2 !== undefined,
        search2: term2?.search ?? "",
        limit2: term2?.limit ?? 20,
        order2: orderOrDefault(term2?.order ?? DEFAULT_ORDER, orders),
        reschedule: config?.reschedule ?? true,
        previewAgain: config?.previewAgainSecs ?? 0,
        previewHard: config?.previewHardSecs ?? 0,
        previewGood: config?.previewGoodSecs ?? 0,
        allowEmpty: deck.allowEmpty,
    };
}

/** _update_deck in filtered_deck.py: returns a copy with the form applied. */
export function deckFromForm(deck: FilteredDeckForUpdate, form: FilteredDeckForm): FilteredDeckForUpdate {
    const updated = deck.clone();
    updated.name = form.name;
    updated.allowEmpty = form.allowEmpty;
    const config = updated.config;
    if (!config) {
        throw new Error("filtered deck has no config");
    }
    config.reschedule = form.reschedule;
    config.delays = [];
    const terms = [
        new Deck_Filtered_SearchTerm({ search: form.search, limit: form.limit, order: form.order }),
    ];
    if (form.secondFilter) {
        terms.push(
            new Deck_Filtered_SearchTerm({ search: form.search2, limit: form.limit2, order: form.order2 }),
        );
    }
    config.searchTerms = terms;
    config.previewAgainSecs = form.previewAgain;
    config.previewHardSecs = form.previewHard;
    config.previewGoodSecs = form.previewGood;
    return updated;
}

export interface FilteredDeckDialogData {
    deck: FilteredDeckForUpdate;
    orders: OrderOption[];
    form: FilteredDeckForm;
}

/** Fetch what the dialog needs; deckId 0 starts a new deck from the current one. */
export async function loadFilteredDeck(deckId: bigint): Promise<FilteredDeckDialogData> {
    const [deck, labels, fsrs] = await Promise.all([
        getOrCreateFilteredDeck({ did: deckId }),
        filteredDeckOrderLabels({}),
        // `col.get_config("fsrs")` in Python; the deck options payload carries the flag.
        getDeckConfigsForUpdate({ did: 1n }, { alertOnError: false }).then(
            (configs) => configs.fsrs,
            () => false,
        ),
    ]);
    const orders = availableOrders(labels.vals, fsrs);
    return { deck, orders, form: formFromDeck(deck, orders) };
}

/** Save the form; the backend builds the deck and makes it current. Returns its id. */
export async function saveFilteredDeck(deck: FilteredDeckForUpdate, form: FilteredDeckForm): Promise<bigint> {
    const changes = await addOrUpdateFilteredDeck(deckFromForm(deck, form));
    return changes.id;
}
