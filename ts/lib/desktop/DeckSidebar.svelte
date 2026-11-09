<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The deck list, always visible on the left. Selecting a deck shows its
overview; the disclosure triangle collapses subdecks; the gear opens the
deck's actions. The + button at the top is where new cards come from:
a deck of your own, a deck someone else made, or a file.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    import type { DeckRow } from "./decks";

    export let rows: DeckRow[] = [];
    export let currentDeckId: bigint;
    export let studiedToday = "";

    const dispatch = createEventDispatcher<{
        select: bigint;
        toggle: { id: bigint; collapsed: boolean };
        options: bigint;
        rename: bigint;
        delete: bigint;
        create: void;
        export: bigint;
        shared: void;
        import: void;
    }>();

    let menuFor: bigint | null = null;
    let addOpen = false;

    function addAction(action: "create" | "shared" | "import"): void {
        addOpen = false;
        dispatch(action);
    }

    /** Total cards waiting in a row, for the compact chip on collapsed rows. */
    function due(row: DeckRow): number {
        return row.newCount + row.learnCount + row.reviewCount;
    }
</script>

<nav class="sidebar">
    <div class="drag-strip" data-tauri-drag-region></div>
    <div class="header">
        <span class="title">{tr.actionsDecks()}</span>
        <div class="add-anchor">
            <button
                class="add"
                aria-haspopup="menu"
                aria-expanded={addOpen}
                aria-label="More ways to get decks"
                title="New deck, shared deck or file"
                on:click={() => (addOpen = !addOpen)}
            >
                +
            </button>
            {#if addOpen}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                    class="menu"
                    role="menu"
                    tabindex="-1"
                    on:mouseleave={() => (addOpen = false)}
                    on:click|stopPropagation
                >
                    <button role="menuitem" on:click={() => addAction("create")}>
                        {tr.decksCreateDeck()}
                    </button>
                    <button role="menuitem" on:click={() => addAction("shared")}>
                        Get Shared Decks…
                    </button>
                    <button role="menuitem" on:click={() => addAction("import")}>
                        {tr.decksImportFile()}…
                    </button>
                </div>
            {/if}
        </div>
    </div>
    <div class="rows">
        {#each rows as row (row.id)}
            <div
                class="row"
                class:current={row.id === currentDeckId}
                class:filtered={row.filtered}
                class:quiet={due(row) === 0}
                style="padding-inline-start: {10 + (row.level - 1) * 14}px"
                role="button"
                tabindex="0"
                on:click={() => dispatch("select", row.id)}
                on:keydown={(e) => e.key === "Enter" && dispatch("select", row.id)}
            >
                {#if row.hasChildren}
                    <button
                        class="disclosure"
                        title={row.collapsed
                            ? tr.browsingSidebarExpand()
                            : tr.browsingSidebarCollapse()}
                        on:click|stopPropagation={() =>
                            dispatch("toggle", {
                                id: row.id,
                                collapsed: !row.collapsed,
                            })}
                    >
                        {row.collapsed ? "▸" : "▾"}
                    </button>
                {:else}
                    <span class="disclosure"></span>
                {/if}
                <span class="name" title={row.name}>{row.shortName}</span>
                <span class="counts">
                    <span
                        class="count new"
                        class:zero={!row.newCount}
                        title={tr.actionsNew()}
                    >
                        {row.newCount}
                    </span>
                    <span
                        class="count learn"
                        class:zero={!row.learnCount}
                        title={tr.schedulingLearning()}
                    >
                        {row.learnCount}
                    </span>
                    <span
                        class="count review"
                        class:zero={!row.reviewCount}
                        title={tr.studyingToReview()}
                    >
                        {row.reviewCount}
                    </span>
                </span>
                <span class="gear-col">
                    <button
                        class="gear"
                        title={tr.actionsOptions()}
                        on:click|stopPropagation={() =>
                            (menuFor = menuFor === row.id ? null : row.id)}
                    >
                        ⋯
                    </button>
                    {#if menuFor === row.id}
                        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                        <div
                            class="menu"
                            on:mouseleave={() => (menuFor = null)}
                            on:click|stopPropagation
                        >
                            <button
                                on:click={() => {
                                    menuFor = null;
                                    dispatch("rename", row.id);
                                }}
                            >
                                {tr.actionsRename()}
                            </button>
                            <button
                                on:click={() => {
                                    menuFor = null;
                                    dispatch("options", row.id);
                                }}
                            >
                                {tr.actionsOptions()}
                            </button>
                            <button
                                on:click={() => {
                                    menuFor = null;
                                    dispatch("export", row.id);
                                }}
                            >
                                {tr.actionsExport()}
                            </button>
                            <button
                                class="danger"
                                on:click={() => {
                                    menuFor = null;
                                    dispatch("delete", row.id);
                                }}
                            >
                                {tr.actionsDelete()}
                            </button>
                        </div>
                    {/if}
                </span>
            </div>
        {/each}
    </div>
    <div class="footer">
        <slot name="notice" />
        <button class="get-shared" on:click={() => dispatch("shared")}>
            Get shared decks
        </button>
        {#if studiedToday}
            <div class="studied">{studiedToday}</div>
        {/if}
    </div>
</nav>

<style>
    .sidebar {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--app-sidebar);
        user-select: none;
        font-size: 13px;
    }
    .drag-strip {
        height: 40px;
        flex: none;
    }
    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 12px 8px 16px;
    }
    .header .title {
        font-family: var(--app-font-display);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--fg-subtle);
    }
    .add-anchor {
        position: relative;
    }
    .add {
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        font: inherit;
        font-size: 17px;
        line-height: 1;
        color: var(--fg-subtle);
        background: transparent;
        border: 0;
        border-radius: var(--app-radius-small);
        cursor: pointer;
    }
    .add:hover,
    .add[aria-expanded="true"] {
        background: var(--app-surface);
        color: var(--app-accent);
    }
    .rows {
        flex: 1;
        overflow-y: auto;
        padding: 0 8px 8px;
    }
    .row {
        display: grid;
        grid-template-columns: 16px minmax(0, 1fr) auto 22px;
        align-items: center;
        gap: 4px;
        height: 32px;
        padding-inline-end: 4px;
        border-radius: var(--app-radius);
        cursor: default;
        color: var(--fg);
    }
    .row:hover {
        background: var(--app-surface);
    }
    .row.current {
        background: var(--app-surface);
        box-shadow: var(--app-shadow-card);
    }
    .row.current .name {
        font-weight: 600;
        color: var(--fg);
    }
    .row.filtered .name {
        color: var(--app-accent);
    }
    /* Nothing waiting in this deck today. */
    .row.quiet .name {
        color: var(--fg-subtle);
    }
    .row.quiet.current .name {
        color: var(--fg);
    }
    .disclosure {
        width: 16px;
        text-align: center;
        font-size: 10px;
        color: var(--fg-faint);
        background: transparent;
        border: 0;
        padding: 0;
        font-family: inherit;
        cursor: pointer;
    }
    .name {
        font-family: var(--app-font-display);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .counts {
        display: flex;
        align-items: center;
        gap: 3px;
    }
    .count {
        min-width: 21px;
        padding: 1px 5px;
        border-radius: 999px;
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .count.new {
        color: var(--state-new);
        background: var(--app-new-soft);
    }
    .count.learn {
        color: var(--state-learn);
        background: var(--app-learn-soft);
    }
    .count.review {
        color: var(--state-review);
        background: var(--app-review-soft);
    }
    /* A zero count stays in place so the columns line up, but recedes. */
    .count.zero {
        color: var(--fg-faint);
        background: transparent;
        font-weight: 400;
    }
    .gear-col {
        position: relative;
        text-align: center;
    }
    .gear {
        background: transparent;
        border: 0;
        color: var(--fg-subtle);
        cursor: pointer;
        font: inherit;
        line-height: 1;
        padding: 2px 4px;
        border-radius: var(--app-radius-small);
        opacity: 0;
    }
    .row:hover .gear,
    .row.current .gear {
        opacity: 1;
    }
    .gear:hover {
        background: var(--app-surface-sunken);
        color: var(--fg);
    }
    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        min-width: 160px;
        background: var(--app-surface);
        color: var(--fg);
        border: 1px solid var(--app-line);
        border-radius: var(--app-radius);
        box-shadow: var(--app-shadow-pop);
        padding: 6px;
        display: flex;
        flex-direction: column;
        z-index: 20;
    }
    .menu button {
        text-align: start;
        background: transparent;
        border: 0;
        font: inherit;
        color: inherit;
        padding: 7px 10px;
        border-radius: var(--app-radius-small);
        cursor: pointer;
        white-space: nowrap;
    }
    .menu button:hover {
        background: var(--app-accent-soft);
    }
    .menu button.danger:hover {
        color: var(--accent-danger);
    }
    .footer {
        padding: 10px 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .get-shared {
        display: flex;
        align-items: center;
        gap: 8px;
        font: inherit;
        font-size: 13px;
        color: var(--fg-subtle);
        background: transparent;
        border: 0;
        border-radius: var(--app-radius);
        padding: 7px 10px;
        cursor: pointer;
        text-align: start;
    }
    .get-shared:hover {
        background: var(--app-surface);
        color: var(--fg);
    }
    .studied {
        font-size: 11px;
        color: var(--fg-faint);
        padding-inline-start: 10px;
    }
</style>
