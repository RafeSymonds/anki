// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Pure helpers for turning rslib's rendered card into the HTML the reviewer
 * document shows. Ports of pylib's template.py / sound.py and the type-answer
 * filters in qt/aqt/reviewer.py.
 */

import type { RenderedTemplateNode } from "@generated/anki/card_rendering_pb";

/** Concatenate rendered nodes. Add-on filters do not exist here, so any
 * replacement left unrendered shows its field text. */
export function nodesToText(nodes: RenderedTemplateNode[]): string {
    let out = "";
    for (const node of nodes) {
        switch (node.value.case) {
            case "text":
                out += node.value.value;
                break;
            case "replacement":
                out += node.value.value.currentText;
                break;
            default:
                break;
        }
    }
    return out;
}

/** `question_and_style` / `answer_and_style` in pylib. */
export function withStyle(css: string, text: string): string {
    return `<style>${css}</style>${text}`;
}

/** `[anki:play:q:0]` markers left by extract_av_tags. */
export const AV_REF_RE = /\[anki:(play:(.):(\d+))\]/g;

export function stripAvRefs(text: string): string {
    return text.replace(AV_REF_RE, "");
}

/** Same markup as `av_refs_to_play_icons` in qt/aqt/sound.py; the click
 * reaches the shell as a `play:q:N` bridge command. */
export function avRefsToPlayIcons(text: string): string {
    return text.replace(
        AV_REF_RE,
        (_match, command: string) => `
<a class="replay-button soundLink" href=# onclick="pycmd('${command}'); return false;" draggable="false">
    <svg class="playImage" viewBox="0 0 64 64" version="1.1">
        <circle cx="32" cy="32" r="29" />
        <path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z" />
    </svg>
</a>`,
    );
}

/** `[[type:Field]]`, `[[type:cloze:Field]]`, `[[type:nc:Field]]`. */
export const TYPE_ANS_RE = /\[\[type:(.+?)\]\]/;

export interface TypeAnswerSpec {
    fieldName: string;
    /** 1-based cloze ordinal when typing a cloze deletion. */
    clozeOrdinal: number | null;
    /** False for `nc:` fields: compare without combining characters. */
    combining: boolean;
}

export function parseTypeAnswer(text: string, cardOrd: number): TypeAnswerSpec | null {
    const match = TYPE_ANS_RE.exec(text);
    if (!match) {
        return null;
    }
    let fieldName = match[1];
    let clozeOrdinal: number | null = null;
    let combining = true;
    if (fieldName.startsWith("cloze:")) {
        clozeOrdinal = cardOrd + 1;
        fieldName = fieldName.split(":")[1];
    }
    if (fieldName.startsWith("nc:")) {
        combining = false;
        fieldName = fieldName.split(":")[1];
    }
    return { fieldName, clozeOrdinal, combining };
}

export interface TypeAnswerFont {
    font: string;
    size: number;
}

/** Question side: replace the marker with the input box. */
export function typeAnswerInputHtml(text: string, font: TypeAnswerFont): string {
    return text.replace(
        TYPE_ANS_RE,
        `
<center>
<input type=text id=typeans onkeypress="_typeAnsPress();"
   style="font-family: '${font.font}'; font-size: ${font.size}px;">
</center>
`,
    );
}

/** Question side when the field is unknown or empty: show a warning, or nothing. */
export function replaceTypeAnswer(text: string, replacement: string): string {
    return text.replace(TYPE_ANS_RE, replacement);
}

/** Answer side: the comparison rendered by rslib's compare_answer. Port of
 * `typeAnsAnswerFilter`, including the `<hr id=answer>` juggling that keeps
 * the separator above the comparison when {{FrontSide}} is used. */
export function typeAnswerComparisonHtml(text: string, comparison: string, font: TypeAnswerFont): string {
    const original = text;
    const withoutHr = text.replace("<hr id=answer>", "");
    const hadHr = withoutHr.length !== original.length;
    const marker = TYPE_ANS_RE.exec(withoutHr);
    if (hadHr && !marker) {
        return original;
    }
    let replacement = `
<div style="font-family: '${font.font}'; font-size: ${font.size}px">${comparison}</div>`;
    if (hadHr) {
        replacement = `<hr id=answer>${replacement}`;
    }
    return withoutHr.replace(TYPE_ANS_RE, () => replacement);
}

/** `theme_manager.body_classes_for_card_ord`, for macOS. */
export function bodyClassesForCard(cardOrd: number, nightMode: boolean): string {
    const classes = ["card", `card${cardOrd + 1}`, "isMac"];
    if (nightMode) {
        classes.push("nightMode", "night_mode");
    }
    classes.push("fancy");
    return classes.join(" ");
}
