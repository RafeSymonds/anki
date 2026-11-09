<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The custom study dialog (qt/aqt/customstudy.py). Choosing "study by card
state or tag" continues to the tag selection of qt/aqt/taglimit.py before
the custom study deck is built.
-->
<script lang="ts">
    import type { CustomStudyDefaultsResponse } from "@generated/anki/scheduler_pb";
    import { customStudy, customStudyDefaults } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    import type { CramType, CustomStudyKind, SpinnerSpec } from "./custom-study";
    import {
        clampSpinner,
        CRAM_TYPES,
        cramTypeLabel,
        CUSTOM_STUDY_KINDS,
        customStudyRequest,
        initialTagSelection,
        kindLabel,
        okLabel,
        spinnerFor,
        textAfterSpinner,
        textBeforeSpinner,
    } from "./custom-study";
    import Modal from "./Modal.svelte";

    export let deckId: bigint;

    const dispatch = createEventDispatcher<{ close: void; done: void }>();

    let defaults: CustomStudyDefaultsResponse | null = null;
    let kind: CustomStudyKind = "forgot";
    let spec: SpinnerSpec = spinnerFor(kind);
    let value = 1;
    let cramType: CramType = "new";
    let include: string[] = [];
    let exclude: string[] = [];
    let choosingTags = false;
    let busy = false;

    function choose(next: CustomStudyKind): void {
        kind = next;
        spec = spinnerFor(kind);
        value = spec.value;
    }

    function onValueChange(event: Event): void {
        value = clampSpinner(Number((event.target as HTMLInputElement).value), spec);
    }

    async function accept(): Promise<void> {
        if (kind === "cram" && !choosingTags) {
            choosingTags = true;
            return;
        }
        busy = true;
        try {
            await customStudy(
                customStudyRequest(deckId, kind, value, {
                    type: cramType,
                    include,
                    exclude,
                }),
            );
            dispatch("done");
        } catch {
            // postProto has shown the error; the user can adjust and retry.
        } finally {
            busy = false;
        }
    }

    onMount(async () => {
        defaults = await customStudyDefaults({ deckId });
        ({ include, exclude } = initialTagSelection(defaults.tags));
    });
</script>

<Modal title={tr.actionsCustomStudy()} on:close>
    {#if !defaults}
        <p class="subtle">…</p>
    {:else if choosingTags}
        <div class="tags">
            <div class="tag-list">
                <div class="label">{tr.customStudyRequireOneOrMoreOfThese()}</div>
                <select multiple size="8" bind:value={include}>
                    {#each defaults.tags as tag (tag.name)}
                        <option value={tag.name}>{tag.name.replace(/_/g, " ")}</option>
                    {/each}
                </select>
            </div>
            <div class="tag-list">
                <div class="label">{tr.customStudySelectTagsToExclude()}</div>
                <select multiple size="8" bind:value={exclude}>
                    {#each defaults.tags as tag (tag.name)}
                        <option value={tag.name}>{tag.name.replace(/_/g, " ")}</option>
                    {/each}
                </select>
            </div>
        </div>
    {:else}
        <div class="options" role="radiogroup">
            {#each CUSTOM_STUDY_KINDS as option (option)}
                <label>
                    <input
                        type="radio"
                        name="custom-study"
                        value={option}
                        checked={kind === option}
                        on:change={() => choose(option)}
                    />
                    {kindLabel(option)}
                </label>
            {/each}
        </div>
        <div class="spinner-row">
            <span>{textBeforeSpinner(kind)}</span>
            <input
                class="spinner"
                type="number"
                min={spec.min}
                max={spec.max}
                {value}
                on:change={onValueChange}
                on:input={onValueChange}
            />
            <span>{textAfterSpinner(kind, value)}</span>
        </div>
        {#if kind === "cram"}
            <select class="cram-type" size="4" bind:value={cramType}>
                {#each CRAM_TYPES as type (type)}
                    <option value={type}>{cramTypeLabel(type)}</option>
                {/each}
            </select>
        {/if}
    {/if}
    <svelte:fragment slot="footer">
        <button on:click={() => dispatch("close")}>{tr.actionsCancel()}</button>
        <button class="primary" disabled={!defaults || busy} on:click={accept}>
            {choosingTags ? tr.customStudyOk() : okLabel(kind)}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .options {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
    }
    .spinner-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .spinner {
        width: 90px;
    }
    .cram-type {
        margin-top: 12px;
        width: 100%;
    }
    .tags {
        display: flex;
        gap: 16px;
    }
    .tag-list {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .tag-list select {
        width: 100%;
    }
    .label {
        font-weight: 600;
    }
    .subtle {
        color: var(--fg-subtle);
        margin: 0;
    }
</style>
