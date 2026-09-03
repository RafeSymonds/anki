// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The one-time guide shown over the answer buttons the first time a
 * profile reviews a card: which button means what, and what it does to the
 * next interval. Stored per profile so it appears once.
 */

import type { Ease } from "./reviewer";

export const FIRST_CARD_GUIDE_KEY = "firstCardGuideShown";

export interface AnswerButtonInfo {
    ease: Ease;
    label: string;
    interval: string;
}

export interface GuideRow {
    ease: Ease;
    label: string;
    interval: string;
    explanation: string;
}

const EXPLANATIONS: Record<Ease, string> = {
    1: "You did not remember. The card comes back in a few minutes.",
    2: "You remembered, but it was a struggle. It comes back sooner than Good.",
    3: "You remembered. This is the normal choice.",
    4: "It was too easy. The card waits much longer.",
};

/** One row per answer button, in the order the buttons are shown. */
export function answerGuide(buttons: readonly AnswerButtonInfo[]): GuideRow[] {
    return buttons.map((button) => ({
        ease: button.ease,
        label: button.label,
        interval: button.interval,
        explanation: EXPLANATIONS[button.ease],
    }));
}

/** The stored flag is `true` once the guide has been dismissed. */
export function guideNeeded(stored: unknown): boolean {
    return stored !== true;
}
