<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Manage Note Types (qt/aqt/models.py): the note types with their note
counts, and Add, Rename, Delete, Fields and Cards. Adding copies a stock
note type or clones an existing one through the legacy JSON form, as
add_notetype_legacy does.
-->
<script lang="ts">
    import type {
        NotetypeNameIdUseCount,
        StockNotetype_Kind,
    } from "@generated/anki/notetypes_pb";
    import {
        addNotetypeLegacy,
        getNotetype,
        getNotetypeLegacy,
        getNotetypeNamesAndCounts,
        getStockNotetypeLegacy,
        removeNotetype,
        updateNotetype,
    } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    import ChooserDialog from "./ChooserDialog.svelte";
    import { cloneNotetypeJson, ensureNameUnique, stockNotetypes } from "./notetypes";

    /** Bumped by the parent after a dialog saved, to refresh the counts. */
    export let version = 0;

    const dispatch = createEventDispatcher<{
        fields: bigint;
        cards: bigint;
        notify: string;
        options: bigint;
    }>();

    type Source = { kind: StockNotetype_Kind } | { cloneId: bigint };

    let rows: NotetypeNameIdUseCount[] = [];
    let selectedId: bigint | null = null;
    let chooser: { items: string[]; sources: Source[] } | null = null;

    $: selected = rows.find((row) => row.id === selectedId) ?? null;

    async function refresh(select: bigint | null = selectedId): Promise<void> {
        rows = (await getNotetypeNamesAndCounts({})).entries;
        selectedId = rows.some((row) => row.id === select)
            ? select
            : (rows[0]?.id ?? null);
    }

    $: (version, void refresh());

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    function decodeJson(bytes: Uint8Array): Record<string, unknown> {
        return JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
    }

    /** `AddModel`: the stock note types, then clones of the existing ones. */
    function onAdd(): void {
        const items: string[] = [];
        const sources: Source[] = [];
        for (const stock of stockNotetypes()) {
            items.push(tr.notetypesAdd({ val: stock.name }));
            sources.push({ kind: stock.kind });
        }
        for (const row of [...rows].sort((a, b) => a.name.localeCompare(b.name))) {
            items.push(tr.notetypesClone({ val: row.name }));
            sources.push({ cloneId: row.id });
        }
        chooser = { items, sources };
    }

    async function onChosen(index: number): Promise<void> {
        const source = chooser?.sources[index];
        chooser = null;
        if (!source) {
            return;
        }
        let json: Record<string, unknown>;
        if ("kind" in source) {
            json = decodeJson(
                (await getStockNotetypeLegacy({ kind: source.kind })).json,
            );
        } else {
            json = cloneNotetypeJson(
                decodeJson((await getNotetypeLegacy({ ntid: source.cloneId })).json),
            );
        }
        const text = prompt(tr.actionsName(), String(json.name ?? ""));
        if (!text?.trim()) {
            return;
        }
        json.name = ensureNameUnique(text, rows, 0n);
        const added = await addNotetypeLegacy({
            json: encoder.encode(JSON.stringify(json)),
        });
        await refresh(added.id);
    }

    async function onRename(): Promise<void> {
        if (!selected) {
            return;
        }
        const notetype = await getNotetype({ ntid: selected.id });
        const text = prompt(tr.actionsNewName(), notetype.name);
        if (!text?.trim()) {
            return;
        }
        notetype.name = ensureNameUnique(text, rows, notetype.id);
        await updateNotetype(notetype);
        await refresh(notetype.id);
    }

    async function onDelete(): Promise<void> {
        if (!selected) {
            return;
        }
        if (rows.length < 2) {
            alert(tr.notetypesPleaseAddAnotherNoteTypeFirst());
            return;
        }
        const message = selected.useCount
            ? tr.notetypesDeleteThisNoteTypeAndAll()
            : tr.notetypesDeleteThisUnusedNoteType();
        if (!confirm(message)) {
            return;
        }
        await removeNotetype({ ntid: selected.id });
        await refresh(null);
    }
</script>

<div class="notetypes">
    <div class="list" role="listbox" aria-label={tr.notetypesNoteTypes()}>
        {#each rows as row (row.id)}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
                class="row"
                class:selected={row.id === selectedId}
                role="option"
                tabindex="-1"
                aria-selected={row.id === selectedId}
                on:click={() => (selectedId = row.id)}
                on:dblclick={onRename}
            >
                <span class="name">{row.name}</span>
                <span class="count">
                    [{tr.browsingNoteCount({ count: row.useCount })}]
                </span>
            </div>
        {/each}
    </div>
    <div class="buttons">
        <button on:click={onAdd}>{tr.actionsAdd()}</button>
        <button disabled={!selected} on:click={onRename}>{tr.actionsRename()}</button>
        <button disabled={!selected} on:click={onDelete}>{tr.actionsDelete()}</button>
        <div class="gap"></div>
        <button
            disabled={!selected}
            on:click={() => selected && dispatch("fields", selected.id)}
        >
            {tr.notetypesFields()}
        </button>
        <button
            disabled={!selected}
            on:click={() => selected && dispatch("cards", selected.id)}
        >
            {tr.notetypesCards()}
        </button>
        <button
            disabled={!selected}
            on:click={() => selected && dispatch("options", selected.id)}
        >
            {tr.notetypesOptions()}
        </button>
    </div>
</div>

{#if chooser}
    <ChooserDialog
        title={tr.notetypesAddNoteType()}
        items={chooser.items}
        on:choose={(e) => onChosen(e.detail)}
        on:cancel={() => (chooser = null)}
    />
{/if}

<style>
    .notetypes {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 16px;
        padding: 0 24px 24px;
        height: 100%;
        box-sizing: border-box;
    }
    .list {
        overflow: auto;
        border-radius: var(--app-radius-large);
        background: var(--app-surface);
        box-shadow: var(--app-shadow-card);
        padding: 8px;
    }
    .row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 8px 12px;
        border-radius: var(--app-radius-small);
        cursor: default;
        user-select: none;
    }
    .row:hover {
        background: var(--app-surface-sunken);
    }
    .row.selected {
        background: var(--app-accent-soft);
        color: var(--fg);
        font-weight: 600;
    }
    .row .count {
        color: var(--fg-subtle);
    }
    .row.selected .count {
        color: inherit;
    }
    .buttons {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 120px;
    }
    .gap {
        height: 8px;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--app-surface);
        border: 1px solid transparent;
        border-radius: var(--app-radius);
        padding: 7px 14px;
        cursor: pointer;
        box-shadow: var(--app-shadow-card);
    }
    button:hover:enabled {
        border-color: var(--button-hover-border);
    }
    button:disabled {
        color: var(--fg-disabled);
        cursor: default;
    }
</style>
