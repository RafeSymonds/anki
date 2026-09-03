// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Rendering the selected card into a card document for the browser's
 * preview, the way `Previewer._render_scheduled` in
 * qt/aqt/browser/previewer.py does it, on top of the same rslib calls the
 * reviewer uses.
 */

import type { Card } from "@generated/anki/cards_pb";
import { encodeIriPaths, extractAvTags, renderExistingCard } from "@generated/backend";

import { avPlayer } from "../audio";
import { avRefsToPlayIcons, bodyClassesForCard, nodesToText, withStyle } from "../card-html";
import type { CardView } from "../reviewer";

export type PreviewSide = "question" | "answer";

/** `Previewer.type_ans_preview_filter`: the preview has no answer box. */
export function stripTypeAnswer(text: string): string {
    return text.replace(/\[\[type:[^\]]+\]\]/g, "");
}

export interface RenderedPreview {
    question: string;
    answer: string;
    bodyClass: string;
}

export class PreviewRenderer {
    private view: CardView | null = null;
    private nightMode = false;
    private sequence = 0;

    attach(view: CardView): void {
        this.view = view;
    }

    setNightMode(nightMode: boolean): void {
        this.nightMode = nightMode;
    }

    /** Render `card` (or the "select one card" notice) on `side`. */
    async render(card: Card | null, side: PreviewSide, autoplay = true): Promise<void> {
        const view = this.view;
        if (!view) {
            return;
        }
        const sequence = ++this.sequence;
        if (!card) {
            // qt-misc-please-select-1-card; the qt Fluent module is not generated for TS.
            view.showQuestion("(please select 1 card)", "", "");
            return;
        }
        const rendered = await this.renderCard(card, side, autoplay);
        if (sequence !== this.sequence) {
            return;
        }
        if (side === "question") {
            view.showQuestion(rendered.question, rendered.answer, rendered.bodyClass);
        } else {
            view.showQuestion(rendered.question, rendered.answer, rendered.bodyClass);
            view.showAnswer(rendered.answer);
        }
        view.drawFlag(card.flags & 0b111);
    }

    private async renderCard(card: Card, side: PreviewSide, autoplay: boolean): Promise<RenderedPreview> {
        const output = await renderExistingCard({ cardId: card.id, browser: true, partialRender: false });
        const question = await extractAvTags({ text: nodesToText(output.questionNodes), questionSide: true });
        const answer = await extractAvTags({ text: nodesToText(output.answerNodes), questionSide: false });
        if (autoplay) {
            avPlayer.playTags(side === "question" ? question.avTags : answer.avTags);
        }
        const prepare = async (text: string): Promise<string> =>
            withStyle(output.css, avRefsToPlayIcons((await encodeIriPaths({ val: stripTypeAnswer(text) })).val));
        return {
            question: await prepare(question.text),
            answer: await prepare(answer.text),
            bodyClass: bodyClassesForCard(card.templateIdx, this.nightMode),
        };
    }

    stop(): void {
        this.sequence += 1;
        avPlayer.stop();
    }
}
