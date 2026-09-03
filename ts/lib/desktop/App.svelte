<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The desktop app shell: deck list on the left, and on the right whichever of
the overview, the study screen, the add-note editor or an embedded page is
active.
-->
<script lang="ts">
    import type { DeckTreeNode } from "@generated/anki/decks_pb";
    import { SyncStatusResponse_Required } from "@generated/anki/sync_pb";
    import { buildSearchString, redo, studiedToday, undo } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { onDestroy, onMount } from "svelte";

    import BrowserScreen from "./browser/BrowserScreen.svelte";
    import type { DeckRow } from "./decks";
    import {
        createDeck,
        deleteDeck,
        fetchCurrentDeckId,
        fetchDeckTree,
        flattenTree,
        renameDeckTo,
        selectDeck,
        setCollapsed,
    } from "./decks";
    import DeckSidebar from "./DeckSidebar.svelte";
    import EditorPanel, { editorNoteInfo } from "./EditorPanel.svelte";
    import {
        openLink,
        reopenCollection,
        settingsGet,
        settingsSet,
    } from "./desktop-api";
    import EmbeddedPage from "./EmbeddedPage.svelte";
    import { installFrontendService } from "./frontend-service";
    import { installMenuHandlers } from "./menu-actions";
    import NotetypeDialogs from "./notetypes/NotetypeDialogs.svelte";
    import NotetypesScreen from "./notetypes/NotetypesScreen.svelte";
    import Overview from "./Overview.svelte";
    import Reviewer from "./Reviewer.svelte";
    import { ReviewerController } from "./reviewer";
    import { installRpcDoneHook, isOperation, onRpcDone } from "./rpc-events";
    import { installShellServices } from "./shell-services";
    import { isTypingTarget, ShortcutMap } from "./shortcuts";
    import ToolHost, { type PageRequest } from "./tools/ToolHost.svelte";
    import { TOOL_SHORTCUTS } from "./tools/tools";
    import ToolsMenu from "./tools/ToolsMenu.svelte";
    import { SYNC_TITLE, SyncController } from "./sync/sync";
    import { backendSyncRpc } from "./sync/sync-rpc";
    import SyncPanel from "./sync/SyncPanel.svelte";

    type Screen =
        | { kind: "overview" }
        | { kind: "review" }
        | { kind: "add" }
        | { kind: "notetypes" }
        | { kind: "browse"; search: string | null }
        | { kind: "page"; title: string; src: string; onClose?: () => void };

    let tree: DeckTreeNode | null = null;
    let rows: DeckRow[] = [];
    let currentDeckId = 1n;
    let studied = "";
    let screen: Screen = { kind: "overview" };
    let overviewVersion = 0;
    let nightMode = false;
    let reviewer: Reviewer;
    let embedded: EmbeddedPage;
    let addEditor: EditorPanel;
    let tools: ToolHost;
    let browser: BrowserScreen;
    let toast: string | null = null;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    let notetypeDialogs: NotetypeDialogs;
    let notetypesVersion = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new ReviewerController();

    // AnkiWeb sync (sync/sync.ts); SyncPanel below renders its prompts.
    const sync = new SyncController(
        backendSyncRpc,
        {
            get: (key) => settingsGet("profile", key),
            set: (key, value) => settingsSet("profile", key, value),
        },
        {
            notify: (message) => showToast(message),
            willFullSync: () => {
                screen = { kind: "overview" };
            },
            didFullSync: async () => {
                await reopenCollection();
                controller.invalidateConfig();
                await refreshDecks();
            },
            didSync: () => refreshDecks(),
        },
    );
    const syncing = sync.syncing;
    const syncStatus = sync.status;

    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme(): void {
        nightMode = darkQuery.matches;
        document.documentElement.classList.toggle("night-mode", nightMode);
        document.documentElement.dataset.bsTheme = nightMode ? "dark" : "light";
        document.body.classList.toggle("nightMode", nightMode);
        document.body.classList.toggle("night_mode", nightMode);
        controller.setNightMode(nightMode);
    }

    async function refreshDecks(): Promise<void> {
        tree = await fetchDeckTree();
        rows = flattenTree(tree);
        studied = (await studiedToday({})).val;
        overviewVersion += 1;
    }

    /** Refresh the deck list shortly after a collection change from any frame. */
    function scheduleRefresh(): void {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void refreshDecks(), 300);
    }

    async function onSelectDeck(id: bigint): Promise<void> {
        await selectDeck(id);
        currentDeckId = id;
        if (screen.kind !== "add") {
            screen = { kind: "overview" };
        }
        await refreshDecks();
    }

    async function onToggle(id: bigint, collapsed: boolean): Promise<void> {
        await setCollapsed(id, collapsed);
        await refreshDecks();
    }

    function startStudy(): void {
        screen = { kind: "review" };
    }

    async function onReviewFinished(): Promise<void> {
        screen = { kind: "overview" };
        await refreshDecks();
    }

    /** Tools: embed one of the SvelteKit routes (statistics, import, preferences). */
    function openPage(page: PageRequest): void {
        screen = { kind: "page", ...page };
    }

    /** Tools: the collection changed, and possibly the current deck with it. */
    async function onToolChanged(): Promise<void> {
        currentDeckId = await fetchCurrentDeckId();
        await refreshDecks();
    }

    function openDeckOptions(deckId: bigint): void {
        if (rows.find((r) => r.id === deckId)?.filtered) {
            // overview.py: a filtered deck's options are its filter settings.
            void tools?.run("filteredDeck", deckId);
            return;
        }
        screen = {
            kind: "page",
            title: tr.deckConfigTitle(),
            src: `/deck-options/${deckId}`,
            onClose: () => {
                controller.invalidateConfig();
                void refreshDecks();
            },
        };
    }

    function openAdd(): void {
        if (screen.kind !== "add") {
            screen = { kind: "add" };
        }
    }

    function closePage(): void {
        const onClose = screen.kind === "page" ? screen.onClose : undefined;
        screen = { kind: "overview" };
        onClose?.();
    }

    function closeAdd(): void {
        screen = { kind: "overview" };
        void refreshDecks();
    }

    // Note types: the list screen, and the dialogs the editor's
    // Fields.../Cards... buttons open for the note it is showing.
    function openNotetypes(): void {
        screen = { kind: "notetypes" };
    }

    function openFieldsFor(frame: Window): void {
        const info = editorNoteInfo(frame);
        if (info) {
            notetypeDialogs.openFields(info.notetypeId);
        }
    }

    function openCardsFor(frame: Window): void {
        const info = editorNoteInfo(frame);
        if (info) {
            notetypeDialogs.openCards({
                notetypeId: info.notetypeId,
                noteId: info.id,
                fields: info.fields,
                ord: screen.kind === "review" ? (controller.card?.templateIdx ?? 0) : 0,
                fillEmpty: false,
            });
        }
    }

    function onNotetypeSaved(): void {
        showToast(tr.cardTemplatesChangesSaved());
        notetypesVersion += 1;
    }

    // Browser (ts/lib/desktop/browser): opened from the titlebar, "B", or a
    // page's searchInBrowser call.
    function openBrowser(search: string | null = null): void {
        if (screen.kind === "browse") {
            if (search !== null) {
                void browser?.searchForTerms(search);
            }
            return;
        }
        screen = { kind: "browse", search };
    }

    function closeBrowser(): void {
        screen = { kind: "overview" };
        void refreshDecks();
    }

    // Edit > Undo/Redo from the native menu: the collection-level undo,
    // wherever the user is (Ctrl+Z inside a text field stays text undo).
    async function menuUndo(): Promise<void> {
        try {
            const result = await undo({}, { alertOnError: false });
            showToast(tr.undoUndoAction({ val: result.operation }));
        } catch {
            showToast(tr.actionsNothingToUndo());
            return;
        }
        await controller.refresh();
        await refreshDecks();
    }

    async function menuRedo(): Promise<void> {
        try {
            const result = await redo({}, { alertOnError: false });
            showToast(tr.undoRedoAction({ action: result.operation }));
        } catch {
            showToast(tr.actionsNothingToRedo());
            return;
        }
        await controller.refresh();
        await refreshDecks();
    }

    let uninstallMenu: (() => void) | undefined;

    function installMenu(): void {
        uninstallMenu = installMenuHandlers(
            {
                preferences: () => tools?.run("preferences"),
                sync: () => void sync.sync(),
                switch_profile: () =>
                    showToast("Switching profiles is not available yet"),
                import: () => tools?.run("import"),
                export: () => tools?.run("export"),
                undo: menuUndo,
                redo: menuRedo,
                decks: () => {
                    screen = { kind: "overview" };
                },
                add: openAdd,
                browse: () => openBrowser(),
                stats: () => tools?.run("stats"),
                study_deck: () => tools?.run("studyDeck"),
                create_filtered_deck: () => tools?.run("filteredDeck"),
                note_types: openNotetypes,
                check_database: () => tools?.run("checkDatabase"),
                check_media: () => tools?.run("checkMedia"),
                empty_cards: () => tools?.run("emptyCards"),
                create_backup: () => tools?.run("createBackup"),
                guide: () => void openLink("https://docs.ankiweb.net/"),
                support: () => void openLink("https://faqs.ankiweb.net/"),
            },
            (id) => showToast(`Unhandled menu item: ${id}`),
        );
    }

    async function onCreateDeck(): Promise<void> {
        const name = prompt(tr.decksNewDeckName(), "");
        if (!name?.trim()) {
            return;
        }
        const id = await createDeck(name.trim());
        await onSelectDeck(id);
    }

    async function onRenameDeck(id: bigint): Promise<void> {
        const row = rows.find((r) => r.id === id);
        const name = prompt(tr.decksNewDeckName(), row?.name ?? "");
        if (!name?.trim() || name === row?.name) {
            return;
        }
        await renameDeckTo(id, name.trim());
        await refreshDecks();
    }

    async function onDeleteDeck(id: bigint): Promise<void> {
        const row = rows.find((r) => r.id === id);
        if (!row || !confirm(tr.decksDeleteDeck() + `\n\n${row.name}`)) {
            return;
        }
        const count = await deleteDeck(id);
        showToast(tr.browsingCardsDeleted({ count }));
        if (id === currentDeckId) {
            currentDeckId = await fetchCurrentDeckId();
        }
        await refreshDecks();
    }

    function showToast(message: string | null): void {
        if (!message) {
            return;
        }
        toast = message;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (toast = null), 3000);
    }

    function onUndone(operation: string | null): void {
        showToast(
            operation
                ? tr.undoUndoAction({ val: operation })
                : tr.actionsNothingToUndo(),
        );
        void refreshDecks();
    }

    const globalShortcuts = new ShortcutMap().addAll([
        [
            "d",
            () => {
                screen = { kind: "overview" };
            },
        ],
        ["a", () => openAdd()],
        ...TOOL_SHORTCUTS.map(([spec, id]): [string, () => void] => [
            spec,
            () => void tools?.run(id),
        ]),
        ["y", () => void sync.sync()],
        ["b", () => openBrowser()],
        [
            "s",
            () => {
                if (screen.kind === "overview") {
                    startStudy();
                }
            },
        ],
        [
            "o",
            () => {
                if (screen.kind === "overview") {
                    openDeckOptions(currentDeckId);
                }
            },
        ],
        [
            "Escape",
            () => {
                if (screen.kind === "page") {
                    embedded?.requestClose();
                } else if (screen.kind === "add") {
                    void addEditor?.requestClose();
                }
            },
        ],
    ]);

    function onKeydown(event: KeyboardEvent): void {
        // The browser's shortcuts also apply inside its search box.
        if (screen.kind === "browse" && browser?.handleKey(event)) {
            return;
        }
        if (isTypingTarget(event.target) || tools?.isOpen()) {
            return;
        }
        if (screen.kind === "review" && reviewer?.handleKey(event)) {
            return;
        }
        if (screen.kind !== "review" && globalShortcuts.handle(event)) {
            event.preventDefault();
        }
    }

    let uninstallServices: (() => void) | undefined;
    let offRpcDone: (() => void) | undefined;

    onMount(async () => {
        installFrontendService();
        installRpcDoneHook();
        installMenu();
        uninstallServices = installShellServices({
            notify: showToast,
            askUser: async (text) => confirm(text),
            showMessage: async (text) => alert(text),
            openFieldsDialog: openFieldsFor,
            openCardsDialog: openCardsFor,
            searchInBrowser: (node) => {
                void buildSearchString(node).then((search) => openBrowser(search.val));
            },
        });
        offRpcDone = onRpcDone((method) => {
            if (isOperation(method)) {
                scheduleRefresh();
            }
        });
        applyTheme();
        darkQuery.addEventListener("change", applyTheme);
        window.addEventListener("keydown", onKeydown);
        document.addEventListener("click", (event) => {
            const anchor = (event.target as Element | null)?.closest?.("a[href]");
            const href = anchor?.getAttribute("href") ?? "";
            if (/^https?:/i.test(href)) {
                event.preventDefault();
                void fetch("/_desktop/openLink", { method: "POST", body: href });
            }
        });
        currentDeckId = await fetchCurrentDeckId();
        await refreshDecks();
        // maybe_auto_sync_on_open_close in main.py; the shell has no quit
        // hook yet, so only the open side exists.
        if (!(await sync.autoSync())) {
            void sync.refreshStatus();
        }
    });

    onDestroy(() => {
        uninstallMenu?.();
        darkQuery.removeEventListener("change", applyTheme);
        window.removeEventListener("keydown", onKeydown);
        uninstallServices?.();
        offRpcDone?.();
    });
