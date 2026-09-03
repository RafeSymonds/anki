// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Rendering a template that has not been saved yet into the card layout
 * preview: `_renderPreview` and `ephemeral_card` in clayout.py, on top of
 * renderUncommittedCard and the same text preparation the reviewer uses.
 */

import type { AVTag } from "@generated/anki/card_rendering_pb";
import type { Note } from "@generated/anki/notes_pb";
import type { Notetype, Notetype_Template } from "@generated/anki/notetypes_pb";
import { compareAnswer, encodeIriPaths, extractAvTags, renderUncommittedCard } from "@generated/backend";

import { avRefsToPlayIcons, bodyClassesForCard, nodesToText, withStyle } from "../card-html";
import { previewTypeAnswer } from "./notetypes";

export type PreviewSide = "question" | "answer";

export interface PreviewArgs {
    note: Note;
    /** The notetype being edited; its stylesheet replaces the stored one. */
    notetype: Notetype;
    template: Notetype_Template;
    /** The template index, or the cloze number - 1 for cloze notetypes. */
    ord: number;
    side: PreviewSide;
    fillEmpty: boolean;
    nightMode: boolean;
}

export interface RenderedPreview {
    html: string;
    bodyClass: string;
    avTags: AVTag[];
}

export async function renderPreview(args: PreviewArgs): Promise<RenderedPreview> {
    const output = await renderUncommittedCard({
        note: args.note,
        cardOrd: args.ord,
        template: args.template,
        fillEmpty: args.fillEmpty,
        partialRender: false,
    });
    const nodes = args.side === "question" ? output.questionNodes : output.answerNodes;
    const extracted = await extractAvTags({
        text: nodesToText(nodes),
        questionSide: args.side === "question",
    });
    let text = avRefsToPlayIcons((await encodeIriPaths({ val: extracted.text })).val);
    if (text.includes("[[type:")) {
        const comparison = await compareAnswer({ expected: "example", provided: "sample", combining: true });
        text = previewTypeAnswer(text, args.side, comparison.val);
    }
    return {
        html: withStyle(args.notetype.config?.css ?? "", text),
        bodyClass: bodyClassesForCard(args.ord, args.nightMode),
        avTags: extracted.avTags,
    };
}
