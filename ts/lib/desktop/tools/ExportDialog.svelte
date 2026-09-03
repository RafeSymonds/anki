<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The export dialog (qt/aqt/import_export/exporting.py): pick a format, a
deck and the options, then a native save dialog chooses the file.
-->
<script lang="ts">
    import { getDeckNames } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    import { pickSavePath, reopenCollection } from "../desktop-api";
    import type { ExportFormat, ExportOptions } from "./export";
    import {
        defaultFilename,
        defaultFormat,
        defaultOptions,
        exportCall,
        exportFormats,
        formatInfo,
        optionLabel,
        runExport,
    } from "./export";
    import Modal from "./Modal.svelte";

    /** Preselects this deck and the deck package format (a deck's Export entry). */
    export let deckId: bigint | null = null;

    const dispatch = createEventDispatcher<{
        close: void;
        notify: string;
        changed: void;
    }>();

    const formats = exportFormats();
    let format: ExportFormat = defaultFormat(deckId);
    let options: ExportOptions = defaultOptions(deckId);
    let decks: { id: bigint; name: string }[] = [];
    /** 0n is "All Decks". */
    let selectedDeck: bigint = deckId ?? 0n;
    let busy = false;

    $: info = formatInfo(format);
    $: deckLabel = info.deckList
        ? (decks.find((d) => d.id === selectedDeck)?.name ?? tr.exportingAllDecks())
        : "";

    async function accept(): Promise<void> {
        const outPath = await pickSavePath({
            title: tr.actionsExport(),
            filterDescription: info.label,
            extensions: [info.extension],
            defaultName: defaultFilename(format, deckLabel),
        });
        if (!outPath) {
            return;
        }
        busy = true;
        const limitDeck = info.deckList && selectedDeck ? selectedDeck : null;
        try {
            const message = await runExport(
                exportCall(format, options, outPath, limitDeck),
            );
            dispatch("notify", message);
            dispatch("close");
        } catch {
            // postProto has shown the error.
        } finally {
            if (format === "colpkg") {
                // Exporting a collection package closes the collection (mw.reopen()).
                await reopenCollection();
                dispatch("changed");
            }
            busy = false;
        }
    }

    onMount(async () => {
        const response = await getDeckNames({
            skipEmptyDefault: false,
            includeFiltered: true,
        });
        decks = response.entries.map((d) => ({ id: d.id, name: d.name }));
    });
</script>

<Modal title={tr.actionsExport()} on:close>
    <div class="form">
        <label class="row">
            <span class="key">{@html tr.exportingExportFormat()}</span>
            <select class="grow" bind:value={format}>
                {#each formats as f (f.id)}
                    <option value={f.id}>{f.label} (.{f.extension})</option>
                {/each}
            </select>
        </label>
        {#if info.deckList}
            <label class="row">
                <span class="key">{@html tr.exportingInclude()}</span>
                <select class="grow" bind:value={selectedDeck}>
                    <option value={0n}>{tr.exportingAllDecks()}</option>
                    {#each decks as deck (deck.id)}
                        <option value={deck.id}>{deck.name}</option>
                    {/each}
                </select>
            </label>
        {/if}
        <div class="options">
            {#each info.options as key (key)}
                <label>
                    <input type="checkbox" bind:checked={options[key]} />
                    {optionLabel(key)}
                </label>
            {/each}
        </div>
    </div>
    <svelte:fragment slot="footer">
        <button on:click={() => dispatch("close")}>{tr.actionsCancel()}</button>
        <button class="primary" disabled={busy} on:click={accept}>
            {tr.exportingExport()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .form {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .key {
        min-width: 110px;
    }
    .grow {
        flex: 1;
    }
    .options {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
</style>
