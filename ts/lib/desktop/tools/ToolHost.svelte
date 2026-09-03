<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Runs the tools (tools.ts) for the shell: the ones that are screens ask the
shell to embed a page, the rest open a dialog here or run to completion
and report through a notice.
-->
<script context="module" lang="ts">
    /** A SvelteKit route the shell should embed for a tool. */
    export interface PageRequest {
        title: string;
        src: string;
        onClose?: () => void;
    }
</script>

<script lang="ts">
    import type { EmptyCardsReport } from "@generated/anki/card_rendering_pb";
    import { getEmptyCards } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    import { importCollectionPackage, pickFile } from "../desktop-api";
    import CheckMediaDialog from "./CheckMediaDialog.svelte";
    import CustomStudyDialog from "./CustomStudyDialog.svelte";
    import EmptyCardsDialog from "./EmptyCardsDialog.svelte";
    import ExportDialog from "./ExportDialog.svelte";
    import FilteredDeckDialog from "./FilteredDeckDialog.svelte";
    import { IMPORT_EXTENSIONS, importTargetFor } from "./import";
    import { backupNow, runCheckDatabase, runCreateBackup } from "./maintenance";
    import StudyDeckDialog from "./StudyDeckDialog.svelte";
    import TextDialog from "./TextDialog.svelte";
    import type { ToolId } from "./tools";

    /** The deck the deck-scoped tools act on when none is given. */
    export let deckId: bigint;
    /** Its name, for the Study Deck switcher. */
    export let deckName = "";

    const dispatch = createEventDispatcher<{
        noteTypes: void;
        /** Embed a SvelteKit route. */
        page: PageRequest;
        /** The collection changed; the current deck may have too. */
        changed: void;
        /** Make this deck current and show its overview. */
        select: bigint;
        /** A short notice for the user. */
        notify: string;
    }>();

    type Dialog =
        | { kind: "customStudy"; deckId: bigint }
        | { kind: "filteredDeck"; deckId: bigint }
        | { kind: "export"; deckId: bigint | null }
        | { kind: "checkMedia" }
        | { kind: "emptyCards"; report: EmptyCardsReport }
        | { kind: "studyDeck" }
        | { kind: "text"; title: string; text: string };

    let dialog: Dialog | null = null;

    export function isOpen(): boolean {
        return dialog !== null;
    }

    function close(): void {
        dialog = null;
    }

    function changed(): void {
        dispatch("changed");
    }

    /** prompt_for_file_then_import / import_file in importing.py. */
    async function importFile(): Promise<void> {
        const path = await pickFile({
            title: tr.actionsImport(),
            filterDescription: tr.importingAllSupportedFormats({ val: "" }).trim(),
            extensions: IMPORT_EXTENSIONS,
        });
        if (!path) {
            return;
        }
        const target = importTargetFor(path);
        if (target.kind === "page") {
            dispatch("page", {
                title: tr.decksImportFile(),
                src: target.route,
                onClose: changed,
            });
        } else if (target.kind === "collection") {
            if (!confirm(tr.importingThisWillDeleteYourExistingCollection())) {
                return;
            }
            await backupNow();
            await importCollectionPackage(path);
            dispatch("notify", tr.importingImportingComplete());
            changed();
        } else {
            alert("Unsupported file type.");
        }
    }

    async function checkDatabase(): Promise<void> {
        const result = await runCheckDatabase();
        if (result.ok) {
            dispatch("notify", result.message);
        } else {
            dialog = { kind: "text", title: "Check Database", text: result.message };
        }
        changed();
    }

    async function emptyCards(): Promise<void> {
        const report = await getEmptyCards({});
        if (!report.notes.length) {
            dispatch("notify", tr.emptyCardsNotFound());
        } else {
            dialog = { kind: "emptyCards", report };
        }
    }

    async function createBackup(): Promise<void> {
        try {
            dispatch("notify", await runCreateBackup());
        } catch (err) {
            alert(
                tr.profilesBackupCreationFailed({
                    reason: err instanceof Error ? err.message : String(err),
                }),
            );
        }
    }

    /** Run a tool; `forDeck` is the deck a sidebar or overview action refers to. */
    export async function run(id: ToolId, forDeck?: bigint): Promise<void> {
        switch (id) {
            case "stats":
                dispatch("page", { title: tr.statisticsTitle(), src: "/graphs" });
                break;
            case "preferences":
                dispatch("page", {
                    title: tr.preferencesPreferences(),
                    src: "/preferences",
                });
                break;
            case "import":
                await importFile();
                break;
            case "export":
                dialog = { kind: "export", deckId: forDeck ?? null };
                break;
            case "createBackup":
                await createBackup();
                break;
            case "studyDeck":
                dialog = { kind: "studyDeck" };
                break;
            case "filteredDeck":
                dialog = { kind: "filteredDeck", deckId: forDeck ?? 0n };
                break;
            case "customStudy":
                dialog = { kind: "customStudy", deckId: forDeck ?? deckId };
                break;
            case "checkDatabase":
                await checkDatabase();
                break;
            case "checkMedia":
                dialog = { kind: "checkMedia" };
                break;
            case "emptyCards":
                await emptyCards();
                break;
            case "noteTypes":
                dispatch("noteTypes");
                break;
        }
    }
</script>

{#if dialog?.kind === "customStudy"}
    <CustomStudyDialog
        deckId={dialog.deckId}
        on:close={close}
        on:done={() => {
            close();
            changed();
        }}
    />
{:else if dialog?.kind === "filteredDeck"}
    <FilteredDeckDialog
        deckId={dialog.deckId}
        on:close={close}
        on:done={(e) => {
            close();
            dispatch("select", e.detail);
        }}
    />
{:else if dialog?.kind === "export"}
    <ExportDialog
        deckId={dialog.deckId}
        on:close={close}
        on:notify={(e) => dispatch("notify", e.detail)}
        on:changed={changed}
    />
{:else if dialog?.kind === "checkMedia"}
    <CheckMediaDialog
        on:close={close}
        on:notify={(e) => dispatch("notify", e.detail)}
        on:changed={changed}
    />
{:else if dialog?.kind === "emptyCards"}
    <EmptyCardsDialog
        report={dialog.report}
        on:close={close}
        on:notify={(e) => dispatch("notify", e.detail)}
        on:changed={changed}
    />
{:else if dialog?.kind === "studyDeck"}
    <StudyDeckDialog
        current={deckName}
        on:close={close}
        on:select={(e) => {
            close();
            dispatch("select", e.detail);
        }}
    />
{:else if dialog?.kind === "text"}
    <TextDialog title={dialog.title} text={dialog.text} on:close={close} />
{/if}
