<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The Browse window as a screen in the shell: sidebar, search box, the
card/note table, the editor for the selected note, and the Notes/Cards
actions with their Qt shortcuts (qt/aqt/browser/browser.py).
-->
<script lang="ts">
    import type { Card } from "@generated/anki/cards_pb";
    import type { Note } from "@generated/anki/notes_pb";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import EditorPanel from "../EditorPanel.svelte";
    import { currentDeckId, MARKED_TAG, userFlag } from "../reviewer";
    import { isOperation, onRpcDone } from "../rpc-events";
    import { ShortcutMap, shortcutLabel } from "../shortcuts";
    import { BrowserController, FIND_REPLACE_TAGS } from "./browser";
    import BrowserSidebar from "./BrowserSidebar.svelte";
    import BrowserTable from "./BrowserTable.svelte";
    import CardInfoPanel from "./CardInfoPanel.svelte";
    import ChangeNotetypeFrame from "./ChangeNotetypeFrame.svelte";
    import type { DialogField, DialogValues } from "./OptionsDialog.svelte";
    import OptionsDialog from "./OptionsDialog.svelte";
    import PreviewPane from "./PreviewPane.svelte";
    import { FLAG_LABELS } from "./search";

    /** A search to run instead of the default one, e.g. from another screen. */
    export let initialSearch: string | null = null;
    export let nightMode = false;

    const dispatch = createEventDispatcher<{ close: void; undone: string | null; notify: string }>();

    const controller = new BrowserController();
    const items = controller.items;
    const selection = controller.selection;
    const notesMode = controller.notesMode;
    const searchText = controller.searchText;
    const history = controller.history;
    const currentCard = controller.currentCard;
    const currentNote = controller.currentNote;
    const singleCard = controller.singleCard;
    const singleNote = controller.singleNote;
    const sidebarItems = controller.sidebar;
    const searching = controller.searching;

    controller.notify = (message) => dispatch("notify", message);

    /** Operations after which the shown note's text or tags may differ. */
    const NOTE_TEXT_METHODS = new Set([
        "updateNotes",
        "addNoteTags",
        "removeNoteTags",
        "findAndReplace",
        "findAndReplaceTag",
        "changeNotetype",
        "undo",
        "redo",
    ]);

    interface MenuItem {
        label: string;
        shortcut?: string;
        action?: () => void;
        checked?: boolean;
        color?: string;
        divider?: boolean;
    }

    interface Dialog {
        title: string;
        fields: DialogField[];
        okLabel: string;
        resolve: (values: DialogValues | null) => void;
    }

    let table: BrowserTable;
    let sidebar: BrowserSidebar;
    let editor: EditorPanel | undefined;
    let preview: PreviewPane | undefined;
    let searchInput: HTMLInputElement;
    let showSidebar = true;
    let showPreview = false;
    let showCardInfo = false;
    let changeNotetype: { notetypeId: bigint; noteIds: bigint[] } | null = null;
    let menu: { kind: "notes" | "cards" | "flags" | "context"; x: number; y: number } | null = null;
    let dialog: Dialog | null = null;
    /** What the editor shows; follows the single selection once the editor saved. */
    let editorNote: Note | null = null;
    let editorCard: Card | null = null;
    let editorSequence = 0;
    let offRpcDone: (() => void) | undefined;
    let sidebarTimer: ReturnType<typeof setTimeout> | undefined;
    /** The key event being handled, for actions that depend on where focus is. */
    let handling: KeyboardEvent | null = null;

    $: title = ($notesMode ? tr.browsingWindowTitleNotes : tr.browsingWindowTitle)({
        selected: $selection.selected.size,
        total: $items.length,
    });
    $: marked = !!$currentNote?.tags.some((t) => t.toLowerCase() === MARKED_TAG);
    $: suspended = $currentCard?.queue === -1;
    $: buried = $currentCard?.queue === -2 || $currentCard?.queue === -3;
    $: flag = $currentCard ? userFlag($currentCard) : 0;

    $: void followSelection($singleNote, $singleCard);

    /** Show the selected note in the editor, saving the previous one first (`ensure_editor_saved`). */
    async function followSelection(note: Note | null, card: Card | null): Promise<void> {
        const sequence = ++editorSequence;
        if (editorNote && note?.id !== editorNote.id) {
            await editor?.saveNow();
        }
        if (sequence !== editorSequence) {
            return;
        }
        editorNote = note;
        editorCard = card;
    }

    function askDialog(title: string, fields: DialogField[], okLabel = "OK"): Promise<DialogValues | null> {
        return new Promise((resolve) => {
            dialog = { title, fields, okLabel, resolve };
        });
    }

    function closeDialog(values: DialogValues | null): void {
        const current = dialog;
        dialog = null;
        current?.resolve(values);
        table?.focus();
    }

    // Actions
    ////////////////////////////////////////////////////////////////////////

    async function saveEditor(): Promise<void> {
        await editor?.saveNow();
    }

    async function runSearch(): Promise<void> {
        await saveEditor();
        await controller.searchFromInput();
    }

    async function changeDeck(): Promise<void> {
        await saveEditor();
        const cardIds = await controller.selectedCardIds();
        if (!cardIds.length) {
            return;
        }
        const decks = await controller.deckNames();
        const current = $currentCard ? currentDeckId($currentCard) : decks[0]?.id ?? 1n;
        const values = await askDialog(
            tr.browsingChangeDeck(),
            [
                {
                    key: "deck",
                    label: tr.browsingMoveCardsToDeck(),
                    kind: "select",
                    value: current.toString(),
                    options: decks.map((d) => ({ value: d.id.toString(), label: d.name })),
                },
            ],
            tr.browsingMoveCards(),
        );
        if (values) {
            await controller.setDeckOfSelected(BigInt(values.deck as string));
        }
    }

    async function setFlag(n: number): Promise<void> {
        await saveEditor();
        await controller.setFlagOfSelected(n);
    }

    async function toggleSuspend(): Promise<void> {
        await saveEditor();
        await controller.toggleSuspend();
    }

    async function toggleBury(): Promise<void> {
        await saveEditor();
        await controller.toggleBury();
    }

    async function toggleMark(): Promise<void> {
        await saveEditor();
        await controller.toggleMark();
    }

    /** `Browser.delete_selected_notes`: ignored while typing in the editor or search box. */
    async function deleteNotes(): Promise<void> {
        const target = handling?.target as Element | null;
        if (handling && (handling.view !== window || isTypingElement(target))) {
            return;
        }
        editorNote = null;
        editorCard = null;
        await controller.deleteSelectedNotes();
        table?.focus();
    }

    /** One text field. A dialog rather than window.prompt: the prompt blocks
     * scripts, so the editor's blur-save would only run after it closed and
     * race the operation. */
    async function askText(title: string, label: string, value = "", hint?: string): Promise<string | null> {
        const values = await askDialog(title, [{ key: "text", label, kind: "text", value, hint }]);
        const text = values ? String(values.text).trim() : "";
        return text || null;
    }

    async function addTags(): Promise<void> {
        await saveEditor();
        const tags = await askText(tr.browsingAddTags2(), tr.browsingEnterTagsToAdd());
        if (tags) {
            await controller.addTagsToSelected(tags);
        }
    }

    async function removeTags(): Promise<void> {
        await saveEditor();
        const tags = await askText(tr.browsingRemoveTags(), tr.browsingEnterTagsToDelete());
        if (tags) {
            await controller.removeTagsFromSelected(tags);
        }
    }

    async function setDueDate(): Promise<void> {
        await saveEditor();
        const cardIds = await controller.selectedCardIds();
        if (!cardIds.length) {
            return;
        }
        const days = await askText(
            tr.actionsSetDueDate(),
            tr.schedulingSetDueDatePrompt({ cards: cardIds.length }),
            await controller.setDueDateDefault(),
            tr.schedulingSetDueDatePromptHint(),
        );
        if (days) {
            await controller.setDueDateOfSelected(days);
        }
    }

    async function forget(): Promise<void> {
        await saveEditor();
        const defaults = await controller.forgetDefaults();
        const values = await askDialog(tr.actionsForgetCard(), [
            {
                key: "restorePosition",
                label: tr.schedulingRestorePosition(),
                kind: "checkbox",
                value: defaults.restorePosition,
            },
            { key: "resetCounts", label: tr.schedulingResetCounts(), kind: "checkbox", value: defaults.resetCounts },
        ]);
        if (values) {
            await controller.forgetSelected({
                restorePosition: !!values.restorePosition,
                resetCounts: !!values.resetCounts,
            });
        }
    }

    async function reposition(): Promise<void> {
        await saveEditor();
        const defaults = await controller.repositionDefaults();
        const values = await askDialog(tr.browsingRepositionNewCards(), [
            { key: "start", label: tr.browsingStartPosition(), kind: "number", value: defaults.start },
            { key: "step", label: tr.browsingStep(), kind: "number", value: defaults.step },
            { key: "randomize", label: tr.browsingRandomizeOrder(), kind: "checkbox", value: defaults.randomize },
            {
                key: "shift",
                label: tr.browsingShiftPositionOfExistingCards(),
                kind: "checkbox",
                value: defaults.shift,
            },
        ]);
        if (values) {
            await controller.repositionSelected({
                start: Number(values.start),
                step: Number(values.step),
                randomize: !!values.randomize,
                shift: !!values.shift,
            });
        }
    }

    async function findReplace(): Promise<void> {
        await saveEditor();
        const fields = await controller.fieldNamesOfSelected();
        const hasSelection = controller.selectionCount() > 0;
        const values = await askDialog(tr.browsingFindAndReplace(), [
            { key: "search", label: tr.browsingFind(), kind: "text", value: "" },
            { key: "replacement", label: tr.browsingReplaceWith(), kind: "text", value: "" },
            {
                key: "field",
                label: tr.browsingIn(),
                kind: "select",
                value: "",
                options: [
                    { value: "", label: tr.browsingAllFields() },
                    { value: FIND_REPLACE_TAGS, label: tr.editingTags() },
                    ...fields.map((f) => ({ value: f, label: f })),
                ],
            },
            {
                key: "selectedOnly",
                label: tr.browsingSelectedNotesOnly(),
                kind: "checkbox",
                value: hasSelection,
            },
            { key: "regex", label: tr.browsingTreatInputAsRegularExpression(), kind: "checkbox", value: false },
            { key: "ignoreCase", label: tr.browsingIgnoreCase(), kind: "checkbox", value: true },
        ]);
        if (values) {
            await controller.findAndReplace({
                search: String(values.search),
                replacement: String(values.replacement),
                field: String(values.field),
                selectedOnly: !!values.selectedOnly,
                regex: !!values.regex,
                matchCase: !values.ignoreCase,
            });
        }
    }

    async function openChangeNotetype(): Promise<void> {
        await saveEditor();
        changeNotetype = await controller.notetypeOfSelected();
    }

    async function onNotetypeChanged(count: number): Promise<void> {
        changeNotetype = null;
        dispatch("notify", tr.browsingNotesUpdated({ count }));
        await controller.search();
        void controller.refreshSidebar();
    }

    function toggleCardInfo(): void {
        showCardInfo = !showCardInfo;
    }

    let lastPreviewToggle = 0;

    /** Ctrl+Shift+P reaches us twice from the editor, in the same task (its
     * own preview shortcut over the bridge, and the forwarded key); count it once. */
    function togglePreview(): void {
        const now = Date.now();
        if (now - lastPreviewToggle < 50) {
            return;
        }
        lastPreviewToggle = now;
        showPreview = !showPreview;
    }

    async function undo(): Promise<void> {
        await saveEditor();
        const operation = await controller.undo();
        dispatch("undone", operation);
    }

    function focusSearch(): void {
        searchInput?.focus();
        searchInput?.select();
    }

    async function moveBy(delta: number): Promise<void> {
        await saveEditor();
        controller.moveBy(delta);
        table?.focus();
    }

    /** Close the way the window's close button would: after saving the editor. */
    export async function requestClose(): Promise<void> {
        await saveEditor();
        dispatch("close");
    }

    /** Run a search from elsewhere while the browser is open (`Browser.reopen`). */
    export async function searchForTerms(search: string): Promise<void> {
        await saveEditor();
        await controller.searchForTerms(search);
    }

    // Keyboard
    ////////////////////////////////////////////////////////////////////////

    const shortcuts = new ShortcutMap().addAll([
        ["Ctrl+d", () => void changeDeck()],
        ["Ctrl+1", () => void setFlag(1)],
        ["Ctrl+2", () => void setFlag(2)],
        ["Ctrl+3", () => void setFlag(3)],
        ["Ctrl+4", () => void setFlag(4)],
        ["Ctrl+5", () => void setFlag(5)],
        ["Ctrl+6", () => void setFlag(6)],
        ["Ctrl+7", () => void setFlag(7)],
        ["Ctrl+j", () => void toggleSuspend()],
        ["Ctrl+Shift+j", () => void toggleBury()],
        ["Ctrl+Delete", () => void deleteNotes()],
        ["Ctrl+Backspace", () => void deleteNotes()],
        ["Ctrl+Shift+a", () => void addTags()],
        ["Ctrl+Alt+Shift+a", () => void removeTags()],
        ["Ctrl+Shift+d", () => void setDueDate()],
        ["Ctrl+Alt+n", () => void forget()],
        ["Ctrl+Shift+s", () => void reposition()],
        ["Ctrl+k", () => void toggleMark()],
        ["Ctrl+Shift+i", () => toggleCardInfo()],
        ["Ctrl+Shift+m", () => void openChangeNotetype()],
        ["Ctrl+Shift+p", () => togglePreview()],
        ["Ctrl+Alt+f", () => void findReplace()],
        ["Ctrl+f", () => focusSearch()],
        ["Ctrl+Shift+l", () => table?.focus()],
        ["Ctrl+Shift+f", () => sidebar?.focusFilter()],
        ["Ctrl+Shift+r", () => (showSidebar = !showSidebar)],
        ["Ctrl+Alt+t", () => void controller.toggleMode()],
        ["Ctrl+n", () => void moveBy(1)],
        ["Ctrl+p", () => void moveBy(-1)],
        ["Ctrl+Alt+a", () => controller.selectAll()],
        ["Ctrl+Alt+s", () => controller.invertSelection()],
        ["Ctrl+z", () => void undo()],
        ["Escape", () => void requestClose()],
    ]);

    /** Like shortcuts.isTypingTarget, but for elements from any frame. */
    function isTypingElement(target: Element | null | undefined): boolean {
        if (!target || typeof target !== "object") {
            return false;
        }
        const tag = (target as Element).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
            return true;
        }
        return (target as HTMLElement).isContentEditable === true;
    }

    /** Arrow keys and the like, only when the table itself has the keys. */
    function handleNavigation(event: KeyboardEvent): boolean {
        const extend = event.shiftKey;
        const pageRows = 20;
        switch (event.key) {
            case "ArrowDown":
                controller.moveBy(1, extend);
                return true;
            case "ArrowUp":
                controller.moveBy(-1, extend);
                return true;
            case "PageDown":
                controller.moveBy(pageRows, extend);
                return true;
            case "PageUp":
                controller.moveBy(-pageRows, extend);
                return true;
            case "Home":
                controller.moveTo(0, extend);
                return true;
            case "End":
                controller.moveTo($items.length - 1, extend);
                return true;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
            controller.selectAll();
            return true;
        }
        return false;
    }

    /** Keys from the shell window; true when handled. */
    export function handleKey(event: KeyboardEvent): boolean {
        if (dialog) {
            // The dialog owns the keyboard; keep the shell's shortcuts out.
            return true;
        }
        if (menu) {
            if (event.key === "Escape") {
                menu = null;
            }
            return true;
        }
        const target = (event.composedPath?.()[0] ?? event.target) as Element | null;
        const typing = isTypingElement(target);
        const fromFrame = event.view !== window;
        if (!typing && !fromFrame && handleNavigation(event)) {
            event.preventDefault();
            return true;
        }
        if (typing && event.key === "Escape" && !fromFrame) {
            // Escape in the search box returns to the table rather than closing.
            table?.focus();
            return true;
        }
        handling = event;
        const handled = shortcuts.handle(event);
        handling = null;
        if (handled) {
            event.preventDefault();
            return true;
        }
        return false;
    }

    /** Keys pressed inside the editor document. */
    function onFrameKey(event: KeyboardEvent): void {
        const modified = event.ctrlKey || event.metaKey;
        // The editor handles its own undo.
        const editorOwned = event.key.toLowerCase() === "z";
        if (event.key === "Escape" || (modified && !editorOwned)) {
            handleKey(event);
        }
    }

    /** Keys pressed inside the preview's card document. */
    function onPreviewKey(event: KeyboardEvent): void {
        if (event.key === "Escape" || event.ctrlKey || event.metaKey) {
            handleKey(event);
        }
    }

    // Menus
    ////////////////////////////////////////////////////////////////////////

    $: notesMenu = [
        { label: tr.browsingAddTags2(), shortcut: "Ctrl+Shift+A", action: () => void addTags() },
        { label: tr.browsingRemoveTags(), shortcut: "Ctrl+Alt+Shift+A", action: () => void removeTags() },
        { label: tr.browsingToggleMark(), shortcut: "Ctrl+K", action: () => void toggleMark(), checked: marked },
        {
            label: tr.browsingChangeNotetype(),
            shortcut: "Ctrl+Shift+M",
            action: () => void openChangeNotetype(),
        },
        { label: tr.browsingFindAndReplace(), shortcut: "Ctrl+Alt+F", action: () => void findReplace() },
        { label: "", divider: true },
        { label: tr.browsingDeleteNotes(), shortcut: "Ctrl+Delete", action: () => void deleteNotes() },
    ] as MenuItem[];

    $: cardsMenu = [
        { label: tr.browsingChangeDeck(), shortcut: "Ctrl+D", action: () => void changeDeck() },
        { label: tr.actionsCardInfo(), shortcut: "Ctrl+Shift+I", action: toggleCardInfo, checked: showCardInfo },
        { label: tr.actionsPreview(), shortcut: "Ctrl+Shift+P", action: togglePreview, checked: showPreview },
        { label: "", divider: true },
        { label: tr.actionsReposition(), shortcut: "Ctrl+Shift+S", action: () => void reposition() },
        { label: tr.actionsSetDueDate(), shortcut: "Ctrl+Shift+D", action: () => void setDueDate() },
        { label: tr.actionsForgetCard(), shortcut: "Ctrl+Alt+N", action: () => void forget() },
        { label: "", divider: true },
        {
            label: tr.browsingToggleSuspend(),
            shortcut: "Ctrl+J",
            action: () => void toggleSuspend(),
            checked: suspended,
        },
        { label: tr.browsingToggleBury(), shortcut: "Ctrl+Shift+J", action: () => void toggleBury(), checked: buried },
    ] as MenuItem[];

    $: flagsMenu = FLAG_LABELS.map((label, i): MenuItem => ({
        label: label(),
        shortcut: `Ctrl+${i + 1}`,
        action: () => void setFlag(i + 1),
        checked: flag === i + 1,
        color: `--flag-${i + 1}`,
    }));

    $: contextMenu = [
        ...($notesMode ? notesMenu : cardsMenu),
        { label: "", divider: true },
        ...($notesMode ? cardsMenu : notesMenu),
        { label: "", divider: true },
        ...flagsMenu,
    ] as MenuItem[];

    function menuItems(kind: "notes" | "cards" | "flags" | "context"): MenuItem[] {
        switch (kind) {
            case "notes":
                return notesMenu;
            case "cards":
                return cardsMenu;
            case "flags":
                return flagsMenu;
            default:
                return contextMenu;
        }
    }

    function openMenu(kind: "notes" | "cards" | "flags", event: MouseEvent): void {
        if (menu?.kind === kind) {
            menu = null;
            return;
        }
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        menu = { kind, x: rect.left, y: rect.bottom + 2 };
    }

    function runMenuItem(item: MenuItem): void {
        menu = null;
        item.action?.();
    }

    // Lifecycle
    ////////////////////////////////////////////////////////////////////////

    function scheduleSidebarRefresh(): void {
        clearTimeout(sidebarTimer);
        sidebarTimer = setTimeout(() => void controller.refreshSidebar(), 500);
    }

    onMount(async () => {
        offRpcDone = onRpcDone((method, frame) => {
            if (isOperation(method)) {
                controller.invalidateRows();
                scheduleSidebarRefresh();
                if (NOTE_TEXT_METHODS.has(method)) {
                    // Like Browser.on_operation_did_execute on changes.note_text.
                    editor?.reloadNote(frame);
                    preview?.refresh();
                }
            }
        });
        await controller.start(initialSearch);
        if (initialSearch === null) {
            focusSearch();
        } else {
            table?.focus();
        }
    });

    onDestroy(() => {
        offRpcDone?.();
        clearTimeout(sidebarTimer);
    });
