<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Check Media (qt/aqt/mediacheck.py): the report, and the actions it offers
for unused files, missing files and the media trash.
-->
<script lang="ts">
    import type { CheckMediaResponse } from "@generated/anki/media_pb";
    import {
        addNoteTags,
        checkMedia,
        emptyTrash,
        restoreTrash,
    } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    import { trashUnusedMedia } from "./maintenance";
    import Modal from "./Modal.svelte";

    const dispatch = createEventDispatcher<{
        close: void;
        notify: string;
        changed: void;
    }>();

    let output: CheckMediaResponse | null = null;
    let busy = false;

    async function run(action: () => Promise<string>, refresh = false): Promise<void> {
        busy = true;
        try {
            dispatch("notify", await action());
            if (refresh) {
                dispatch("changed");
            }
        } catch {
            // postProto has shown the error.
        } finally {
            busy = false;
        }
    }

    /** _on_trash_files */
    async function deleteUnused(): Promise<void> {
        if (!output || !confirm(tr.mediaCheckDeleteUnusedConfirm())) {
            return;
        }
        const unused = output.unused;
        await run(async () => {
            const count = await trashUnusedMedia(unused);
            if (output) {
                output.unused = [];
                output.haveTrash = true;
                output = output;
            }
            return tr.mediaCheckDeleteUnusedComplete({ count });
        });
    }

    /** add_missing_media_tag */
    async function tagMissing(): Promise<void> {
        const noteIds = output?.missingMediaNotes ?? [];
        await run(async () => {
            const changes = await addNoteTags({
                noteIds,
                tags: tr.mediaCheckMissingMediaTag(),
            });
            return tr.browsingNotesUpdated({ count: changes.count });
        }, true);
    }

    onMount(async () => {
        try {
            output = await checkMedia({});
        } catch {
            dispatch("close");
        }
    });
</script>

<Modal title={tr.mediaCheckWindowTitle()} width="640px" on:close>
    {#if !output}
        <p class="subtle">{tr.actionsProcessing()}</p>
    {:else}
        <pre class="report">{output.report}</pre>
    {/if}
    <svelte:fragment slot="footer">
        {#if output?.unused.length}
            <button disabled={busy} on:click={deleteUnused}>
                {tr.mediaCheckDeleteUnused()}
            </button>
        {/if}
        {#if output?.missing.length}
            <button disabled={busy} on:click={tagMissing}>
                {tr.mediaCheckAddTag()}
            </button>
        {/if}
        {#if output?.haveTrash}
            <button
                disabled={busy}
                on:click={() =>
                    run(async () => {
                        await emptyTrash({});
                        return tr.mediaCheckTrashEmptied();
                    })}
            >
                {tr.mediaCheckEmptyTrash()}
            </button>
            <button
                disabled={busy}
                on:click={() =>
                    run(async () => {
                        await restoreTrash({});
                        return tr.mediaCheckTrashRestored();
                    })}
            >
                {tr.mediaCheckRestoreTrash()}
            </button>
        {/if}
        <button class="primary" on:click={() => dispatch("close")}>
            {tr.actionsClose()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .report {
        margin: 0;
        max-height: 60vh;
        overflow: auto;
        font: inherit;
        white-space: pre;
    }
    .subtle {
        color: var(--fg-subtle);
        margin: 0;
    }
</style>
