// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Note type mutations for the note type list, the Fields dialog and the
 * card layout screen: ports of ModelManager in pylib/anki/models.py and of
 * the checks in qt/aqt/models.py, fields.py and clayout.py, applied to the
 * proto Notetype that getNotetype/updateNotetype exchange.
 *
 * Rules rslib relies on when the edited notetype is saved:
 * - a field or template keeps its `ord` (its index in the stored notetype)
 *   for as long as it exists; rslib uses it to rename `{{Field}}` references
 *   in the templates, to move note contents and card ordinals, and to delete
 *   the cards of removed templates (prepare_for_update in rslib);
 * - new fields and templates have no `ord`;
 * - reordering only reorders the lists; ordinals are renumbered on save;
 * - `config.sortFieldIdx` names the sort field by its `ord`.
 */

import type { Notetype } from "@generated/anki/notetypes_pb";
import {
    Notetype_Config_Kind,
    Notetype_Field,
    Notetype_Field_Config,
    Notetype_Template,
    Notetype_Template_Config,
    StockNotetype_Kind,
} from "@generated/anki/notetypes_pb";
import * as tr from "@generated/ftl";
import { withoutUnicodeIsolation } from "@tslib/i18n";

export type FieldNameError = "empty" | "unchanged" | "first-letter" | "invalid-letter" | "duplicate";

export type FieldNameResult = { name: string; error?: undefined } | { name?: undefined; error: FieldNameError };

/** `_uniqueName` in fields.py. "empty" and "unchanged" are silently ignored
 * there; the other errors are shown as warnings. */
