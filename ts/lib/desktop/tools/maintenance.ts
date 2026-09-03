// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Check Database, Check Media, Empty Cards and Create Backup: ports of
 * qt/aqt/dbcheck.py (check_db, fix_integrity), qt/aqt/mediacheck.py
 * (_on_trash_files) qt/aqt/emptycards.py (_delete_cards) and
 * main.py (_create_backup_with_progress).
 */

import type { EmptyCardsReport } from "@generated/anki/card_rendering_pb";
import { awaitBackupCompletion, checkDatabase, createBackup, removeCards, trashMediaFiles } from "@generated/backend";
import * as tr from "@generated/ftl";

import { profilePaths } from "../desktop-api";

/** Collection.fix_integrity: the problems found, then the "rebuilt" line. */
export function databaseCheckMessage(problems: string[]): string {
    return [...problems, tr.databaseCheckRebuilt()].join("\n");
}

export interface DatabaseCheckResult {
    message: string;
    /** No problems were found; the message is a notice rather than a report. */
    ok: boolean;
}

/** check_db: back up first, then fix and report. */
export async function runCheckDatabase(): Promise<DatabaseCheckResult> {
    await backupNow();
    const response = await checkDatabase({});
    return { message: databaseCheckMessage(response.problems), ok: response.problems.length === 0 };
}

/** create_backup_now: a forced backup that is awaited, before risky operations. */
export async function backupNow(): Promise<void> {
    const paths = await profilePaths();
    await createBackup({ backupFolder: paths.backupFolder, force: true, waitForCompletion: true });
}

/** _create_backup_with_progress(user_initiated=True); resolves to the notice to show. */
export async function runCreateBackup(): Promise<string> {
    const paths = await profilePaths();
    const created = await createBackup({ backupFolder: paths.backupFolder, force: true, waitForCompletion: false });
    if (!created.val) {
        return tr.profilesBackupUnchanged();
    }
    await awaitBackupCompletion({});
    return tr.profilesBackupCreated();
}

export function chunked<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

/** _on_trash_files: move unused files to the media trash, 25 at a time. */
export async function trashUnusedMedia(fnames: string[]): Promise<number> {
    for (const chunk of chunked(fnames, 25)) {
        await trashMediaFiles({ fnames: chunk });
    }
    return fnames.length;
}

/** EmptyCardsDialog._delete_cards: which cards go, honouring "keep notes". */
export function emptyCardsToDelete(report: EmptyCardsReport, keepNotes: boolean): bigint[] {
    const ids: bigint[] = [];
    for (const note of report.notes) {
        if (keepNotes && note.willDeleteNote) {
            ids.push(...note.cardIds.slice(1));
        } else {
            ids.push(...note.cardIds);
        }
    }
    return ids;
}

/** The report links note ids to the browser; without one, show them as text. */
export function emptyCardsReportHtml(report: string): string {
    return report.replace(/\[anki:nid:(\d+)\]/g, "$1: ");
}

export async function deleteEmptyCards(report: EmptyCardsReport, keepNotes: boolean): Promise<number> {
    const cardIds = emptyCardsToDelete(report, keepNotes);
    if (cardIds.length) {
        await removeCards({ cardIds });
    }
    return cardIds.length;
}
