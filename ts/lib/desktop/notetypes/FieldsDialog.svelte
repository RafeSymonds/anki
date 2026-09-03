<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The Fields dialog (qt/aqt/fields.py): a note type's fields, their order and
their editing options, saved with one updateNotetype call.
-->
<script lang="ts">
    import type { Notetype } from "@generated/anki/notetypes_pb";
    import {
        Notetype_Config,
        Notetype_Field_Config,
    } from "@generated/anki/notetypes_pb";
    import {
        getNotetype,
        getNotetypeNamesAndCounts,
        updateNotetype,
    } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { withoutUnicodeIsolation } from "@tslib/i18n";
    import { createEventDispatcher, onMount } from "svelte";

    import Modal from "./Modal.svelte";
    import type { FieldNameError } from "./notetypes";
    import {
        addField,
        isSortField,
        newField,
        removeField,
        removeFieldError,
        renameField,
        repositionField,
        setSortField,
        validateFieldName,
    } from "./notetypes";

    export let notetypeId: bigint;

    const dispatch = createEventDispatcher<{ close: void; saved: void }>();

    let notetype: Notetype | null = null;
    let useCount = 0;
    let current = 0;
    let changed = false;

    $: fields = notetype?.fields ?? [];
    $: config = fields[current]?.config;
    $: title = notetype
        ? withoutUnicodeIsolation(tr.fieldsFieldsFor({ val: notetype.name }))
        : "";

    onMount(async () => {
        const loaded = await getNotetype({ ntid: notetypeId });
        loaded.config ??= new Notetype_Config();
        for (const field of loaded.fields) {
            field.config ??= new Notetype_Field_Config();
        }
        const counts = await getNotetypeNamesAndCounts({});
        useCount =
            counts.entries.find((entry) => entry.id === notetypeId)?.useCount ?? 0;
        notetype = loaded;
    });

    /** Record a change and let the list and options re-render. */
    function touch(): void {
        changed = true;
        notetype = notetype;
    }

    /** Edit the current field's options (`saveField` in fields.py). */
    function update(fn: (config: Notetype_Field_Config) => void): void {
        if (config) {
            fn(config);
            touch();
        }
    }

    function warn(error: FieldNameError): void {
        switch (error) {
            case "first-letter":
                alert(tr.fieldsNameFirstLetterNotValid());
                break;
            case "invalid-letter":
                alert(tr.fieldsNameInvalidLetter());
                break;
            case "duplicate":
                alert(tr.fieldsThatFieldNameIsAlreadyUsed());
                break;
            default:
                break;
        }
    }

    /** `_uniqueName`: prompt for a field name; null when nothing should change. */
    function uniqueName(message: string, old = ""): string | null {
        const text = prompt(message, old);
        if (text === null || !notetype) {
            return null;
        }
        const result = validateFieldName(notetype, text, old);
        if (result.error) {
            warn(result.error);
            return null;
        }
        return result.name;
    }

    function onAdd(): void {
        const name = uniqueName(tr.fieldsFieldName());
        if (!name || !notetype) {
            return;
        }
        addField(notetype, newField(name));
        current = notetype.fields.length - 1;
        touch();
    }

    function onDelete(): void {
        if (!notetype) {
            return;
        }
        const error = removeFieldError(notetype, current);
        if (error === "last-field") {
            alert(tr.fieldsNotesRequireAtLeastOneField());
            return;
        }
        if (error === "required") {
            alert(tr.fieldsFieldIsRequired());
            return;
        }
        if (
            !confirm(
                tr.fieldsDeleteFieldFrom({
                    val: tr.browsingNoteCount({ count: useCount }),
                }),
            )
        ) {
            return;
        }
        removeField(notetype, current);
        current = 0;
        touch();
    }

    function onRename(): void {
        const field = fields[current];
        if (!field || !notetype) {
            return;
        }
        const name = uniqueName(tr.actionsNewName(), field.name);
        if (!name) {
            return;
        }
        renameField(notetype, current, name);
        touch();
    }

    function onPosition(): void {
        if (!notetype) {
            return;
        }
        const count = fields.length;
        const text = prompt(tr.fieldsNewPosition1({ val: count }), String(current + 1));
        if (!text) {
            return;
        }
        const position = Number(text);
        if (!Number.isInteger(position) || position < 1 || position > count) {
            return;
        }
        repositionField(notetype, current, position - 1);
        current = position - 1;
        touch();
    }

    function onSortField(): void {
        if (notetype) {
            // Cannot be switched off: some field has to be the sort field.
            setSortField(notetype, current);
            touch();
        }
    }

    async function save(): Promise<void> {
        if (!notetype) {
            return;
        }
        try {
            await updateNotetype(notetype);
        } catch {
            return;
        }
        dispatch("saved");
        dispatch("close");
    }

    function cancel(): void {
        if (changed && !confirm(tr.cardTemplatesDiscardChanges())) {
            return;
        }
        dispatch("close");
    }
