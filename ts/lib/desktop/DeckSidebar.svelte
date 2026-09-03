<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The deck list, always visible on the left. Selecting a deck shows its
overview; the disclosure triangle collapses subdecks; the gear opens the
deck's actions.
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
    }>();

    let menuFor: bigint | null = null;
</script>

<nav class="sidebar">
    <div class="drag-strip" data-tauri-drag-region></div>
    <div class="header">
        <span class="title">{tr.decksDeck()}</span>
        <span class="col">{tr.actionsNew()}</span>
        <span class="col">{tr.decksLearnHeader()}</span>
        <span class="col">{tr.decksReviewHeader()}</span>
        <span class="gear-col"></span>
    </div>
    <div class="rows">
        {#each rows as row (row.id)}
            <div
                class="row"
                class:current={row.id === currentDeckId}
                class:filtered={row.filtered}
                style="padding-inline-start: {8 + (row.level - 1) * 16}px"
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
                <span class="count new" class:zero={!row.newCount}>{row.newCount}</span>
                <span class="count learn" class:zero={!row.learnCount}>
                    {row.learnCount}
                </span>
                <span class="count review" class:zero={!row.reviewCount}>
                    {row.reviewCount}
                </span>
                <span class="gear-col">
                    <button
                        class="gear"
                        title={tr.actionsOptions()}
                        on:click|stopPropagation={() =>
                            (menuFor = menuFor === row.id ? null : row.id)}
                    >
                        ⚙
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
        <button class="create" on:click={() => dispatch("create")}>
            {tr.decksCreateDeck()}
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
        background: var(--canvas-inset);
        border-inline-end: 1px solid var(--border);
        user-select: none;
        font-size: 13px;
    }
    .drag-strip {
        height: 38px;
        flex: none;
    }
    .header,
    .row {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) 36px 36px 36px 28px;
        align-items: center;
        gap: 2px;
    }
    .header {
        padding: 4px 8px;
        color: var(--fg-subtle);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .header .title {
        grid-column: 1 / 3;
    }
    .header .col {
        text-align: end;
    }
    .rows {
        flex: 1;
        overflow-y: auto;
        padding: 2px 0;
    }
    .row {
        padding: 5px 8px;
        border-radius: var(--border-radius);
        margin: 0 6px;
        cursor: default;
        color: var(--fg);
    }
    .row:hover {
        background: var(--canvas-elevated);
    }
    .row.current {
        background: var(--selected-bg);
        color: var(--selected-fg);
    }
    .row.filtered .name {
        color: var(--fg-link);
    }
    .row.current .name {
        color: inherit;
    }
    .disclosure {
        width: 18px;
        text-align: center;
        color: var(--fg-subtle);
        background: transparent;
        border: 0;
        padding: 0;
        font: inherit;
        cursor: pointer;
    }
    .name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .count {
        text-align: end;
        font-variant-numeric: tabular-nums;
    }
    .count.new {
        color: var(--state-new);
    }
    .count.learn {
        color: var(--state-learn);
    }
    .count.review {
        color: var(--state-review);
    }
    .count.zero {
        color: var(--fg-faint);
    }
    .row.current .count {
        color: inherit;
        opacity: 0.9;
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
        padding: 0 4px;
        opacity: 0;
    }
    .row:hover .gear,
    .row.current .gear {
        opacity: 1;
    }
    .menu {
        position: absolute;
        right: 0;
        top: 100%;
        min-width: 140px;
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow);
        padding: 4px;
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
        padding: 6px 10px;
        cursor: pointer;
    }
    .menu button:hover {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .footer {
        padding: 8px;
        border-top: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .create {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 5px 10px;
        cursor: pointer;
    }
    .studied {
        font-size: 11px;
        color: var(--fg-subtle);
    }
</style>
