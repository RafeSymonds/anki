<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The virtualised card/note table. Rows are the ids the search returned;
their cells come from browserRowForId as they scroll into view, through the
controller's cache. Header clicks sort, a right-click on the header shows
the column list, a right-click on a row asks the screen for the actions menu.
-->
<script lang="ts">
    import { BrowserColumns_Alignment } from "@generated/anki/search_pb";
    import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";

    import type { BrowserController } from "./browser";
    import {
        columnLabel,
        columnTemplate,
        columnTooltip,
        columnWidth,
        defaultColumnWidth,
        elideClass,
        resizedWidth,
        rowColorName,
        rowColorVariable,
    } from "./columns";
    import { clickRow } from "./selection";

    export let controller: BrowserController;
    export let rowHeight = 26;

    const dispatch = createEventDispatcher<{ contextmenu: { x: number; y: number } }>();

    const items = controller.items;
    const selection = controller.selection;
    const columns = controller.columns;
    const activeColumns = controller.activeColumns;
    const sort = controller.sort;
    const rowsVersion = controller.rowsVersion;
    const notesMode = controller.notesMode;

    let container: HTMLDivElement;
    let scrollTop = 0;
    let viewportHeight = 0;
    let observer: ResizeObserver | undefined;
    let columnMenu: { x: number; y: number } | null = null;

    $: columnByKey = new Map($columns.map((c) => [c.key, c]));
    $: active = $activeColumns.map((key) => ({
        key,
        column: columnByKey.get(key) ?? null,
    }));
    const columnWidths = controller.columnWidths;
    $: template = columnTemplate(
        active.map(({ key }) => key),
        $columnWidths,
    );

    // Dragging the handle at a header's end resizes that column; the width
    // is stored when the pointer is released.
    let resizing: {
        key: string;
        startX: number;
        startWidth: number;
        width: number;
    } | null = null;
    function startResize(event: PointerEvent, key: string): void {
        event.stopPropagation();
        event.preventDefault();
        const startWidth = columnWidth(key, $columnWidths);
        resizing = { key, startX: event.clientX, startWidth, width: startWidth };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    function moveResize(event: PointerEvent): void {
        if (!resizing) {
            return;
        }
        resizing.width = resizedWidth(
            resizing.startWidth,
            event.clientX - resizing.startX,
        );
        columnWidths.update((widths) => ({
            ...widths,
            [resizing!.key]: resizing!.width,
        }));
    }
    /** Arrow keys on a focused handle resize by 10px. */
    function nudgeResize(event: KeyboardEvent, key: string): void {
        let delta = 0;
        if (event.key === "ArrowRight") {
            delta = 10;
        } else if (event.key === "ArrowLeft") {
            delta = -10;
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        void controller.setColumnWidth(
            key,
            resizedWidth(columnWidth(key, $columnWidths), delta),
        );
    }
    function endResize(): void {
        if (!resizing) {
            return;
        }
        void controller.setColumnWidth(resizing.key, resizing.width);
        resizing = null;
    }

    $: count = $items.length;
    $: overscan = 8;
    $: start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    $: end = Math.min(
        count,
        Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
    );
    $: visible = $items.slice(start, end).map((id, i) => ({ id, index: start + i }));
    // Re-read the cache whenever it changes.
    $: rows = readRows(visible, $rowsVersion);

    function readRows(slice: { id: bigint }[], _version: number) {
        return slice.map(({ id }) => controller.row(id));
    }

    function onScroll(): void {
        scrollTop = container.scrollTop;
    }

    function onRowClick(index: number, event: MouseEvent): void {
        controller.clickRow(
            clickRow($selection, index, {
                shift: event.shiftKey,
                ctrl: event.ctrlKey || event.metaKey,
            }),
        );
        container.focus();
    }

    function onRowContextMenu(index: number, event: MouseEvent): void {
        event.preventDefault();
        if (!$selection.selected.has(index)) {
            controller.clickRow(clickRow($selection, index));
        }
        dispatch("contextmenu", { x: event.clientX, y: event.clientY });
    }

    function onHeaderContextMenu(event: MouseEvent): void {
        event.preventDefault();
        columnMenu = { x: event.clientX, y: event.clientY };
    }

    /** Scroll so `index` is visible (`Table._scroll_to_row`). */
    export async function scrollToRow(index: number): Promise<void> {
        await tick();
        if (!container) {
            return;
        }
        const top = index * rowHeight;
        const header = rowHeight;
        if (top < container.scrollTop) {
            container.scrollTop = top;
        } else if (
            top + rowHeight >
            container.scrollTop + container.clientHeight - header
        ) {
            container.scrollTop = top + rowHeight + header - container.clientHeight;
        }
    }

    export function focus(): void {
        container?.focus();
    }

    let lastCurrent: number | null = null;
    $: if ($selection.current !== lastCurrent) {
        lastCurrent = $selection.current;
        if (lastCurrent !== null) {
            void scrollToRow(lastCurrent);
        }
    }

    onMount(() => {
        viewportHeight = container.clientHeight;
        observer = new ResizeObserver(() => {
            viewportHeight = container.clientHeight;
        });
        observer.observe(container);
    });

    onDestroy(() => observer?.disconnect());
</script>

<div
    class="table"
    role="grid"
    tabindex="0"
    bind:this={container}
    on:scroll={onScroll}
    aria-rowcount={count}
    data-mode={$notesMode ? "notes" : "cards"}
>
    <div
        class="header"
        role="row"
        style="grid-template-columns: {template}; height: {rowHeight}px"
    >
        {#each active as { key, column } (key)}
            <!-- The handle is a sibling of the button, not a child: WebKit
                 does not make a <button> the containing block for it. -->
            <div class="head-cell">
                <button
                    class="head"
                    role="columnheader"
                    class:sorted={$sort.column === key}
                    title={column ? columnTooltip(column, $notesMode) : key}
                    on:click={() => column && controller.sortBy(column)}
                    on:contextmenu={onHeaderContextMenu}
                >
                    <span class="label">
                        {column ? columnLabel(column, $notesMode) : key}
                    </span>
                    {#if $sort.column === key}
                        <span class="arrow">{$sort.reverse ? "▼" : "▲"}</span>
                    {/if}
                </button>
                <!-- A focusable separator is the ARIA pattern for a resize handle. -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <span
                    class="resizer"
                    class:active={resizing?.key === key}
                    data-resize={key}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize column"
                    aria-valuenow={columnWidth(key, $columnWidths)}
                    tabindex="-1"
                    on:pointerdown={(e) => startResize(e, key)}
                    on:pointermove={moveResize}
                    on:pointerup={endResize}
                    on:pointercancel={endResize}
                    on:click|stopPropagation
                    on:keydown={(e) => nudgeResize(e, key)}
                    on:dblclick|stopPropagation={() =>
                        void controller.setColumnWidth(key, defaultColumnWidth(key))}
                ></span>
            </div>
        {/each}
    </div>
    <div class="body" style="height: {count * rowHeight}px">
        {#each visible as { id, index }, i (id)}
            {@const row = rows[i]}
            {@const color = row ? rowColorVariable(row.color) : null}
            <!-- Keyboard handling lives on the focusable table container. -->
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus -->
            <div
                class="row"
                role="row"
                aria-rowindex={index + 1}
                aria-selected={$selection.selected.has(index)}
                class:selected={$selection.selected.has(index)}
                class:current={$selection.current === index}
                class:disabled={row?.disabled}
                data-id={id.toString()}
                data-color={row ? rowColorName(row.color) : "loading"}
                style="top: {index *
                    rowHeight}px; height: {rowHeight}px; grid-template-columns: {template}; {color
                    ? `--row-color: var(${color})`
                    : ''}"
                on:click={(e) => onRowClick(index, e)}
                on:contextmenu={(e) => onRowContextMenu(index, e)}
            >
                {#each active as { key, column }, c (key)}
                    {@const cell = row?.cells[c]}
                    <span
                        class="cell {cell ? elideClass(cell.elideMode) : ''}"
                        class:center={column?.alignment ===
                            BrowserColumns_Alignment.CENTER}
                        role="gridcell"
                        dir={cell?.isRtl ? "rtl" : "ltr"}
                        style={row && column?.usesCellFont
                            ? `font-family: ${row.fontName}; font-size: ${row.fontSize}px`
                            : ""}
                        title={cell?.text ?? ""}
                    >
                        {cell?.text ?? "…"}
                    </span>
                {/each}
            </div>
        {/each}
    </div>
</div>

{#if columnMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
        class="menu-backdrop"
        on:click={() => (columnMenu = null)}
        on:contextmenu|preventDefault={() => (columnMenu = null)}
    >
        <div class="column-menu" style="left: {columnMenu.x}px; top: {columnMenu.y}px">
            {#each $columns as column (column.key)}
                <button
                    on:click|stopPropagation={() => {
                        void controller.toggleColumn(column.key);
                    }}
                    title={columnTooltip(column, $notesMode)}
                >
                    <span class="check">
                        {$activeColumns.includes(column.key) ? "✓" : ""}
                    </span>
                    {columnLabel(column, $notesMode)}
                </button>
            {/each}
        </div>
    </div>
{/if}

<style>
    .table {
        position: relative;
        height: 100%;
        min-height: 0;
        overflow: auto;
        background: var(--canvas-elevated);
        outline: none;
        font-size: 13px;
        user-select: none;
    }
    .table:focus-visible {
        box-shadow: inset 0 0 0 1px var(--border-focus);
    }
    .header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: grid;
        min-width: 100%;
        width: max-content;
        background: var(--canvas);
        border-bottom: 1px solid var(--border);
    }
    .head {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        padding: 0 8px;
        font: inherit;
        font-weight: 600;
        color: var(--fg);
        background: transparent;
        border: 0;
        border-inline-end: 1px solid var(--border-subtle);
        text-align: start;
        cursor: pointer;
        overflow: hidden;
    }
    .head:hover {
        background: var(--canvas-inset);
    }
    .head .label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .head .arrow {
        font-size: 9px;
        color: var(--fg-subtle);
    }
    .head-cell {
        position: relative;
        display: flex;
        min-width: 0;
        overflow: hidden;
    }
    .head-cell .head {
        flex: 1;
        min-width: 0;
    }
    .resizer {
        position: absolute;
        top: 0;
        bottom: 0;
        inset-inline-end: 0;
        width: 7px;
        cursor: col-resize;
        touch-action: none;
    }
    .resizer:hover,
    .resizer.active {
        background: var(--border-strong);
        opacity: 0.6;
    }
    .body {
        position: relative;
        min-width: 100%;
        width: max-content;
    }
    .row {
        position: absolute;
        left: 0;
        right: 0;
        display: grid;
        align-items: center;
        min-width: 100%;
        width: max-content;
        color: var(--fg);
        background: var(--row-color, transparent);
        border-bottom: 1px solid var(--border-subtle);
        cursor: default;
    }
    .row[style*="--row-color"] {
        background: color-mix(in srgb, var(--row-color) 35%, var(--canvas-elevated));
    }
    .row:hover {
        filter: brightness(0.96);
    }
    .row.selected {
        background: var(--selected-bg);
        color: var(--selected-fg);
    }
    .row.selected[style*="--row-color"] {
        background: color-mix(in srgb, var(--row-color) 45%, var(--selected-bg));
    }
    .row.current {
        box-shadow: inset 0 0 0 1px var(--border-strong);
    }
    .row.disabled {
        color: var(--fg-disabled);
    }
    .cell {
        min-width: 0;
        padding: 0 8px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        border-inline-end: 1px solid var(--border-subtle);
    }
    .cell.center {
        text-align: center;
    }
    .cell.elide-left {
        direction: rtl;
        text-align: start;
    }
    .cell.elide-none {
        text-overflow: clip;
    }
    .menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 30;
    }
    .column-menu {
        position: fixed;
        display: flex;
        flex-direction: column;
        min-width: 200px;
        max-height: 70vh;
        overflow-y: auto;
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow);
        padding: 4px;
    }
    .column-menu button {
        display: flex;
        gap: 8px;
        align-items: center;
        text-align: start;
        font: inherit;
        color: inherit;
        background: transparent;
        border: 0;
        padding: 5px 10px;
        cursor: pointer;
    }
    .column-menu button:hover {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .check {
        display: inline-block;
        width: 14px;
    }
</style>
