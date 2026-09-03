<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

A list to pick one entry from: the note type to add or clone (AddModel in
models.py), or the stock note type to restore to (SelectStockNotetype in
clayout.py). Enter and a double click choose the selected entry.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    import Modal from "./Modal.svelte";

    export let title: string;
    export let items: string[];

    const dispatch = createEventDispatcher<{ choose: number; cancel: void }>();

    let selected = 0;

    function onKey(event: KeyboardEvent): boolean {
        switch (event.key) {
            case "Enter":
                dispatch("choose", selected);
                return true;
            case "ArrowDown":
                selected = Math.min(selected + 1, items.length - 1);
                return true;
            case "ArrowUp":
                selected = Math.max(selected - 1, 0);
                return true;
            default:
                return false;
        }
    }
</script>

<Modal {title} width="440px" {onKey} on:close={() => dispatch("cancel")}>
    <div class="list" role="listbox" aria-label={title}>
        {#each items as item, index}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
                class="item"
                class:selected={index === selected}
                role="option"
                tabindex="-1"
                aria-selected={index === selected}
                on:click={() => (selected = index)}
                on:dblclick={() => dispatch("choose", index)}
            >
                {item}
            </div>
        {/each}
    </div>
    <svelte:fragment slot="buttons">
        <button on:click={() => dispatch("cancel")}>{tr.actionsCancel()}</button>
        <button class="primary" on:click={() => dispatch("choose", selected)}>
            {tr.actionsChoose()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .list {
        max-height: 60vh;
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        background: var(--canvas-inset);
    }
    .item {
        padding: 5px 10px;
        cursor: default;
        user-select: none;
    }
    .item.selected {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
</style>