</script>

<div class="app" class:night-mode={nightMode}>
    <DeckSidebar
        {rows}
        {currentDeckId}
        studiedToday={studied}
        on:select={(e) => onSelectDeck(e.detail)}
        on:toggle={(e) => onToggle(e.detail.id, e.detail.collapsed)}
        on:options={(e) => openDeckOptions(e.detail)}
        on:rename={(e) => onRenameDeck(e.detail)}
        on:delete={(e) => onDeleteDeck(e.detail)}
        on:create={onCreateDeck}
        on:export={(e) => tools?.run("export", e.detail)}
    />

    <main>
        <div class="titlebar" data-tauri-drag-region>
            {#if screen.kind === "page"}
                <button class="back" on:click={() => embedded?.requestClose()}>
                    ‹ {tr.actionsClose()}
                </button>
                <span class="title">{screen.title}</span>
            {:else if screen.kind === "add"}
                <button class="back" on:click={() => addEditor?.requestClose()}>
                    ‹ {tr.actionsClose()}
                </button>
                <span class="title">{tr.actionsAdd()}</span>
            {:else if screen.kind === "notetypes"}
                <button class="back" on:click={() => (screen = { kind: "overview" })}>
                    ‹ {tr.actionsClose()}
                </button>
                <span class="title">{tr.notetypesNoteTypes()}</span>
            {:else if screen.kind === "browse"}
                <button class="back" on:click={() => browser?.requestClose()}>
                    ‹ {tr.actionsClose()}
                </button>
                <span class="title">Browse</span>
            {:else if screen.kind === "review"}
                <button class="back" on:click={onReviewFinished}>
                    ‹ {tr.actionsDecks()}
                </button>
                <span class="title">
                    {rows.find((r) => r.id === currentDeckId)?.name ?? ""}
                </span>
            {:else}
                <span class="title">
                    {rows.find((r) => r.id === currentDeckId)?.name ?? ""}
                </span>
            {/if}
            <span class="spacer"></span>
            {#if screen.kind !== "browse"}
                <button
                    class="tool"
                    title={tr.actionsShortcutKey({ val: "B" })}
                    on:click={() => openBrowser()}
                >
                    Browse
                </button>
            {/if}
            {#if screen.kind !== "add"}
                <button
                    class="tool"
                    title={tr.actionsShortcutKey({ val: "A" })}
                    on:click={openAdd}
                >
                    {tr.actionsAdd()}
                </button>
            {/if}
            <button
                class="tool"
                title={tr.actionsShortcutKey({ val: "T" })}
                on:click={() => tools?.run("stats")}
            >
                {tr.statisticsTitle()}
            </button>
            <ToolsMenu on:action={(e) => tools?.run(e.detail)} />
            <button
                class="tool sync"
                class:normal-sync={$syncStatus ===
                    SyncStatusResponse_Required.NORMAL_SYNC}
                class:full-sync={$syncStatus === SyncStatusResponse_Required.FULL_SYNC}
                title={tr.actionsShortcutKey({ val: "Y" })}
                on:click={() => void sync.sync()}
            >
                {SYNC_TITLE}
                <span class="spinner" class:spin={$syncing} aria-hidden="true">⟳</span>
            </button>
        </div>

        <div class="content">
            {#if screen.kind === "review"}
                <Reviewer
                    bind:this={reviewer}
                    {controller}
                    {nightMode}
                    on:finished={onReviewFinished}
                    on:options={() => openDeckOptions(currentDeckId)}
                    on:undone={(e) => onUndone(e.detail)}
                />
            {:else if screen.kind === "add"}
                <EditorPanel
                    bind:this={addEditor}
                    mode="add"
                    deckId={currentDeckId}
                    {nightMode}
                    on:close={closeAdd}
                />
            {:else if screen.kind === "browse"}
                <BrowserScreen
                    bind:this={browser}
                    initialSearch={screen.search}
                    {nightMode}
                    on:close={closeBrowser}
                    on:undone={(e) => onUndone(e.detail)}
                    on:notify={(e) => showToast(e.detail)}
                />
            {:else if screen.kind === "page"}
                <EmbeddedPage
                    bind:this={embedded}
                    src={screen.src}
                    {nightMode}
                    on:close={closePage}
                />
            {:else if screen.kind === "notetypes"}
                <NotetypesScreen
                    version={notetypesVersion}
                    on:fields={(e) => notetypeDialogs.openFields(e.detail)}
                    on:cards={(e) =>
                        notetypeDialogs.openCards({
                            notetypeId: e.detail,
                            noteId: null,
                            fields: null,
                            ord: 0,
                            fillEmpty: true,
                        })}
                    on:notify={(e) => showToast(e.detail)}
                />
            {:else}
                <Overview
                    deckId={currentDeckId}
                    {tree}
                    version={overviewVersion}
                    on:study={startStudy}
                    on:options={(e) => openDeckOptions(e.detail)}
                    on:changed={refreshDecks}
                    on:customStudy={() => tools?.run("customStudy")}
                    on:add={openAdd}
                    on:import={() => tools?.run("import")}
                />
            {/if}
        </div>

        <ToolHost
            on:noteTypes={openNotetypes}
            bind:this={tools}
            deckId={currentDeckId}
            deckName={rows.find((r) => r.id === currentDeckId)?.name ?? ""}
            on:page={(e) => openPage(e.detail)}
            on:changed={onToolChanged}
            on:select={(e) => onSelectDeck(e.detail)}
            on:notify={(e) => showToast(e.detail)}
        />

        {#if toast}
            <div class="toast">{toast}</div>
        {/if}

        <NotetypeDialogs
            bind:this={notetypeDialogs}
            {nightMode}
            on:saved={onNotetypeSaved}
            on:notify={(e) => showToast(e.detail)}
        />
        <SyncPanel controller={sync} />
    </main>
</div>

<style>
    :global(html, body) {
        height: 100%;
        margin: 0;
        overflow: hidden;
    }
    :global(body) {
        background: var(--canvas);
        color: var(--fg);
        font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 14px;
    }
    .app {
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr);
        height: 100vh;
        background: var(--canvas);
    }
    main {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        position: relative;
    }
    .titlebar {
        height: 38px;
        flex: none;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 16px;
        border-bottom: 1px solid var(--border);
        background: var(--canvas-elevated);
        user-select: none;
    }
    .title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .spacer {
        flex: 1;
    }
    .back {
        font: inherit;
        color: var(--fg-link);
        background: transparent;
        border: 0;
        padding: 2px 4px;
        cursor: pointer;
    }
    .tool {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 3px 10px;
        cursor: pointer;
    }
    .tool:hover {
        border-color: var(--button-hover-border);
    }
    /* Colours as in the Qt toolbar: pending changes, or a full sync ahead. */
    .tool.normal-sync {
        color: var(--state-review);
    }
    .tool.full-sync {
        color: var(--accent-danger);
    }
    .spinner {
        display: inline-block;
        margin-inline-start: 4px;
        opacity: 0.6;
    }
    .spinner.spin {
        animation: spin 1s linear infinite;
        opacity: 1;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
    .content {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }
    .toast {
        position: absolute;
        bottom: 64px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--canvas-overlay);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 6px 12px;
        box-shadow: var(--shadow);
        z-index: 30;
    }
</style>
