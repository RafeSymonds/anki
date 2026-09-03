<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The Study Deck quick switcher (qt/aqt/studydeck.py): type to filter the
deck names, Up/Down to move, Enter to study the selected deck.
-->
<script lang="ts">
    import { getDeckNames } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    import Modal from "./Modal.svelte";
    import { filterNames, initialSelection, moveSelection } from "./study-deck";

    /** Name of the current deck, selected first (the `current` argument). */
    export let current: string | null = null;

    const dispatch = createEventDispatcher<{ select: bigint; close: void }>();

    let decks: { id: bigint; name: string }[] = [];
    let filter = "";
    let selected = 0;
    let list: HTMLDivElement;

    $: names = filterNames(
        decks.map((d) => d.name),
        filter,
    );
    $: matching = decks.filter((d) => names.includes(d.name));

    function refilter(): void {
        selected = 0;
        scrollIntoView();
    }

    function scrollIntoView(): void {
        list?.children[selected]?.scrollIntoView({ block: "nearest" });
    }

    function accept(): void {
        const deck = matching[selected];
        if (deck) {
            dispatch("select", deck.id);
        }
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            selected = moveSelection(
                selected,
                matching.length,
                event.key === "ArrowUp" ? -1 : 1,
            );
            scrollIntoView();
        } else if (event.key === "Enter") {
            event.preventDefault();
            accept();
        } else if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
            const row = Number(event.key) - 1;
            if (row < matching.length) {
                event.preventDefault();
                selected = row;
                scrollIntoView();
            }
        }
    }

    onMount(async () => {
        const response = await getDeckNames({
            skipEmptyDefault: true,
            includeFiltered: true,
        });
        decks = response.entries.map((d) => ({ id: d.id, name: d.name }));
        selected = initialSelection(
            decks.map((d) => d.name),
            current,
        );
        scrollIntoView();
    });
</script>

<Modal title={tr.decksStudyDeck()} on:close>
    <div class="study-deck">
        <label>
            {tr.actionsFilter()}:
            <!-- svelte-ignore a11y_autofocus -->
            <input
                type="text"
                autofocus
                bind:value={filter}
                on:input={refilter}
                on:keydown={onKeydown}
            />
        </label>
        <div class="list" role="listbox" bind:this={list}>
            {#each matching as deck, i (deck.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus -->
                <div
                    class="item"
                    class:selected={i === selected}
                    role="option"
                    aria-selected={i === selected}
                    on:click={() => (selected = i)}
                    on:dblclick={accept}
                >
                    {deck.name}
                </div>
            {/each}
        </div>
    </div>
    <svelte:fragment slot="footer">
        <button on:click={() => dispatch("close")}>{tr.actionsCancel()}</button>
        <button class="primary" disabled={!matching.length} on:click={accept}>
            {tr.decksStudy()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .study-deck {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .study-deck label input {
        flex: 1;
    }
    .list {
        height: 280px;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        background: var(--canvas);
        padding: 2px;
    }
    .item {
        padding: 4px 8px;
        border-radius: var(--border-radius);
        cursor: default;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .item.selected {
        background: var(--selected-bg);
        color: var(--selected-fg);
    }
</style>
