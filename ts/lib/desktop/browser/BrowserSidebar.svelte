<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The browser's sidebar: Today, Card State, Flags, Decks, Note Types and Tags,
each item a search. A click replaces the search; Ctrl adds to it, Shift
ors with it, Alt negates it, as in qt/aqt/browser/sidebar/tree.py.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    import type { SidebarItem, SidebarModifiers } from "./search";
    import { filterSidebar, flattenSidebar, SAVED_SEARCHES_ID } from "./search";

    export let items: SidebarItem[] = [];

    const dispatch = createEventDispatcher<{
        search: { item: SidebarItem; mods: SidebarModifiers };
        saveSearch: void;
        renameSearch: { name: string };
        deleteSearch: { name: string };
    }>();

    let filter = "";
    let collapsed = new Set<string>();
    let searchInput: HTMLInputElement;

    $: rows = flattenSidebar(
        filterSidebar(items, filter),
        filter ? new Set() : collapsed,
    );

    function toggle(id: string): void {
        const next = new Set(collapsed);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        collapsed = next;
    }

    type ModifierEvent = Pick<
        MouseEvent,
        "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
    >;

    function onClick(item: SidebarItem, event: ModifierEvent): void {
        if (!item.node) {
            toggle(item.id);
            return;
        }
        dispatch("search", {
            item,
            mods: {
                ctrl: event.ctrlKey || event.metaKey,
                shift: event.shiftKey,
                alt: event.altKey,
            },
        });
    }

    export function focusFilter(): void {
        searchInput?.focus();
        searchInput?.select();
    }
</script>

<nav class="browser-sidebar">
    <input
        bind:this={searchInput}
        class="filter"
        type="search"
        placeholder={tr.browsingSidebarFilter()}
        bind:value={filter}
    />
    <div class="rows">
        {#each rows as row (row.item.id)}
            <div
                class="row"
                class:section={row.level === 0}
                style="padding-inline-start: {8 + row.level * 14}px"
                role="button"
                tabindex="0"
                title={row.item.name}
                on:click={(e) => onClick(row.item, e)}
                on:keydown={(e) => e.key === "Enter" && onClick(row.item, e)}
            >
                {#if row.item.children.length}
                    <button
                        class="disclosure"
                        tabindex="-1"
                        title={row.expanded
                            ? tr.browsingSidebarCollapse()
                            : tr.browsingSidebarExpand()}
                        on:click|stopPropagation={() => toggle(row.item.id)}
                    >
                        {row.expanded ? "▾" : "▸"}
                    </button>
                {:else}
                    <span class="disclosure"></span>
                {/if}
                {#if row.item.color}
                    <span class="dot" style="background: var({row.item.color})"></span>
                {/if}
                <span class="name">{row.item.name}</span>
                {#if row.item.id === SAVED_SEARCHES_ID}
                    <button
                        class="action"
                        title={tr.browsingSidebarSaveCurrentSearch()}
                        aria-label={tr.browsingSidebarSaveCurrentSearch()}
                        on:click|stopPropagation={() => dispatch("saveSearch")}
                    >
                        +
                    </button>
                {:else if row.item.kind === "savedSearch"}
                    <span class="actions">
                        <button
                            class="action"
                            title={tr.actionsRename()}
                            aria-label="{tr.actionsRename()} {row.item.name}"
                            on:click|stopPropagation={() =>
                                dispatch("renameSearch", { name: row.item.name })}
                        >
                            ✎
                        </button>
                        <button
                            class="action"
                            title={tr.actionsDelete()}
                            aria-label="{tr.actionsDelete()} {row.item.name}"
                            on:click|stopPropagation={() =>
                                dispatch("deleteSearch", { name: row.item.name })}
                        >
                            ×
                        </button>
                    </span>
                {/if}
            </div>
        {/each}
    </div>
</nav>

<style>
    .browser-sidebar {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: transparent;
        user-select: none;
        font-size: 13px;
    }
    .filter {
        margin: 10px 4px 6px;
        font: inherit;
        color: var(--fg);
        background: var(--app-surface);
        border: 1px solid transparent;
        border-radius: var(--app-radius);
        padding: 6px 10px;
    }
    .filter:focus {
        outline: none;
        border-color: var(--app-accent);
    }
    .rows {
        flex: 1;
        overflow-y: auto;
        padding-bottom: 8px;
    }
    .action {
        margin-inline-start: auto;
        font: inherit;
        line-height: 1;
        color: var(--fg-subtle);
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--border-radius);
        padding: 0 5px;
        cursor: pointer;
    }
    .action:hover {
        color: var(--fg);
        border-color: var(--border);
        background: var(--canvas-elevated);
    }
    .actions {
        margin-inline-start: auto;
        display: none;
    }
    .actions .action {
        margin-inline-start: 0;
    }
    .row:hover .actions,
    .row:focus-within .actions {
        display: inline-flex;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 4px;
        padding: 5px 8px;
        border-radius: var(--app-radius-small);
        color: var(--fg);
        cursor: default;
        white-space: nowrap;
    }
    .row.section {
        margin-top: 10px;
        font-weight: 600;
        color: var(--fg-subtle);
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.04em;
    }
    .row:hover {
        background: var(--app-surface);
    }
    .disclosure {
        width: 16px;
        flex: none;
        text-align: center;
        color: var(--fg-subtle);
        background: transparent;
        border: 0;
        padding: 0;
        font: inherit;
        cursor: pointer;
    }
    .dot {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex: none;
    }
    .name {
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