export function validateFieldName(notetype: Notetype, text: string, old = ""): FieldNameResult {
    const name = text.replace(/"/g, "").trim();
    if (!name) {
        return { error: "empty" };
    }
    if ("#^/".includes(name[0])) {
        return { error: "first-letter" };
    }
    if (/[:{"}]/.test(name)) {
        return { error: "invalid-letter" };
    }
    if (name.toLowerCase() === old.toLowerCase()) {
        return { error: "unchanged" };
    }
    if (notetype.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
        return { error: "duplicate" };
    }
    return { name };
}

/** A random id for merging notetypes on import (NoteField::new in rslib). */
function randomId(): bigint {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let value = 0n;
    for (const byte of bytes) {
        value = (value << 8n) | BigInt(byte);
    }
    return BigInt.asIntN(64, value);
}

/** `new_field` in models.py: the stock Basic field with the given name and no ordinal. */
export function newField(name: string): Notetype_Field {
    return new Notetype_Field({
        name,
        config: new Notetype_Field_Config({
            id: randomId(),
            fontName: "Arial",
            fontSize: 20,
        }),
    });
}

/** `add_field`: appended, so its ordinal is assigned on save. */
export function addField(notetype: Notetype, field: Notetype_Field): void {
    notetype.fields.push(field);
}

export type RemoveFieldError = "last-field" | "required";

/** Why the field at `index` cannot be removed (`onDelete` in fields.py), or null. */
export function removeFieldError(notetype: Notetype, index: number): RemoveFieldError | null {
    if (notetype.fields.length < 2) {
        return "last-field";
    }
    if (notetype.fields[index]?.config?.preventDeletion) {
        return "required";
    }
    return null;
}

/** `remove_field`. Throws when `removeFieldError` says no. */
export function removeField(notetype: Notetype, index: number): void {
    const error = removeFieldError(notetype, index);
    if (error) {
        throw new Error(error);
    }
    notetype.fields.splice(index, 1);
}

/** `reposition_field`: move the field at `from` to position `to`. */
export function repositionField(notetype: Notetype, from: number, to: number): void {
    moveItem(notetype.fields, from, to);
}

/** `rename_field`: only the name changes; the `ord` is what lets rslib
 * rename the `{{Field}}` references in the templates on save. */
export function renameField(notetype: Notetype, index: number, name: string): void {
    const field = notetype.fields[index];
    if (!field) {
        throw new Error("invalid field");
    }
    field.name = name;
}

/** The ordinal the sort index refers to: the stored one, or the position
 * for a field that has not been saved yet. */
function sortOrd(notetype: Notetype, index: number): number {
    return notetype.fields[index]?.ord?.val ?? index;
}

/** `loadField` in fields.py compares `sortf` against the field's `ord`. */
export function isSortField(notetype: Notetype, index: number): boolean {
    return (notetype.config?.sortFieldIdx ?? 0) === sortOrd(notetype, index);
}

/** `set_sort_index`, expressed as the ordinal rslib maps back to a position on save. */
export function setSortField(notetype: Notetype, index: number): void {
    if (index < 0 || index >= notetype.fields.length || !notetype.config) {
        throw new Error("invalid sort index");
    }
    notetype.config.sortFieldIdx = sortOrd(notetype, index);
}

/** `new_template` in models.py: a template with the given name and no ordinal. */
export function newTemplate(name: string, qfmt = "", afmt = ""): Notetype_Template {
    return new Notetype_Template({
        name,
        config: new Notetype_Template_Config({
            id: randomId(),
            qFormat: qfmt,
            aFormat: afmt,
        }),
    });
}

/** `add_template`: appended, so its ordinal is assigned on save. */
export function addTemplate(notetype: Notetype, template: Notetype_Template): void {
    notetype.templates.push(template);
}

/** `remove_template`; a notetype keeps at least one. */
export function removeTemplate(notetype: Notetype, index: number): void {
    if (notetype.templates.length < 2) {
        throw new Error("must have 1 template");
    }
    notetype.templates.splice(index, 1);
}

/** `reposition_template`. */
export function repositionTemplate(notetype: Notetype, from: number, to: number): void {
    moveItem(notetype.templates, from, to);
}

/** `onRename` in clayout.py strips quotes and ignores blank names; true when renamed. */
export function renameTemplate(notetype: Notetype, index: number, text: string): boolean {
    const name = text.replace(/"/g, "");
    if (!name.trim()) {
        return false;
    }
    notetype.templates[index].name = name;
    return true;
}

/** `_newCardName`: "Card N" for the first N not in use. */
export function newTemplateName(notetype: Notetype): string {
    const names = new Set(notetype.templates.map((t) => t.name));
    let n = notetype.templates.length + 1;
    for (;;) {
        const name = withoutUnicodeIsolation(tr.cardTemplatesCard({ val: n }));
        if (!names.has(name)) {
            return name;
        }
        n += 1;
    }
}

/** `_flipQA` with src == dst: swap the sides around `<hr id=answer>`.
 * False when the separator is missing. */
export function flipTemplate(template: Notetype_Template): boolean {
    const config = template.config;
    if (!config) {
        return false;
    }
    const match = /^([\s\S]+)<hr id=answer>([\s\S]+)$/.exec(config.aFormat);
    if (!match) {
        return false;
    }
    const front = config.qFormat;
    config.aFormat = `{{FrontSide}}\n\n<hr id=answer>\n\n${front}`;
    config.qFormat = match[2].trim();
    return true;
}

/** `_fieldsOnTemplate`: the fields a template shows, for the card type list. */
export function fieldsOnTemplate(fmt: string): string {
    const withoutComments = fmt.replace(/<!--[\s\S]*?-->/g, "");
    const matches = withoutComments.match(/{{[^#/}]+?}}/g) ?? [];
    let charsAllowed = 30;
    const names: string[] = [];
    for (const raw of matches) {
        const parts = raw.replace(/[{}]/g, "").split(":");
        const name = parts[parts.length - 1];
        if (name === "FrontSide") {
            continue;
        }
        names.push(name);
        charsAllowed -= name.length;
        if (charsAllowed <= 0) {
            break;
        }
    }
    let out = names.join("+");
    if (charsAllowed <= 0) {
        out += "+...";
    }
    return out;
}

/** `_summarizedName`: "1: Card 1: Front -> FrontSide+Back". */
export function templateSummary(index: number, template: Notetype_Template): string {
    const config = template.config;
    return `${index + 1}: ${template.name}: ${fieldsOnTemplate(config?.qFormat ?? "")} -> ${
        fieldsOnTemplate(config?.aFormat ?? "")
    }`;
}

/** `_addField` in clayout.py: the markup appended to a template for a field. */
export function fieldReplacementHtml(field: string, font: string, size: number): string {
    return `\n<div style='font-family: "${font}"; font-size: ${size}px;'>{{${field}}}</div>\n`;
}

/** `onCopyMarkdown`: the template and styling as a Markdown snippet. */
export function templateMarkdown(template: Notetype_Template, css: string): string {
    const sanitize = (text: string): string => text.replace(/```/g, "\\`\\`\\`");
    const config = template.config;
    return `## Front Template\n\`\`\`html\n${sanitize(config?.qFormat ?? "")}\n\`\`\`\n`
        + `## Back Template\n\`\`\`html\n${sanitize(config?.aFormat ?? "")}\n\`\`\`\n`
        + `## Styling\n\`\`\`css\n${sanitize(css)}\n\`\`\`\n`;
}

export interface BrowserAppearance {
    qfmt: string;
    afmt: string;
    /** Null when the notetype's fonts are used. */
    font: { name: string; size: number } | null;
}

/** `onBrowserDisplay`: what the dialog shows for a template. */
export function browserAppearance(template: Notetype_Template): BrowserAppearance {
    const config = template.config;
    return {
        qfmt: config?.qFormatBrowser ?? "",
        afmt: config?.aFormatBrowser ?? "",
        font: config?.browserFontName ? { name: config.browserFontName, size: config.browserFontSize || 12 } : null,
    };
}

/** `onBrowserDisplayOk`. */
export function setBrowserAppearance(template: Notetype_Template, appearance: BrowserAppearance): void {
    const config = template.config;
    if (!config) {
        return;
    }
    config.qFormatBrowser = appearance.qfmt.trim();
    config.aFormatBrowser = appearance.afmt.trim();
    config.browserFontName = appearance.font?.name ?? "";
    config.browserFontSize = appearance.font?.size ?? 0;
}

export function isCloze(notetype: Notetype): boolean {
    return notetype.config?.kind === Notetype_Config_Kind.CLOZE;
}

/** The stock notetypes in the order of `get_stock_notetypes` in stdmodels.py,
 * named as rslib names them (stock.rs). */
export function stockNotetypes(): { kind: StockNotetype_Kind; name: string }[] {
    return [
        { kind: StockNotetype_Kind.BASIC, name: tr.notetypesBasicName() },
        { kind: StockNotetype_Kind.BASIC_AND_REVERSED, name: tr.notetypesBasicReversedName() },
        { kind: StockNotetype_Kind.BASIC_OPTIONAL_REVERSED, name: tr.notetypesBasicOptionalReversedName() },
        { kind: StockNotetype_Kind.BASIC_TYPING, name: tr.notetypesBasicTypeAnswerName() },
        { kind: StockNotetype_Kind.CLOZE, name: tr.notetypesClozeName() },
        { kind: StockNotetype_Kind.IMAGE_OCCLUSION, name: tr.notetypesImageOcclusionName() },
    ];
}

/** `ensure_name_unique` in models.py: another notetype with this name gets
 * a short random suffix appended, as pylib does before the backend would
 * append "+". */
export function ensureNameUnique(
    name: string,
    existing: { id: bigint; name: string }[],
    ownId: bigint,
): string {
    const clash = existing.find((n) => n.name === name && n.id !== ownId);
    if (!clash) {
        return name;
    }
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 5);
    return `${name}-${suffix}`;
}

/** `ModelManager.copy(add=False)` on the legacy JSON form used by
 * addNotetypeLegacy: a clone ready to be added under a new name. */
export function cloneNotetypeJson(notetype: Record<string, unknown>): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(notetype)) as Record<string, unknown>;
    cloned.name = withoutUnicodeIsolation(tr.notetypesCopy({ val: String(notetype.name ?? "") }));
    cloned.id = 0;
    cloned.originalId = null;
    return cloned;
}

const TYPE_FILTER = /\[\[type:.+?\]\]/;

/** `maybeTextInput` in clayout.py: the type-answer box shown in the preview,
 * with `comparison` (compare_answer("example", "sample")) on the back. */
export function previewTypeAnswer(html: string, side: "question" | "answer", comparison: string): string {
    if (!html.includes("[[type:")) {
        return html;
    }
    const withoutHr = html.replace("<hr id=answer>", "");
    const hadHr = withoutHr.length !== html.length;
    let replacement: string;
    if (side === "question") {
        replacement = "<center><input id='typeans' type=text value='example' readonly='readonly'></center>";
    } else {
        replacement = hadHr ? `<hr id=answer>${comparison}` : comparison;
    }
    const out = withoutHr.replace(TYPE_FILTER, () => replacement);
    const warning = `<center><b>${tr.cardTemplatesTypeBoxesWarning()}</b></center>`;
    return out.replace(new RegExp(TYPE_FILTER.source, "g"), () => warning);
}

function moveItem<T>(items: T[], from: number, to: number): void {
    if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
        return;
    }
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
}
