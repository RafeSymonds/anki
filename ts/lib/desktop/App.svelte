<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The desktop app shell: deck list on the left, and on the right whichever of
the overview, the study screen, the add-note editor or an embedded page is
active.
-->
<script lang="ts">
    import type { DeckTreeNode } from "@generated/anki/decks_pb";
    import { studiedToday } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { onDestroy, onMount } from "svelte";

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
    import EditorPanel from "./EditorPanel.svelte";
    import EmbeddedPage from "./EmbeddedPage.svelte";
    import { installFrontendService } from "./frontend-service";
    import Overview from "./Overview.svelte";
    import Reviewer from "./Reviewer.svelte";
    import { ReviewerController } from "./reviewer";
    import { installRpcDoneHook, isOperation, onRpcDone } from "./rpc-events";
    import { installShellServices } from "./shell-services";
    import { isTypingTarget, ShortcutMap } from "./shortcuts";

    type Screen =
        | { kind: "overview" }
        | { kind: "review" }
        | { kind: "add" }
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
    let toast: string | null = null;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new ReviewerController();

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

    function openDeckOptions(deckId: bigint): void {
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
        if (isTypingTarget(event.target)) {
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
        uninstallServices = installShellServices({
            notify: showToast,
            askUser: async (text) => confirm(text),
            showMessage: async (text) => alert(text),
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
    });

    onDestroy(() => {
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
            {#if screen.kind !== "add"}
                <button
                    class="tool"
                    title={tr.actionsShortcutKey({ val: "A" })}
                    on:click={openAdd}
                >
                    {tr.actionsAdd()}
                </button>
            {/if}
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
            {:else if screen.kind === "page"}
                <EmbeddedPage
                    bind:this={embedded}
                    src={screen.src}
                    {nightMode}
                    on:close={closePage}
                />
            {:else}
                <Overview
                    deckId={currentDeckId}
                    {tree}
                    version={overviewVersion}
                    on:study={startStudy}
                    on:options={(e) => openDeckOptions(e.detail)}
                    on:changed={refreshDecks}
                />
            {/if}
        </div>

        {#if toast}
            <div class="toast">{toast}</div>
        {/if}
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
