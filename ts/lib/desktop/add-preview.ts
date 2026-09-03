// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The live preview beside the Add editor (plan item A11): which card of the
 * note being typed to render. The pure part; AddPreview.svelte renders it.
 */

import { Note } from "@generated/anki/notes_pb";
import type { Notetype, Notetype_Template } from "@generated/anki/notetypes_pb";
import { Notetype_Config_Kind } from "@generated/anki/notetypes_pb";

import type { EditorNoteInfo } from "./EditorPanel.svelte";

export interface PreviewPlan {
    note: Note;
    template: Notetype_Template;
    /** Template index, or cloze number - 1 for cloze note types. */
    ord: number;
}

/** The first cloze number used in the fields, or 1 when there is none yet. */
export function firstClozeNumber(fields: readonly string[]): number {
    let lowest = Infinity;
    for (const field of fields) {
        for (const match of field.matchAll(/\{\{c(\d+)::/g)) {
            lowest = Math.min(lowest, Number(match[1]));
        }
    }
    return Number.isFinite(lowest) && lowest > 0 ? lowest : 1;
}

/** True when nothing has been typed yet: there is nothing to preview. */
export function isBlank(fields: readonly string[]): boolean {
    return fields.every((f) => !f.replace(/<[^>]*>/g, "").trim());
}

/** What to render for the note the editor holds, or null when nothing applies. */
export function previewPlan(info: EditorNoteInfo | null, notetype: Notetype | null): PreviewPlan | null {
    if (!info || !notetype || notetype.id !== info.notetypeId || !notetype.templates.length) {
        return null;
    }
    if (isBlank(info.fields)) {
        return null;
    }
    const cloze = notetype.config?.kind === Notetype_Config_Kind.CLOZE;
    const ord = cloze ? firstClozeNumber(info.fields) - 1 : 0;
    const template = notetype.templates[cloze ? 0 : ord];
    const note = new Note({ notetypeId: info.notetypeId, fields: [...info.fields] });
    return { note, template, ord };
}
