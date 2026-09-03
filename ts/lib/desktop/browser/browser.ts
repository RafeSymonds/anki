// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The browser's state and its calls into rslib: searching, the row cache,
 * columns and sorting, selection bookkeeping and the note/card actions of
 * the Browse window. A port of qt/aqt/browser/{browser,table/*}.py; the pure
 * pieces live in columns.ts, selection.ts and search.ts.
 */

import type { Card } from "@generated/anki/cards_pb";
import { ConfigKey_Bool, ConfigKey_String } from "@generated/anki/config_pb";
import type { DeckNameId } from "@generated/anki/decks_pb";
import type { Note } from "@generated/anki/notes_pb";
import { BuryOrSuspendCardsRequest_Mode, ScheduleCardsAsNewRequest_Context } from "@generated/anki/scheduler_pb";
import type { BrowserColumns_Column, BrowserRow_Cell } from "@generated/anki/search_pb";
import {
    BrowserRow_Cell_TextElideMode,
    BrowserRow_Color,
    SearchNode,
    SearchNode_Group_Joiner,
    SortOrder,
} from "@generated/anki/search_pb";
import {
    addNoteTags,
    allBrowserColumns,
    browserRowForId,
    buildSearchString,
    buryOrSuspendCards,
    cardsOfNote,
    deckTree,
    fieldNamesForNotes,
    findAndReplace,
    findAndReplaceTag,
    getCard,
    getConfigBool,
    getConfigJson,
    getConfigString,
    getDeckNames,
    getNote,
    getNotetypeNames,
    getSingleNotetypeOfNotes,
    joinSearchNodes,
    removeNotes,
    removeNoteTags,
    replaceSearchNode,
    repositionDefaults,
    restoreBuriedAndSuspendedCards,
    scheduleCardsAsNew,
    scheduleCardsAsNewDefaults,
    searchCards,
    searchNotes,
    setActiveBrowserColumns,
    setConfigBool,
    setConfigJsonNoUndo,
    setDeck,
    setDueDate,
    setFlag,
    sortCards,
    tagTree,
} from "@generated/backend";

import * as tr from "@generated/ftl";
import type { Writable } from "svelte/store";
import { get, writable } from "svelte/store";
import { undoLast } from "../undo";

import { settingsGet, settingsSet } from "../desktop-api";
import { MARKED_TAG, userFlag } from "../reviewer";
import type { SortState } from "./columns";
import {
    activeColumnsKey,
    COLUMN_WIDTHS_KEY,
    defaultColumns,
    effectiveSort,
    FALLBACK_SORT_COLUMN,
    sanitizeColumnWidths,
    sortAfterHeaderClick,
    sortBackwardsKey,
    sortColumnKey,
    toggleColumn,
} from "./columns";
import type { SidebarItem, SidebarModifiers } from "./search";
import {
    buildSidebar,
    deckNode,
    idSearch,
    negated,
    normaliseSearchText,
    pushSearchHistory,
    SAVED_SEARCHES_KEY,
    SEARCH_HISTORY_KEY,
    sidebarJoin,
    textNode,
} from "./search";
import type { Selection } from "./selection";
import {
    clampRow,
    EMPTY_SELECTION,
    invertSelection,
    moveCurrent,
    removalCandidates,
    restoreSelection,
    selectAll,
    selectedIndices,
    selectionForItems,
    selectSingle,
} from "./selection";

/** `QUEUE_TYPE_*` in anki/consts.py. */
const QUEUE_SUSPENDED = -1;
const QUEUE_SIBLING_BURIED = -2;
const QUEUE_MANUALLY_BURIED = -3;

/** A fetched row, or the error shown in its place (`CellRow.disabled`). */
export interface RowData {
    cells: BrowserRow_Cell[];
    color: BrowserRow_Color;
    fontName: string;
    fontSize: number;
    disabled: boolean;
}

export interface FindReplaceOptions {
    search: string;
    replacement: string;
    regex: boolean;
    matchCase: boolean;
    /** Empty for all fields; the tags marker for tags. */
    field: string;
    selectedOnly: boolean;
}

/** Sentinel for "Tags" in find and replace; a NUL cannot be a field name. */
export const FIND_REPLACE_TAGS = "\0tags";

export interface RepositionOptions {
    start: number;
    step: number;
    randomize: boolean;
    shift: boolean;
}

export interface ForgetOptions {
    restorePosition: boolean;
    resetCounts: boolean;
}

function isSuspended(card: Card): boolean {
    return card.queue === QUEUE_SUSPENDED;
}

function isBuried(card: Card): boolean {
    return card.queue === QUEUE_SIBLING_BURIED || card.queue === QUEUE_MANUALLY_BURIED;
}

function isMarked(note: Note): boolean {
    return note.tags.some((t) => t.toLowerCase() === MARKED_TAG);
}

export class BrowserController {
    readonly notesMode: Writable<boolean> = writable(false);
    /** Card ids in cards mode, note ids in notes mode; one per row. */
    readonly items: Writable<bigint[]> = writable([]);
    readonly selection: Writable<Selection> = writable(EMPTY_SELECTION);
    readonly columns: Writable<BrowserColumns_Column[]> = writable([]);
    readonly activeColumns: Writable<string[]> = writable([]);
    readonly sort: Writable<SortState> = writable({ column: FALLBACK_SORT_COLUMN, reverse: false });
    /** What the search box shows; may differ from the search that ran. */
    readonly searchText: Writable<string> = writable("");
    readonly history: Writable<string[]> = writable([]);
    /** Bumped whenever cached rows change, so the table redraws. */
    readonly rowsVersion: Writable<number> = writable(0);
    /** The card of the current (focused) row; drives the toggle states. */
    readonly currentCard: Writable<Card | null> = writable(null);
    readonly currentNote: Writable<Note | null> = writable(null);
    /** Set when exactly one row is selected; what the editor and preview show. */
    readonly singleCard: Writable<Card | null> = writable(null);
    readonly singleNote: Writable<Note | null> = writable(null);
    readonly sidebar: Writable<SidebarItem[]> = writable([]);
    readonly searching: Writable<boolean> = writable(false);

    /** Short notices, e.g. "3 notes updated"; the screen replaces this with a toast. */
    notify: (message: string) => void = (message) => console.info(message);

    /** Column widths the user dragged, by column key (profile setting). */
    readonly columnWidths: Writable<Record<string, number>> = writable({});
    private lastSearch = "";
    private rows = new Map<bigint, RowData>();
    private inflight = new Map<bigint, Promise<RowData>>();
    private redrawTimer: ReturnType<typeof setTimeout> | undefined;
    private selectionSequence = 0;
    /** Resolved once the columns and mode config are loaded; searches wait for it. */
    private resolveReady: () => void = () => undefined;
    private readonly ready = new Promise<void>((resolve) => {
        this.resolveReady = resolve;
    });
    private searched = false;

    // Setup
    // ---
    async start(initialSearch: string | null = null): Promise<void> {
        const [columns, notesMode, history, widths] = await Promise.all([
            allBrowserColumns({}),
            this.configBool(ConfigKey_Bool.BROWSER_TABLE_SHOW_NOTES_MODE),
            settingsGet("profile", SEARCH_HISTORY_KEY).catch(() => null),
            settingsGet("profile", COLUMN_WIDTHS_KEY).catch(() => null),
        ]);
        this.columns.set(columns.columns);
        this.columnWidths.set(sanitizeColumnWidths(widths));
        this.notesMode.set(notesMode);
        this.history.set(Array.isArray(history) ? history.filter((s) => typeof s === "string") : []);
        await this.loadModeConfig(notesMode);
        this.resolveReady();
        void this.refreshSidebar();
        if (initialSearch !== null) {
            await this.searchForTerms(initialSearch);
        } else if (!this.searched) {
            // Unless the user already typed a search while we were loading.
            await this.defaultSearch();
        }
    }

    /** `ItemState.__init__` plus `load_browser_*_columns`. */
    private async loadModeConfig(notesMode: boolean): Promise<void> {
        const config = await this.readModeConfig(notesMode);
        this.activeColumns.set(config.active);
        this.sort.set(config.sort);
    }

    /** The mode's columns and sort order; also makes the backend build rows for those columns. */
    private async readModeConfig(notesMode: boolean): Promise<{ active: string[]; sort: SortState }> {
        const active = await this.configJson<string[]>(activeColumnsKey(notesMode), defaultColumns(notesMode));
        const column = await this.configJson<string>(sortColumnKey(notesMode), FALLBACK_SORT_COLUMN);
        const reverse = await this.configJson<boolean>(sortBackwardsKey(notesMode), false);
        await setActiveBrowserColumns({ vals: active });
        return { active, sort: { column, reverse } };
    }

    private async configBool(key: ConfigKey_Bool): Promise<boolean> {
        try {
            return (await getConfigBool({ key }, { alertOnError: false })).val;
        } catch {
            return false;
        }
    }

    private async configJson<T>(key: string, fallback: T): Promise<T> {
        try {
            const response = await getConfigJson({ val: key }, { alertOnError: false });
            const parsed = JSON.parse(new TextDecoder().decode(response.json));
            return (parsed ?? fallback) as T;
        } catch {
            return fallback;
        }
    }

    private async setConfig(key: string, value: unknown): Promise<void> {
        await setConfigJsonNoUndo({ key, valueJson: new TextEncoder().encode(JSON.stringify(value)), undoable: false });
    }

    // Searching
    // ---
    /** Enter in the search box (`Browser.onSearchActivated`). */
    async searchFromInput(): Promise<void> {
        // Read the box now: a search typed while loading beats the default one.
        const text = normaliseSearchText(get(this.searchText));
        this.searched = true;
        await this.ready;
        let normed: string;
        try {
            normed = (await buildSearchString(textNode(text), { alertOnError: false })).val;
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
            return;
        }
        await this.searchFor(normed);
        await this.updateHistory(normed);
    }

    /** Search for terms built elsewhere, e.g. from the sidebar or another screen. */
    async searchForTerms(search: string): Promise<void> {
        this.searchText.set(search);
        await this.searchFromInput();
    }

    /** `Browser.search_for`: run `search`, showing `prompt` in the box if given. */
    async searchFor(search: string, prompt: string | null = null): Promise<void> {
        this.searched = true;
        this.lastSearch = search;
        this.searchText.set(prompt ?? search);
        await this.search();
    }

    /** `Browser._default_search` */
    private async defaultSearch(): Promise<void> {
        let text = "";
        try {
            text = (await getConfigString({ key: ConfigKey_String.DEFAULT_SEARCH_TEXT }, { alertOnError: false })).val;
        } catch {
            // No default configured.
        }
        let search = text;
        if (!text.trim()) {
            search = (await buildSearchString(deckNode("current"))).val;
            text = "";
        }
        // The user may have searched, or started typing, while the config
        // loaded: their search wins, and their text stays in the box.
        if (this.searched) {
            return;
        }
        const typed = get(this.searchText);
        await this.searchFor(search, typed || text);
    }

    /** Run the last search again, keeping the selection where possible (`Table.search`). */
    async search(): Promise<void> {
        this.searching.set(true);
        try {
            const oldItems = get(this.items);
            const oldSelection = get(this.selection);
            const items = await this.findItems(this.lastSearch);
            this.items.set(items);
            this.select(restoreSelection(oldItems, oldSelection, items));
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
        } finally {
            this.searching.set(false);
        }
    }

    private async findItems(
        search: string,
        notesMode = get(this.notesMode),
        sortState = get(this.sort),
    ): Promise<bigint[]> {
        const sort = effectiveSort(sortState, get(this.columns));
        const order = new SortOrder({
            value: { case: "builtin", value: { column: sort.column, reverse: sort.reverse } },
        });
        const request = { search, order };
        const response = notesMode
            ? await searchNotes(request, { alertOnError: false })
            : await searchCards(request, { alertOnError: false });
        this.rows.clear();
        return response.ids;
    }

    private async updateHistory(search: string): Promise<void> {
        const history = pushSearchHistory(get(this.history), search);
        this.history.set(history);
        try {
            await settingsSet("profile", SEARCH_HISTORY_KEY, history);
        } catch {
            // The settings store is optional in the browser-only harness.
        }
    }

    /** A sidebar click, combined with the current search by the modifiers. */
    async sidebarSearch(item: SidebarItem, mods: SidebarModifiers): Promise<void> {
        if (!item.node) {
            return;
        }
        await this.ready;
        const current = mods.alt ? negated(item.node) : item.node;
        const previous = textNode(normaliseSearchText(get(this.searchText)));
        try {
            let search: string;
            switch (sidebarJoin(mods)) {
                case "replaceNode":
                    search = (await replaceSearchNode({ existingNode: previous, replacementNode: current })).val;
                    break;
                case "and":
                    search = (await joinSearchNodes({
                        joiner: SearchNode_Group_Joiner.AND,
                        existingNode: previous,
                        additionalNode: current,
                    })).val;
                    break;
                case "or":
                    search = (await joinSearchNodes({
                        joiner: SearchNode_Group_Joiner.OR,
                        existingNode: previous,
                        additionalNode: current,
                    })).val;
                    break;
                default:
                    search = (await buildSearchString(current)).val;
            }
            await this.searchFor(search);
            await this.updateHistory(search);
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
        }
    }

    async refreshSidebar(): Promise<void> {
        try {
            const [decks, tags, notetypes, savedSearches] = await Promise.all([
                deckTree({ now: 0n }),
                tagTree({}),
                getNotetypeNames({}),
                this.savedSearches(),
            ]);
            this.sidebar.set(
                buildSidebar({ deckTree: decks, tagTree: tags, notetypes: notetypes.entries, savedSearches }),
            );
        } catch (err) {
            console.warn("sidebar refresh failed", err);
        }
    }

    // Cards/notes mode
    // ---
    /** `Table.toggle_state`: the selection carries over to the other mode. */
    async toggleMode(): Promise<void> {
        await this.ready;
        const notesMode = !get(this.notesMode);
        const selected = this.selectedItems();
        const currentItem = this.currentItem();
        const converted = notesMode
            ? await this.noteIdsOfCards(selected)
            : await this.cardIdsOfNotes(selected);
        let convertedCurrent: bigint | null = null;
        if (currentItem !== null) {
            const [first] = notesMode
                ? await this.noteIdsOfCards([currentItem])
                : await this.cardIdsOfNotes([currentItem]);
            convertedCurrent = first ?? null;
        }
        this.searching.set(true);
        try {
            await setConfigBool({
                key: ConfigKey_Bool.BROWSER_TABLE_SHOW_NOTES_MODE,
                value: notesMode,
                undoable: false,
            });
            const config = await this.readModeConfig(notesMode);
            const items = await this.findItems(this.lastSearch, notesMode, config.sort);
            // Switch the table over in one go, so rows, columns and mode agree.
            this.activeColumns.set(config.active);
            this.sort.set(config.sort);
            this.notesMode.set(notesMode);
            this.items.set(items);
            this.select(selectionForItems(items, converted, convertedCurrent));
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
        } finally {
            this.searching.set(false);
        }
    }

    // Columns and sorting
    // ---
    /** A click on a column header. */
    async sortBy(column: BrowserColumns_Column): Promise<void> {
        await this.ready;
        const notesMode = get(this.notesMode);
        const change = sortAfterHeaderClick(get(this.sort), column, notesMode);
        switch (change.kind) {
            case "unsupported":
                this.notify(tr.browsingSortingOnThisColumnIsNot());
                return;
            case "unchanged":
                return;
            case "search":
                this.sort.set(change.sort);
                await this.setConfig(sortColumnKey(notesMode), change.sort.column);
                await this.setConfig(sortBackwardsKey(notesMode), change.sort.reverse);
                await this.search();
                return;
            case "reverse": {
                this.sort.set(change.sort);
                await this.setConfig(sortBackwardsKey(notesMode), change.sort.reverse);
                const oldItems = get(this.items);
                const items = [...oldItems].reverse();
                this.items.set(items);
                this.select(restoreSelection(oldItems, get(this.selection), items));
            }
        }
    }

    /** Show or hide a column (`Table._on_column_toggled`). */
    async toggleColumn(key: string): Promise<void> {
        await this.ready;
        const active = toggleColumn(get(this.activeColumns), key);
        if (!active) {
            this.notify(tr.browsingYouMustHaveAtLeastOne());
            return;
        }
        this.activeColumns.set(active);
        await this.setConfig(activeColumnsKey(get(this.notesMode)), active);
        await setActiveBrowserColumns({ vals: active });
        this.invalidateRows();
    }

    // Rows
    // ---
    /** The cached row, fetching it in the background when missing. */
    row(id: bigint): RowData | undefined {
        const cached = this.rows.get(id);
        if (!cached && !this.inflight.has(id)) {
            void this.fetchRow(id);
        }
        return cached;
    }

    private fetchRow(id: bigint): Promise<RowData> {
        const promise = browserRowForId({ val: id }, { alertOnError: false })
            .then((row): RowData => ({
                cells: row.cells,
                color: row.color,
                fontName: row.fontName || "arial",
                fontSize: row.fontSize > 0 ? row.fontSize : 12,
                disabled: false,
            }))
            .catch((err): RowData => ({
                cells: get(this.activeColumns).map(() => ({
                    text: String((err as Error).message ?? err),
                    isRtl: false,
                    elideMode: BrowserRow_Cell_TextElideMode.ElideRight,
                } as BrowserRow_Cell)),
                color: BrowserRow_Color.DEFAULT,
                fontName: "arial",
                fontSize: 12,
                disabled: true,
            }))
            .then((row) => {
                this.rows.set(id, row);
                this.inflight.delete(id);
                this.scheduleRedraw();
                return row;
            });
        this.inflight.set(id, promise);
        return promise;
    }

    private scheduleRedraw(): void {
        if (this.redrawTimer) {
            return;
        }
        this.redrawTimer = setTimeout(() => {
            this.redrawTimer = undefined;
            this.rowsVersion.update((v) => v + 1);
        }, 16);
    }

    /** Forget cached rows after the collection changed (`DataModel.mark_cache_stale`). */
    invalidateRows(): void {
        this.rows.clear();
        this.scheduleRedraw();
        void this.refreshCurrent();
    }

    /** Remember a dragged column width for this profile. */
    async setColumnWidth(key: string, width: number): Promise<void> {
        const widths = { ...get(this.columnWidths), [key]: width };
        this.columnWidths.set(widths);
        try {
            await settingsSet("profile", COLUMN_WIDTHS_KEY, widths);
        } catch {
            // The settings store is optional in the browser-only harness.
        }
    }

    // Saved searches (SidebarTreeView._save_search and friends)
    // ---
    async savedSearches(): Promise<Record<string, string>> {
        const stored = await this.configJson<unknown>(SAVED_SEARCHES_KEY, {});
        const searches: Record<string, string> = {};
        if (stored && typeof stored === "object") {
            for (const [name, search] of Object.entries(stored as Record<string, unknown>)) {
                if (typeof search === "string") {
                    searches[name] = search;
                }
            }
        }
        return searches;
    }

    /** The search the table shows, for saving; empty before the first search. */
    currentSearch(): string {
        return this.lastSearch;
    }

    /** Store `search` under `name`; returns false when a different search of
     * that name exists and `overwrite` was not given. */
    async saveSearch(name: string, search: string, overwrite = false): Promise<boolean> {
        const searches = await this.savedSearches();
        if (name in searches && searches[name] !== search && !overwrite) {
            return false;
        }
        searches[name] = search;
        await this.setConfig(SAVED_SEARCHES_KEY, searches);
        await this.refreshSidebar();
        return true;
    }

    async removeSavedSearch(name: string): Promise<void> {
        const searches = await this.savedSearches();
        delete searches[name];
        await this.setConfig(SAVED_SEARCHES_KEY, searches);
        await this.refreshSidebar();
    }

    /** Returns false when `newName` is taken and `overwrite` was not given. */
    async renameSavedSearch(oldName: string, newName: string, overwrite = false): Promise<boolean> {
        const searches = await this.savedSearches();
        if (!(oldName in searches) || oldName === newName) {
            return true;
        }
        if (newName in searches && !overwrite) {
            return false;
        }
        searches[newName] = searches[oldName];
        delete searches[oldName];
        await this.setConfig(SAVED_SEARCHES_KEY, searches);
        await this.refreshSidebar();
        return true;
    }

    // Selection
    // ---
    select(selection: Selection): void {
        this.selection.set(selection);
        void this.refreshCurrent();
    }

    clickRow(selection: Selection): void {
        this.select(selection);
    }

    moveTo(index: number, extend = false): void {
        const count = get(this.items).length;
        if (count === 0) {
            return;
        }
        this.select(moveCurrent(get(this.selection), clampRow(index, count), extend));
    }

    moveBy(delta: number, extend = false): void {
        const current = get(this.selection).current ?? -1;
        this.moveTo(current + delta, extend);
    }

    selectAll(): void {
        this.select(selectAll(get(this.selection), get(this.items).length));
    }

    invertSelection(): void {
        this.select(invertSelection(get(this.selection), get(this.items).length));
    }

    /** Select the row of a card, e.g. when opened from the reviewer. */
    selectCard(cardId: bigint): void {
        const index = get(this.items).indexOf(cardId);
        if (index !== -1) {
            this.select(selectSingle(index));
        }
    }

    selectedItems(): bigint[] {
        const items = get(this.items);
        return selectedIndices(get(this.selection)).map((i) => items[i]).filter((i) => i !== undefined);
    }

    currentItem(): bigint | null {
        const current = get(this.selection).current;
        return current === null ? null : get(this.items)[current] ?? null;
    }

    selectionCount(): number {
        return get(this.selection).selected.size;
    }

    async selectedCardIds(): Promise<bigint[]> {
        const items = this.selectedItems();
        return get(this.notesMode) ? await this.cardIdsOfNotes(items) : items;
    }

    async selectedNoteIds(): Promise<bigint[]> {
        const items = this.selectedItems();
        return get(this.notesMode) ? items : await this.noteIdsOfCards(items);
    }

    private async cardIdsOfNotes(noteIds: bigint[]): Promise<bigint[]> {
        if (!noteIds.length) {
            return [];
        }
        const response = await searchCards({
            search: idSearch("nid", noteIds),
            order: new SortOrder({ value: { case: "none", value: {} } }),
        });
        return response.ids;
    }

    private async noteIdsOfCards(cardIds: bigint[]): Promise<bigint[]> {
        if (!cardIds.length) {
            return [];
        }
        const response = await searchNotes({
            search: idSearch("cid", cardIds),
            order: new SortOrder({ value: { case: "none", value: {} } }),
        });
        return response.ids;
    }

    /** Refresh the current and single-selected card/note after a selection or collection change. */
    private async refreshCurrent(): Promise<void> {
        const sequence = ++this.selectionSequence;
        const selection = get(this.selection);
        const items = get(this.items);
        const notesMode = get(this.notesMode);
        const currentItem = selection.current === null ? null : items[selection.current] ?? null;
        const singleItem = selection.selected.size === 1 ? items[selectedIndices(selection)[0]] ?? null : null;

        const load = async (item: bigint | null): Promise<[Card | null, Note | null]> => {
            if (item === null) {
                return [null, null];
            }
            try {
                if (notesMode) {
                    const note = await getNote({ nid: item }, { alertOnError: false });
                    const cards = await cardsOfNote({ nid: item }, { alertOnError: false });
                    const card = cards.cids.length
                        ? await getCard({ cid: cards.cids[0] }, { alertOnError: false })
                        : null;
                    return [card, note];
                }
                const card = await getCard({ cid: item }, { alertOnError: false });
                const note = await getNote({ nid: card.noteId }, { alertOnError: false });
                return [card, note];
            } catch {
                // Deleted since the search ran.
                return [null, null];
            }
        };

        const [current, single] = await Promise.all([
            load(currentItem),
            singleItem === currentItem ? null : load(singleItem),
        ]);
        if (sequence !== this.selectionSequence) {
            return;
        }
        this.currentCard.set(current[0]);
        this.currentNote.set(current[1]);
        const [singleCard, singleNote] = single ?? (singleItem === null ? [null, null] : current);
        this.singleCard.set(singleCard);
        this.singleNote.set(singleNote);
    }

    // Actions on the selection
    // ---
    private async withCards(fn: (cardIds: bigint[]) => Promise<void>): Promise<void> {
        const cardIds = await this.selectedCardIds();
        if (!cardIds.length) {
            this.notify(tr.browsingNoSelection());
            return;
        }
        try {
            await fn(cardIds);
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
        }
    }

    private async withNotes(fn: (noteIds: bigint[]) => Promise<void>): Promise<void> {
        const noteIds = await this.selectedNoteIds();
        if (!noteIds.length) {
            this.notify(tr.browsingNoSelection());
            return;
        }
        try {
            await fn(noteIds);
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
        }
    }

    async deckNames(): Promise<DeckNameId[]> {
        return (await getDeckNames({ skipEmptyDefault: false, includeFiltered: false })).entries;
    }

    /** `Browser.set_deck_of_selected_cards` once a deck was chosen. */
    setDeckOfSelected(deckId: bigint): Promise<void> {
        return this.withCards(async (cardIds) => {
            const changes = await setDeck({ cardIds, deckId }, { alertOnError: false });
            this.notify(tr.browsingCardsUpdated({ count: changes.count }));
        });
    }

    /** `Browser.set_flag_of_selected_cards`: the current card's flag toggles off. */
    setFlagOfSelected(flag: number): Promise<void> {
        return this.withCards(async (cardIds) => {
            const current = get(this.currentCard);
            const next = current && userFlag(current) === flag ? 0 : flag;
            await setFlag({ cardIds, flag: next }, { alertOnError: false });
            if (current && cardIds.includes(current.id)) {
                // Keep the toggle state right before the refetch lands.
                current.flags = (current.flags & ~0b111) | next;
                this.currentCard.set(current);
            }
        });
    }

    /** `Browser.suspend_selected_cards`, keyed off the current card's state. */
    toggleSuspend(): Promise<void> {
        return this.withCards(async (cardIds) => {
            const current = get(this.currentCard);
            if (current && isSuspended(current)) {
                await restoreBuriedAndSuspendedCards({ cids: cardIds }, { alertOnError: false });
            } else {
                await buryOrSuspendCards(
                    { cardIds, noteIds: [], mode: BuryOrSuspendCardsRequest_Mode.SUSPEND },
                    { alertOnError: false },
                );
            }
        });
    }

    /** `Browser.bury_selected_cards` */
    toggleBury(): Promise<void> {
        return this.withCards(async (cardIds) => {
            const current = get(this.currentCard);
            if (current && isBuried(current)) {
                await restoreBuriedAndSuspendedCards({ cids: cardIds }, { alertOnError: false });
            } else {
                await buryOrSuspendCards(
                    { cardIds, noteIds: [], mode: BuryOrSuspendCardsRequest_Mode.BURY_USER },
                    { alertOnError: false },
                );
            }
        });
    }

    addTagsToSelected(tags: string): Promise<void> {
        const spaceSeparated = tags.replace(/[ \n\t\v]+/g, " ").trim();
        if (!spaceSeparated) {
            return Promise.resolve();
        }
        return this.withNotes(async (noteIds) => {
            const changes = await addNoteTags({ noteIds, tags: spaceSeparated }, { alertOnError: false });
            this.notify(tr.browsingNotesUpdated({ count: changes.count }));
        });
    }

    removeTagsFromSelected(tags: string): Promise<void> {
        if (!tags.trim()) {
            return Promise.resolve();
        }
        return this.withNotes(async (noteIds) => {
            const changes = await removeNoteTags({ noteIds, tags }, { alertOnError: false });
            this.notify(tr.browsingNotesUpdated({ count: changes.count }));
        });
    }

    /** `Browser.toggle_mark_of_selected_notes` */
    toggleMark(): Promise<void> {
        const note = get(this.currentNote);
        if (note && isMarked(note)) {
            return this.removeTagsFromSelected(MARKED_TAG);
        }
        return this.addTagsToSelected(MARKED_TAG);
    }

    isCurrentMarked(): boolean {
        const note = get(this.currentNote);
        return !!note && isMarked(note);
    }

    isCurrentSuspended(): boolean {
        const card = get(this.currentCard);
        return !!card && isSuspended(card);
    }

    isCurrentBuried(): boolean {
        const card = get(this.currentCard);
        return !!card && isBuried(card);
    }

    /**
     * `Browser.delete_selected_notes`: move to a row of another note first,
     * then delete and search again so the rows disappear.
     */
    async deleteSelectedNotes(): Promise<void> {
        const noteIds = await this.selectedNoteIds();
        if (!noteIds.length) {
            return;
        }
        const items = get(this.items);
        const deleted = new Set(noteIds);
        const notesMode = get(this.notesMode);
        let nextItem: bigint | null = null;
        for (const row of removalCandidates(get(this.selection), items.length)) {
            const item = items[row];
            if (this.rows.get(item)?.disabled) {
                continue;
            }
            let noteId: bigint | null = item;
            if (!notesMode) {
                try {
                    noteId = (await getCard({ cid: item }, { alertOnError: false })).noteId;
                } catch {
                    continue;
                }
            }
            if (noteId !== null && !deleted.has(noteId)) {
                nextItem = item;
                break;
            }
        }
        try {
            const changes = await removeNotes({ noteIds, cardIds: [] }, { alertOnError: false });
            this.notify(tr.browsingCardsDeleted({ count: changes.count }));
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
            return;
        }
        const newItems = await this.findItems(this.lastSearch);
        this.items.set(newItems);
        this.select(selectionForItems(newItems, nextItem === null ? [] : [nextItem], nextItem));
    }

    async setDueDateDefault(): Promise<string> {
        try {
            return (await getConfigString({ key: ConfigKey_String.SET_DUE_BROWSER }, { alertOnError: false })).val;
        } catch {
            return "";
        }
    }

    /** `set_due_date_dialog` once the user answered. */
    setDueDateOfSelected(days: string): Promise<void> {
        return this.withCards(async (cardIds) => {
            await setDueDate(
                { cardIds, days, configKey: { key: ConfigKey_String.SET_DUE_BROWSER } },
                { alertOnError: false },
            );
            this.notify(tr.schedulingSetDueDateDone({ cards: cardIds.length }));
        });
    }

    async forgetDefaults(): Promise<ForgetOptions> {
        const defaults = await scheduleCardsAsNewDefaults({ context: ScheduleCardsAsNewRequest_Context.BROWSER });
        return { restorePosition: defaults.restorePosition, resetCounts: defaults.resetCounts };
    }

    /** `forget_cards` */
    forgetSelected(options: ForgetOptions): Promise<void> {
        return this.withCards(async (cardIds) => {
            await scheduleCardsAsNew(
                {
                    cardIds,
                    log: true,
                    restorePosition: options.restorePosition,
                    resetCounts: options.resetCounts,
                    context: ScheduleCardsAsNewRequest_Context.BROWSER,
                },
                { alertOnError: false },
            );
            this.notify(tr.schedulingForgotCards({ cards: cardIds.length }));
        });
    }

    async repositionDefaults(): Promise<RepositionOptions> {
        const defaults = await repositionDefaults({});
        return { start: 0, step: 1, randomize: defaults.random, shift: defaults.shift };
    }

    /** `reposition_new_cards_dialog` */
    repositionSelected(options: RepositionOptions): Promise<void> {
        return this.withCards(async (cardIds) => {
            const changes = await sortCards(
                {
                    cardIds,
                    startingFrom: options.start,
                    stepSize: options.step,
                    randomize: options.randomize,
                    shiftExisting: options.shift,
                },
                { alertOnError: false },
            );
            this.notify(tr.browsingChangedNewPosition({ count: changes.count }));
        });
    }

    async fieldNamesOfSelected(): Promise<string[]> {
        const nids = await this.selectedNoteIds();
        if (!nids.length) {
            return [];
        }
        return (await fieldNamesForNotes({ nids })).fields;
    }

    /** `FindAndReplaceDialog.accept` */
    async findAndReplace(options: FindReplaceOptions): Promise<void> {
        const nids = options.selectedOnly ? await this.selectedNoteIds() : [];
        try {
            const changes = options.field === FIND_REPLACE_TAGS
                ? await findAndReplaceTag(
                    {
                        noteIds: nids,
                        search: options.search,
                        replacement: options.replacement,
                        regex: options.regex,
                        matchCase: options.matchCase,
                    },
                    { alertOnError: false },
                )
                : await findAndReplace(
                    {
                        nids,
                        search: options.search,
                        replacement: options.replacement,
                        regex: options.regex,
                        matchCase: options.matchCase,
                        fieldName: options.field,
                    },
                    { alertOnError: false },
                );
            this.notify(
                nids.length
                    ? tr.findreplaceNotesUpdated({ changed: changes.count, total: nids.length })
                    : tr.browsingNotesUpdated({ count: changes.count }),
            );
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
        }
    }

    /** The notetype shared by the selected notes, for Change Notetype. */
    async notetypeOfSelected(): Promise<{ notetypeId: bigint; noteIds: bigint[] } | null> {
        const noteIds = await this.selectedNoteIds();
        if (!noteIds.length) {
            this.notify(tr.browsingNoSelection());
            return null;
        }
        try {
            const { ntid } = await getSingleNotetypeOfNotes({ noteIds }, { alertOnError: false });
            return { notetypeId: ntid, noteIds };
        } catch (err) {
            this.notify(String((err as Error).message ?? err));
            return null;
        }
    }

    /** Undo the last operation; returns its name, or null if nothing to undo. */
    async undo(): Promise<string | null> {
        try {
            const result = await undoLast();
            if (result.kind === "nothing") {
                return null;
            }
            await this.search();
            return result.operation || null;
        } catch {
            return null;
        }
    }

    /** Search for the notes of the selection (`Browser.selectNotes`). */
    async selectNotes(): Promise<void> {
        const noteIds = await this.selectedNoteIds();
        if (!noteIds.length) {
            return;
        }
        const search = (await buildSearchString(
            new SearchNode({ filter: { case: "nids", value: { ids: noteIds } } }),
        )).val;
        this.select(EMPTY_SELECTION);
        await this.searchFor(search);
        this.selectAll();
    }
}
