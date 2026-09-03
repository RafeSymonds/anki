<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

A note type's Options (qt/aqt/models.py onAdvanced): the LaTeX header and
footer wrapped around [latex] blocks, and whether to render them as SVG.
-->
<script lang="ts">
    import type { Notetype } from "@generated/anki/notetypes_pb";
    import { getNotetype, updateNotetype } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { withoutUnicodeIsolation } from "@tslib/i18n";
    import { createEventDispatcher, onMount } from "svelte";

    import Modal from "./Modal.svelte";
    import { latexOptions, setLatexOptions } from "./notetypes";

    export let notetypeId: bigint;

    const dispatch = createEventDispatcher<{ close: void; saved: void }>();

    let notetype: Notetype | null = null;
    let header = "";
    let footer = "";
    let svg = false;
    let saving = false;

    $: title = notetype
        ? withoutUnicodeIsolation(tr.actionsOptionsFor({ val: notetype.name }))
        : "";

    onMount(async () => {
        const loaded = await getNotetype({ ntid: notetypeId });
        ({ header, footer, svg } = latexOptions(loaded));
        notetype = loaded;
    });

    async function save(): Promise<void> {
        if (!notetype || saving) {
            return;
        }
        saving = true;
        try {
            if (setLatexOptions(notetype, { header, footer, svg })) {
                await updateNotetype(notetype);
                dispatch("saved");
            }
            dispatch("close");
        } finally {
            saving = false;
        }
    }

    function onKey(event: KeyboardEvent): boolean {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            void save();
            return true;
        }
        return false;
    }
</script>

<Modal {title} width="560px" {onKey} on:close={() => dispatch("close")}>
    {#if notetype}
        <div class="options">
            <label>
                <span>LaTeX header</span>
                <textarea rows="6" bind:value={header} spellcheck="false"></textarea>
            </label>
            <label>
                <span>LaTeX footer</span>
                <textarea rows="3" bind:value={footer} spellcheck="false"></textarea>
            </label>
            <label class="check">
                <input type="checkbox" bind:checked={svg} />
                <span>Create scalable images with dvisvgm</span>
            </label>
        </div>
    {/if}
    <svelte:fragment slot="buttons">
        <button on:click={() => dispatch("close")} disabled={saving}>
            {tr.actionsCancel()}
        </button>
        <button class="primary" on:click={save} disabled={!notetype || saving}>
            {tr.actionsSave()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .options {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
    }
    label.check {
        flex-direction: row;
        align-items: center;
        gap: 8px;
    }
    textarea {
        font-family: ui-monospace, Menlo, monospace;
        font-size: 12px;
        color: var(--fg);
        background: var(--canvas);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 6px 8px;
        resize: vertical;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 5px 12px;
        cursor: pointer;
    }
    button.primary {
        background: var(--button-primary-bg);
        color: white;
        border-color: transparent;
    }
    button:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
