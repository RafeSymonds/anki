<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Create or change a filtered deck (qt/aqt/filtered_deck.py). Building the
deck also makes it the current deck.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    import type { FilteredDeckDialogData } from "./filtered-deck";
    import { loadFilteredDeck, saveFilteredDeck } from "./filtered-deck";
    import Modal from "./Modal.svelte";

    /** 0 creates a new deck from the current deck's settings. */
    export let deckId: bigint = 0n;

    const dispatch = createEventDispatcher<{ close: void; done: bigint }>();

    let data: FilteredDeckDialogData | null = null;
    let busy = false;

    $: existing = data ? data.deck.id !== 0n : false;

    async function accept(): Promise<void> {
        if (!data) {
            return;
        }
        busy = true;
        try {
            const id = await saveFilteredDeck(data.deck, data.form);
            dispatch("done", id);
        } catch {
            // postProto has shown the error (e.g. an empty search); keep the dialog open.
        } finally {
            busy = false;
        }
    }

    onMount(async () => {
        try {
            data = await loadFilteredDeck(deckId);
        } catch {
            dispatch("close");
        }
    });
</script>

<Modal
    title={data
        ? tr.actionsOptionsFor({ val: data.deck.name })
        : tr.actionsBuildFilteredDeck()}
    width="560px"
    on:close
>
    {#if !data}
        <p class="subtle">…</p>
    {:else}
        <div class="form">
            <label class="row">
                <span class="key">{tr.actionsName()}</span>
                <!-- svelte-ignore a11y_autofocus -->
                <input
                    class="grow"
                    type="text"
                    bind:value={data.form.name}
                    placeholder={data.deck.name}
                    autofocus
                />
            </label>

            <fieldset>
                <legend>{tr.decksFilter()}</legend>
                <label class="row">
                    <span class="key">{tr.actionsSearch()}</span>
                    <input class="grow" type="text" bind:value={data.form.search} />
                </label>
                <div class="row">
                    <span>{tr.decksLimitTo()}</span>
                    <input
                        class="number"
                        type="number"
                        min="0"
                        max="99999"
                        bind:value={data.form.limit}
                    />
                    <span>{tr.decksCardsSelectedBy()}</span>
                    <select bind:value={data.form.order}>
                        {#each data.orders as order (order.value)}
                            <option value={order.value}>{order.label}</option>
                        {/each}
                    </select>
                </div>
            </fieldset>

            <label>
                <input type="checkbox" bind:checked={data.form.secondFilter} />
                {tr.decksEnableSecondFilter()}
            </label>
            {#if data.form.secondFilter}
                <fieldset>
                    <legend>{tr.decksFilter2()}</legend>
                    <label class="row">
                        <span class="key">{tr.actionsSearch()}</span>
                        <input
                            class="grow"
                            type="text"
                            bind:value={data.form.search2}
                        />
                    </label>
                    <div class="row">
                        <span>{tr.decksLimitTo()}</span>
                        <input
                            class="number"
                            type="number"
                            min="0"
                            max="99999"
                            bind:value={data.form.limit2}
                        />
                        <span>{tr.decksCardsSelectedBy()}</span>
                        <select bind:value={data.form.order2}>
                            {#each data.orders as order (order.value)}
                                <option value={order.value}>{order.label}</option>
                            {/each}
                        </select>
                    </div>
                </fieldset>
            {/if}

            <label>
                <input type="checkbox" bind:checked={data.form.reschedule} />
                {tr.decksRescheduleCardsBasedOnMyAnswers()}
            </label>
            {#if !data.form.reschedule}
                <div class="delays">
                    <label class="row">
                        <span class="key">
                            {tr.decksDelayForButton({ button: tr.studyingAgain() })}
                        </span>
                        <input
                            class="number"
                            type="number"
                            min="0"
                            bind:value={data.form.previewAgain}
                        />
                    </label>
                    <label class="row">
                        <span class="key">
                            {tr.decksDelayForButton({ button: tr.studyingHard() })}
                        </span>
                        <input
                            class="number"
                            type="number"
                            min="0"
                            bind:value={data.form.previewHard}
                        />
                    </label>
                    <label class="row">
                        <span class="key">
                            {tr.decksDelayForButton({ button: tr.studyingGood() })}
                        </span>
                        <input
                            class="number"
                            type="number"
                            min="0"
                            bind:value={data.form.previewGood}
                        />
                    </label>
                </div>
            {/if}
            <label>
                <input type="checkbox" bind:checked={data.form.allowEmpty} />
                {tr.decksCreateEvenIfEmpty()}
            </label>
        </div>
    {/if}
    <svelte:fragment slot="footer">
        <button on:click={() => dispatch("close")}>{tr.actionsCancel()}</button>
        <button class="primary build" disabled={!data || busy} on:click={accept}>
            {existing ? tr.actionsRebuild() : tr.decksBuild()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .form {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .key {
        min-width: 70px;
    }
    .grow {
        flex: 1;
        min-width: 160px;
    }
    .number {
        width: 80px;
    }
    fieldset {
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
    }
    legend {
        padding: 0 4px;
        color: var(--fg-subtle);
    }
    .delays {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-inline-start: 22px;
    }
    .delays .key {
        min-width: 140px;
    }
    .subtle {
        color: var(--fg-subtle);
        margin: 0;
    }
</style>