</script>

<Modal {title} width="640px" on:close={cancel}>
    {#if notetype}
        <div class="fields-dialog">
            <div class="list-column">
                <div class="list" role="listbox" aria-label={tr.notetypesFields()}>
                    {#each fields as field, index (field)}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <div
                            class="field-row"
                            class:selected={index === current}
                            role="option"
                            tabindex="-1"
                            aria-selected={index === current}
                            on:click={() => (current = index)}
                        >
                            {index + 1}: {field.name}
                        </div>
                    {/each}
                </div>
                <div class="list-buttons">
                    <button on:click={onAdd}>{tr.actionsAdd()}</button>
                    <button on:click={onDelete}>{tr.actionsDelete()}</button>
                    <button on:click={onRename}>{tr.actionsRename()}</button>
                    <button on:click={onPosition}>{tr.actionsReposition()}...</button>
                </div>
            </div>

            {#if config}
                <div class="options">
                    <div class="group-title">{tr.fieldsEditingFont()}</div>
                    <label class="inline">
                        <span>{tr.fieldsFont()}</span>
                        <input
                            type="text"
                            class="font-name"
                            value={config.fontName}
                            on:change={(e) =>
                                update((c) => (c.fontName = e.currentTarget.value))}
                        />
                        <span>{tr.fieldsSize()}</span>
                        <input
                            type="number"
                            class="font-size"
                            min="5"
                            max="300"
                            value={config.fontSize}
                            on:change={(e) =>
                                update(
                                    (c) =>
                                        (c.fontSize =
                                            Number(e.currentTarget.value) || 20),
                                )}
                        />
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={isSortField(notetype, current)}
                            on:change={onSortField}
                        />
                        {tr.fieldsSortByThisFieldInThe()}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={config.sticky}
                            on:change={(e) =>
                                update((c) => (c.sticky = e.currentTarget.checked))}
                        />
                        Remember last input when adding
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={config.rtl}
                            on:change={(e) =>
                                update((c) => (c.rtl = e.currentTarget.checked))}
                        />
                        {tr.fieldsReverseTextDirectionRtl()}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={config.plainText}
                            on:change={(e) =>
                                update((c) => (c.plainText = e.currentTarget.checked))}
                        />
                        {tr.fieldsHtmlByDefault()}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={config.collapsed}
                            on:change={(e) =>
                                update((c) => (c.collapsed = e.currentTarget.checked))}
                        />
                        {tr.fieldsCollapseByDefault()}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={config.excludeFromSearch}
                            on:change={(e) =>
                                update(
                                    (c) =>
                                        (c.excludeFromSearch = e.currentTarget.checked),
                                )}
                        />
                        {tr.fieldsExcludeFromSearch()}
                    </label>
                    <label class="inline">
                        <span>{tr.fieldsDescription()}</span>
                        <input
                            type="text"
                            class="description"
                            placeholder={tr.fieldsDescriptionPlaceholder()}
                            value={config.description}
                            on:change={(e) =>
                                update((c) => (c.description = e.currentTarget.value))}
                        />
                    </label>
                </div>
            {/if}
        </div>
    {/if}
    <svelte:fragment slot="buttons">
        <button on:click={cancel}>{tr.actionsCancel()}</button>
        <button class="primary" on:click={save}>{tr.actionsSave()}</button>
    </svelte:fragment>
</Modal>

<style>
    .fields-dialog {
        display: grid;
        grid-template-columns: minmax(200px, 1fr) minmax(280px, 1.4fr);
        gap: 16px;
    }
    .list-column {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .list {
        flex: 1;
        min-height: 200px;
        max-height: 50vh;
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        background: var(--canvas-inset);
    }
    .field-row {
        padding: 5px 10px;
        cursor: default;
        user-select: none;
    }
    .field-row.selected {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .list-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
    }
    .list-buttons button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 4px 8px;
        cursor: pointer;
    }
    .list-buttons button:hover {
        border-color: var(--button-hover-border);
    }
    .options {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .group-title {
        font-weight: 600;
    }
    label {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    label.inline span {
        color: var(--fg-subtle);
    }
    input[type="text"],
    input[type="number"] {
        font: inherit;
        color: var(--fg);
        background: var(--canvas-inset);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 3px 6px;
    }
    .font-name {
        flex: 1;
        min-width: 0;
    }
    .font-size {
        width: 64px;
    }
    .description {
        flex: 1;
        min-width: 0;
    }
</style>
