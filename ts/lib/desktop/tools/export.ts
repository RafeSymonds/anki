// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The export dialog's logic, ported from qt/aqt/import_export/exporting.py:
 * the formats, which options each shows, the suggested filename, and the
 * backend call an accepted dialog makes.
 */

import type { PlainMessage } from "@bufbuild/protobuf";
import type { ExportLimit } from "@generated/anki/import_export_pb";
import { exportAnkiPackage, exportCardCsv, exportCollectionPackage, exportNoteCsv } from "@generated/backend";
import * as tr from "@generated/ftl";

export type ExportFormat = "apkg" | "colpkg" | "notes" | "cards";

export type ExportOptionKey =
    | "scheduling"
    | "deckConfigs"
    | "media"
    | "tags"
    | "html"
    | "deck"
    | "notetype"
    | "guid"
    | "legacy";

export type ExportOptions = Record<ExportOptionKey, boolean>;

export interface ExportFormatInfo {
    id: ExportFormat;
    label: string;
    extension: string;
    /** show_deck_list: the format exports one deck or everything. */
    deckList: boolean;
    /** The show_include_* flags, in the order the Qt form lists them. */
    options: ExportOptionKey[];
}

/** ApkgExporter, ColpkgExporter, NoteCsvExporter, CardCsvExporter. */
export function exportFormats(): ExportFormatInfo[] {
    return [
        {
            id: "apkg",
            label: tr.exportingAnkiDeckPackage(),
            extension: "apkg",
            deckList: true,
            options: ["scheduling", "deckConfigs", "media", "legacy"],
        },
        {
            id: "colpkg",
            label: tr.exportingAnkiCollectionPackage(),
            extension: "colpkg",
            deckList: false,
            options: ["media", "legacy"],
        },
        {
            id: "notes",
            label: tr.exportingNotesInPlainText(),
            extension: "txt",
            deckList: true,
            options: ["html", "tags", "deck", "notetype", "guid"],
        },
        {
            id: "cards",
            label: tr.exportingCardsInPlainText(),
            extension: "txt",
            deckList: true,
            options: ["html"],
        },
    ];
}

export function formatInfo(id: ExportFormat): ExportFormatInfo {
    return exportFormats().find((f) => f.id === id)!;
}

export function optionLabel(key: ExportOptionKey): string {
    switch (key) {
        case "scheduling":
            return tr.exportingIncludeSchedulingInformation();
        case "deckConfigs":
            return tr.exportingIncludeDeckConfigs();
        case "media":
            return tr.exportingIncludeMedia();
        case "tags":
            return tr.exportingIncludeTags();
        case "html":
            return tr.exportingIncludeHtmlAndMediaReferences();
        case "deck":
            return tr.exportingIncludeDeck();
        case "notetype":
            return tr.exportingIncludeNotetype();
        case "guid":
            return tr.exportingIncludeGuid();
        case "legacy":
            return tr.exportingSupportOlderAnkiVersions();
    }
}

/** ExportDialog.setup: File>Export defaults to colpkg, a deck's button to apkg. */
export function defaultFormat(deckId: bigint | null): ExportFormat {
    return deckId ? "apkg" : "colpkg";
}

/** The checkbox states of exporting.ui, with setup()'s adjustments. */
export function defaultOptions(deckId: bigint | null): ExportOptions {
    return {
        scheduling: !deckId,
        deckConfigs: false,
        media: true,
        tags: true,
        html: true,
        deck: false,
        notetype: false,
        guid: false,
        legacy: false,
    };
}

function pad(n: number): string {
    return n.toString().padStart(2, "0");
}

/** ExportDialog.filename: the deck's name, or "collection-<timestamp>". */
export function defaultFilename(format: ExportFormat, deckLabel: string, now: Date = new Date()): string {
    const info = formatInfo(format);
    let stem: string;
    if (info.deckList) {
        stem = deckLabel.replace(/[\\/?<>:*|"^]/g, "_");
    } else {
        const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}@${pad(now.getHours())}-${
            pad(now.getMinutes())
        }-${pad(now.getSeconds())}`;
        stem = `${tr.exportingCollection()}-${time}`;
    }
    return `${stem}.${info.extension}`;
}

export function exportLimit(deckId: bigint | null): PlainMessage<ExportLimit> {
    return deckId
        ? { limit: { case: "deckId", value: deckId } }
        : { limit: { case: "wholeCollection", value: {} } };
}

export type ExportCall =
    | { method: "exportAnkiPackage"; input: Parameters<typeof exportAnkiPackage>[0] }
    | { method: "exportCollectionPackage"; input: Parameters<typeof exportCollectionPackage>[0] }
    | { method: "exportNoteCsv"; input: Parameters<typeof exportNoteCsv>[0] }
    | { method: "exportCardCsv"; input: Parameters<typeof exportCardCsv>[0] };

/** Exporter.export for each format: the backend call and its arguments. */
export function exportCall(
    format: ExportFormat,
    options: ExportOptions,
    outPath: string,
    deckId: bigint | null,
): ExportCall {
    switch (format) {
        case "apkg":
            return {
                method: "exportAnkiPackage",
                input: {
                    outPath,
                    options: {
                        withScheduling: options.scheduling,
                        withDeckConfigs: options.deckConfigs,
                        withMedia: options.media,
                        legacy: options.legacy,
                    },
                    limit: exportLimit(deckId),
                },
            };
        case "colpkg":
            return {
                method: "exportCollectionPackage",
                input: { outPath, includeMedia: options.media, legacy: options.legacy },
            };
        case "notes":
            return {
                method: "exportNoteCsv",
                input: {
                    outPath,
                    withHtml: options.html,
                    withTags: options.tags,
                    withDeck: options.deck,
                    withNotetype: options.notetype,
                    withGuid: options.guid,
                    limit: exportLimit(deckId),
                },
            };
        case "cards":
            return {
                method: "exportCardCsv",
                input: { outPath, withHtml: options.html, limit: exportLimit(deckId) },
            };
    }
}

/** Run the call; resolves to the message the Qt app shows as a tooltip. */
export async function runExport(call: ExportCall): Promise<string> {
    switch (call.method) {
        case "exportAnkiPackage":
            return tr.exportingNoteExported({ count: (await exportAnkiPackage(call.input)).val });
        case "exportCollectionPackage":
            await exportCollectionPackage(call.input);
            return tr.exportingCollectionExported();
        case "exportNoteCsv":
            return tr.exportingNoteExported({ count: (await exportNoteCsv(call.input)).val });
        case "exportCardCsv":
            return tr.exportingCardExported({ count: (await exportCardCsv(call.input)).val });
    }
}
