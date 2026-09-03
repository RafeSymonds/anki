<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

A small modal form standing in for the Qt dialogs the browser opens
(Change Deck, Reposition, Forget, Find and Replace): a title, a list of
fields, OK and Cancel.
-->
<script lang="ts" context="module">
    export type DialogValue = string | number | boolean;

    export interface DialogField {
        key: string;
        label: string;
        kind: "text" | "number" | "checkbox" | "select";
        value: DialogValue;
        options?: { value: string; label: string }[];
        /** Extra text under the field. */
        hint?: string;
        placeholder?: string;
    }

    export type DialogValues = Record<string, DialogValue>;
</script>

<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    export let title: string;
    export let fields: DialogField[];
    export let okLabel = "OK";

    const dispatch = createEventDispatcher<{ ok: DialogValues; cancel: void }>();

    let first: HTMLElement | undefined;

    function submit(): void {
        const values: DialogValues = {};
        for (const field of fields) {
            values[field.key] =
                field.kind === "number" ? Number(field.value) : field.value;
        }
        dispatch("ok", values);
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dispatch("cancel");
        } else if (
            event.key === "Enter" &&
            !(event.target instanceof HTMLTextAreaElement)
        ) {
            event.preventDefault();
            event.stopPropagation();
            submit();
        }
    }

    onMount(() => {
        first?.focus();
    });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" on:click|self={() => dispatch("cancel")} on:keydown={onKeydown}>
    <form
        class="dialog"
        aria-label={title}
        on:submit|preventDefault={submit}
    >
        <div class="title">{title}</div>
        {#each fields as field, i (field.key)}
            <label class="field" class:inline={field.kind === "checkbox"}>
                {#if field.kind === "checkbox"}
                    <input
                        type="checkbox"
                        checked={Boolean(field.value)}
                        on:change={(e) => (field.value = e.currentTarget.checked)}
                    />
                    <span>{@html field.label}</span>
                {:else}
                    <span class="label">{@html field.label}</span>
                    {#if field.kind === "select"}
                        <select bind:value={field.value}>
                            {#each field.options ?? [] as option (option.value)}
                                <option value={option.value}>{option.label}</option>
                            {/each}
                        </select>
                    {:else if field.kind === "number"}
                        <input type="number" bind:value={field.value} />
                    {:else if i === 0}
                        <input
                            type="text"
                            bind:this={first}
                            bind:value={field.value}
                            placeholder={field.placeholder ?? ""}
                        />
                    {:else}
                        <input
                            type="text"
                            bind:value={field.value}
                            placeholder={field.placeholder ?? ""}
                        />
                    {/if}
                {/if}
                {#if field.hint}
                    <div class="hint">{field.hint}</div>
                {/if}
            </label>
        {/each}
        <div class="buttons">
            <button type="button" on:click={() => dispatch("cancel")}>
                {tr.actionsCancel()}
            </button>
            <button type="submit" class="primary">{okLabel}</button>
        </div>
    </form>
</div>

<style>
    .backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 40;
    }
    .dialog {
        min-width: 360px;
        max-width: 520px;
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius-medium, 12px);
        box-shadow: var(--shadow);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .title {
        font-weight: 600;
        font-size: 15px;
    }
    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
    }
    .field.inline {
        flex-direction: row;
        align-items: center;
        gap: 8px;
    }
    .field input[type="text"],
    .field input[type="number"],
    .field select {
        font: inherit;
        color: var(--fg);
        background: var(--canvas-inset);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 4px 6px;
    }
    .hint {
        white-space: pre-line;
        color: var(--fg-subtle);
        font-size: 12px;
    }
    .buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 6px;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 4px 14px;
        cursor: pointer;
    }
    button.primary {
        background: var(--button-primary-bg);
        color: var(--button-primary-fg);
        border-color: transparent;
    }
</style>