</script>

<div class="browser" class:no-sidebar={!showSidebar}>
    {#if showSidebar}
        <BrowserSidebar
            bind:this={sidebar}
            items={$sidebarItems}
            on:search={(e) => {
                void saveEditor().then(() => controller.sidebarSearch(e.detail.item, e.detail.mods));
            }}
        />
    {/if}

    <div class="main">
        <div class="toolbar">
            <div class="mode" title={tr.browsingToggleShowingCardsNotes()}>
                <button class:active={!$notesMode} on:click={() => $notesMode && controller.toggleMode()}>
                    {tr.browsingCards()}
                </button>
                <button class:active={$notesMode} on:click={() => !$notesMode && controller.toggleMode()}>
                    {tr.browsingNotes()}
                </button>
            </div>
            <input
                bind:this={searchInput}
                class="search"
                type="text"
                list="browser-search-history"
                placeholder={tr.browsingSearchBarHint()}
                bind:value={$searchText}
                on:keydown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        void runSearch();
                    }
                }}
            />
            <datalist id="browser-search-history">
                {#each $history as entry (entry)}
                    <option value={entry}></option>
                {/each}
            </datalist>
            <button class="tool" on:click={() => void runSearch()}>{tr.actionsSearch()}</button>
            <span class="spacer"></span>
            <button class="tool" on:click={(e) => openMenu("notes", e)}>{tr.browsingNotes()} ▾</button>
            <button class="tool" on:click={(e) => openMenu("cards", e)}>{tr.browsingCards()} ▾</button>
            <button class="tool" on:click={(e) => openMenu("flags", e)}>{tr.actionsSetFlag()} ▾</button>
        </div>

        <div class="status" class:busy={$searching}>{title}</div>

        <div class="split" class:with-side={editorNote || showPreview}>
            <div class="table-pane">
                <BrowserTable
                    bind:this={table}
                    {controller}
                    on:contextmenu={(e) => (menu = { kind: "context", x: e.detail.x, y: e.detail.y })}
                />
            </div>
            {#if editorNote || showPreview}
                <div class="side">
                    {#if showPreview}
                        <div class="preview-pane">
                            <PreviewPane
                                bind:this={preview}
                                card={$singleCard}
                                {nightMode}
                                onKeydown={onPreviewKey}
                                on:close={() => (showPreview = false)}
                            />
                        </div>
                    {/if}
                    {#if editorNote}
                        <div class="editor-pane">
                            <EditorPanel
                                bind:this={editor}
                                mode="browser"
                                noteId={editorNote.id}
                                cardId={editorCard?.id ?? null}
                                {nightMode}
                                onKeydown={onFrameKey}
                                on:preview={togglePreview}
                                on:close={() => void requestClose()}
                            />
                        </div>
                    {/if}
                </div>
            {/if}
        </div>

        {#if showCardInfo}
            <div class="overlay">
                <CardInfoPanel cardId={$currentCard?.id ?? null} {nightMode} on:close={() => (showCardInfo = false)} />
            </div>
        {/if}
        {#if changeNotetype}
            <div class="overlay">
                <ChangeNotetypeFrame
                    notetypeId={changeNotetype.notetypeId}
                    noteIds={changeNotetype.noteIds}
                    {nightMode}
                    on:close={() => (changeNotetype = null)}
                    on:done={(e) => void onNotetypeChanged(e.detail)}
                />
            </div>
        {/if}
    </div>

    {#if menu}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <div class="menu-backdrop" on:click={() => (menu = null)} on:contextmenu|preventDefault={() => (menu = null)}>
            <div class="menu" role="menu" style="left: {menu.x}px; top: {menu.y}px">
                {#each menuItems(menu.kind) as item, i (i)}
                    {#if item.divider}
                        <div class="divider"></div>
                    {:else}
                        <button role="menuitem" on:click|stopPropagation={() => runMenuItem(item)}>
                            <span class="check">{item.checked ? "✓" : ""}</span>
                            {#if item.color}
                                <span class="flag-dot" style="background: var({item.color})"></span>
                            {/if}
                            <span class="label">{item.label}</span>
                            {#if item.shortcut}
                                <kbd>{shortcutLabel(item.shortcut)}</kbd>
                            {/if}
                        </button>
                    {/if}
                {/each}
            </div>
        </div>
    {/if}

    {#if dialog}
        <OptionsDialog
            title={dialog.title}
            fields={dialog.fields}
            okLabel={dialog.okLabel}
            on:ok={(e) => closeDialog(e.detail)}
            on:cancel={() => closeDialog(null)}
        />
    {/if}
</div>

<style>
    .browser {
        display: grid;
        grid-template-columns: 220px minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        position: relative;
        background: var(--canvas);
    }
    .browser.no-sidebar {
        grid-template-columns: minmax(0, 1fr);
    }
    .main {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        position: relative;
    }
    .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--canvas-elevated);
    }
    .mode {
        display: flex;
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        overflow: hidden;
        flex: none;
    }
    .mode button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 0;
        padding: 3px 10px;
        cursor: pointer;
    }
    .mode button.active {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .search {
        flex: 1;
        min-width: 120px;
        font: inherit;
        color: var(--fg);
        background: var(--canvas-inset);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 3px 8px;
    }
    .search:focus {
        outline: none;
        border-color: var(--border-focus);
    }
    .spacer {
        flex: 0 0 8px;
    }
    .tool {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 3px 10px;
        cursor: pointer;
        white-space: nowrap;
    }
    .tool:hover {
        border-color: var(--button-hover-border);
    }
    .status {
        padding: 2px 10px;
        font-size: 12px;
        color: var(--fg-subtle);
        border-bottom: 1px solid var(--border);
        background: var(--canvas-elevated);
    }
    .status.busy {
        opacity: 0.6;
    }
    .split {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
    }
    .split.with-side {
        grid-template-columns: minmax(0, 1fr) minmax(360px, 42%);
    }
    .table-pane {
        min-height: 0;
        min-width: 0;
    }
    .side {
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-inline-start: 1px solid var(--border);
        background: var(--canvas);
    }
    .preview-pane {
        flex: 1;
        min-height: 160px;
        border-bottom: 1px solid var(--border);
    }
    .editor-pane {
        flex: 1.4;
        min-height: 0;
    }
    .overlay {
        position: absolute;
        inset: 0;
        z-index: 25;
        background: var(--canvas);
    }
    .menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 30;
    }
    .menu {
        position: fixed;
        min-width: 240px;
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow);
        padding: 4px;
        display: flex;
        flex-direction: column;
    }
    .menu button {
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: start;
        font: inherit;
        color: inherit;
        background: transparent;
        border: 0;
        padding: 5px 10px;
        cursor: pointer;
    }
    .menu button:hover {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .menu .label {
        flex: 1;
    }
    .menu .check {
        display: inline-block;
        width: 12px;
    }
    .menu kbd {
        font-size: 11px;
        color: var(--fg-subtle);
    }
    .divider {
        height: 1px;
        background: var(--border);
        margin: 4px 0;
    }
    .flag-dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
    }
</style>
