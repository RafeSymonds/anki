// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The custom study dialog's logic, ported from qt/aqt/customstudy.py: the
 * spinner bounds for each option (onRadioChange) and the request each one
 * builds (accept).
 */

import type { PlainMessage } from "@bufbuild/protobuf";
import type { CustomStudyDefaultsResponse, CustomStudyRequest } from "@generated/anki/scheduler_pb";
import { CustomStudyRequest_Cram_CramKind } from "@generated/anki/scheduler_pb";
import * as tr from "@generated/ftl";

/** RADIO_FORGOT .. RADIO_CRAM in customstudy.py; there are no limits to raise here. */
export type CustomStudyKind = "forgot" | "ahead" | "preview" | "cram";

/** TYPE_NEW .. TYPE_ALL: the list under the cram option. */
export type CramType = "new" | "due" | "review" | "all";

/** DYN_MAX_SIZE in anki/consts.py. */
export const DYN_MAX_SIZE = 99999;

export interface SpinnerSpec {
    min: number;
    max: number;
    value: number;
}

export const CUSTOM_STUDY_KINDS: CustomStudyKind[] = ["forgot", "ahead", "preview", "cram"];
export const CRAM_TYPES: CramType[] = ["new", "due", "review", "all"];

export function kindLabel(kind: CustomStudyKind): string {
    switch (kind) {
        case "forgot":
            return tr.customStudyReviewForgottenCards();
        case "ahead":
            return tr.customStudyReviewAhead();
        case "preview":
            return tr.customStudyPreviewNewCards();
        case "cram":
            return tr.customStudyStudyByCardStateOrTag();
    }
}

export function cramTypeLabel(type: CramType): string {
    switch (type) {
        case "new":
            return tr.customStudyNewCardsOnly();
        case "due":
            return tr.customStudyDueCardsOnly();
        case "review":
            return tr.customStudyAllReviewCardsInRandomOrder();
        case "all":
            return tr.customStudyAllCardsInRandomOrderDont();
    }
}

export function textBeforeSpinner(kind: CustomStudyKind): string {
    switch (kind) {
        case "forgot":
            return tr.customStudyReviewCardsForgottenInLast();
        case "ahead":
            return tr.customStudyReviewAheadBy();
        case "preview":
            return tr.customStudyPreviewNewCardsAddedInThe();
        case "cram":
            return tr.customStudySelect();
    }
}

/** setTextAfterSpinner in customstudy.py. */
export function textAfterSpinner(kind: CustomStudyKind, value: number): string {
    switch (kind) {
        case "forgot":
        case "ahead":
        case "preview":
            return tr.customStudyDays({ count: value });
        case "cram":
            return tr.customStudyCardsFromTheDeck({ count: value });
    }
}

/** The spinner's range and starting value for an option (onRadioChange). */
export function spinnerFor(kind: CustomStudyKind): SpinnerSpec {
    switch (kind) {
        case "forgot":
            return { min: 1, max: 30, value: 1 };
        case "ahead":
        case "preview":
            return { min: 1, max: DYN_MAX_SIZE, value: 1 };
        case "cram":
            return { min: 1, max: DYN_MAX_SIZE, value: 100 };
    }
}

export function okLabel(kind: CustomStudyKind): string {
    return kind === "cram" ? tr.customStudyChooseTags() : tr.customStudyOk();
}

export function clampSpinner(value: number, spec: SpinnerSpec): number {
    if (Number.isNaN(value)) {
        return spec.value;
    }
    return Math.min(spec.max, Math.max(spec.min, Math.trunc(value)));
}

export interface CramSelection {
    type: CramType;
    include: string[];
    exclude: string[];
}

function cramKind(type: CramType): CustomStudyRequest_Cram_CramKind {
    switch (type) {
        case "new":
            return CustomStudyRequest_Cram_CramKind.NEW;
        case "due":
            return CustomStudyRequest_Cram_CramKind.DUE;
        case "review":
            return CustomStudyRequest_Cram_CramKind.REVIEW;
        case "all":
            return CustomStudyRequest_Cram_CramKind.ALL;
    }
}

/** The request `accept` builds for an option and spinner value. */
export function customStudyRequest(
    deckId: bigint,
    kind: CustomStudyKind,
    value: number,
    cram: CramSelection = { type: "new", include: [], exclude: [] },
): PlainMessage<CustomStudyRequest> {
    switch (kind) {
        case "forgot":
            return { deckId, value: { case: "forgotDays", value } };
        case "ahead":
            return { deckId, value: { case: "reviewAheadDays", value } };
        case "preview":
            return { deckId, value: { case: "previewDays", value } };
        case "cram":
            return {
                deckId,
                value: {
                    case: "cram",
                    value: {
                        kind: cramKind(cram.type),
                        cardLimit: value,
                        tagsToInclude: cram.include,
                        tagsToExclude: cram.exclude,
                    },
                },
            };
    }
}

/** The tag lists TagLimit starts with: tags marked include/exclude last time. */
export function initialTagSelection(
    tags: CustomStudyDefaultsResponse["tags"],
): { include: string[]; exclude: string[] } {
    return {
        include: tags.filter((t) => t.include).map((t) => t.name),
        exclude: tags.filter((t) => t.exclude).map((t) => t.name),
    };
}
