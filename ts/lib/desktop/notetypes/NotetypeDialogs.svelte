<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Hosts the Fields dialog and the card layout screen so that both the note
type list and the editor's Fields.../Cards... buttons open the same dialogs.
-->
<script context="module" lang="ts">
    export interface CardLayoutArgs {
        notetypeId: bigint;
        /** The note to preview: an existing one, or a new note with `fields`. */
        noteId: bigint | null;
        fields: string[] | null;
        /** The card ordinal to open on. */
        ord: number;
        fillEmpty: boolean;
    }
</script>

<script lang="ts">
    import { createEventDispatcher } from "svelte";

    import CardLayout from "./CardLayout.svelte";
    import FieldsDialog from "./FieldsDialog.svelte";
    import OptionsDialog from "./OptionsDialog.svelte";

    export let nightMode = false;

    const dispatch = createEventDispatcher<{ saved: void; notify: string }>();

    let fieldsFor: bigint | null = null;
    let optionsFor: bigint | null = null;
    let cards: CardLayoutArgs | null = null;

    export function openOptions(notetypeId: bigint): void {
        optionsFor = notetypeId;
    }

    export function openFields(notetypeId: bigint): void {
        fieldsFor = notetypeId;
    }

    export function openCards(args: CardLayoutArgs): void {
        cards = args;
    }
</script>

{#if fieldsFor !== null}
    <FieldsDialog
        notetypeId={fieldsFor}
        on:close={() => (fieldsFor = null)}
        on:saved={() => dispatch("saved")}
    />
{/if}
{#if optionsFor !== null}
    <OptionsDialog
        notetypeId={optionsFor}
        on:close={() => (optionsFor = null)}
        on:saved={() => dispatch("saved")}
    />
{/if}
{#if cards}
    <CardLayout
        notetypeId={cards.notetypeId}
        noteId={cards.noteId}
        fields={cards.fields}
        ord={cards.ord}
        fillEmpty={cards.fillEmpty}
        {nightMode}
        on:close={() => (cards = null)}
        on:saved={() => dispatch("saved")}
        on:notify={(e) => dispatch("notify", e.detail)}
    />
{/if}
