// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { RenderedTemplateNode, RenderedTemplateReplacement } from "@generated/anki/card_rendering_pb";
import { describe, expect, it } from "vitest";

import {
    avRefsToPlayIcons,
    bodyClassesForCard,
    nodesToText,
    parseTypeAnswer,
    replaceTypeAnswer,
    stripAvRefs,
    typeAnswerComparisonHtml,
    typeAnswerInputHtml,
    withStyle,
} from "./card-html";

describe("nodesToText", () => {
    it("joins text nodes and falls back to field text for replacements", () => {
        const nodes = [
            new RenderedTemplateNode({ value: { case: "text", value: "<b>Q</b> " } }),
            new RenderedTemplateNode({
                value: {
                    case: "replacement",
                    value: new RenderedTemplateReplacement({
                        fieldName: "Front",
                        currentText: "field",
                        filters: ["custom"],
                    }),
                },
            }),
        ];
        expect(nodesToText(nodes)).toBe("<b>Q</b> field");
    });

    it("wraps css the way pylib does", () => {
        expect(withStyle(".card{}", "x")).toBe("<style>.card{}</style>x");
    });
});

describe("audio references", () => {
    it("turns play markers into replay buttons that call pycmd", () => {
        const html = avRefsToPlayIcons("a [anki:play:q:0] b [anki:play:a:12]");
        expect(html).toContain(`onclick="pycmd('play:q:0'); return false;"`);
        expect(html).toContain(`onclick="pycmd('play:a:12'); return false;"`);
        expect(html).toContain("class=\"replay-button soundLink\"");
        expect(html).not.toContain("[anki:play");
    });

    it("strips markers when play buttons are hidden", () => {
        expect(stripAvRefs("a [anki:play:q:0] b")).toBe("a  b");
    });
});

describe("type answer", () => {
    it("parses plain, cloze and non-combining specs", () => {
        expect(parseTypeAnswer("x [[type:Back]] y", 0)).toEqual({
            fieldName: "Back",
            clozeOrdinal: null,
            combining: true,
        });
        expect(parseTypeAnswer("[[type:cloze:Text]]", 2)).toEqual({
            fieldName: "Text",
            clozeOrdinal: 3,
            combining: true,
        });
        expect(parseTypeAnswer("[[type:nc:Back]]", 0)).toEqual({
            fieldName: "Back",
            clozeOrdinal: null,
            combining: false,
        });
        expect(parseTypeAnswer("no marker", 0)).toBeNull();
    });

    it("renders the input box on the question side", () => {
        const html = typeAnswerInputHtml("Q [[type:Back]]", { font: "Arial", size: 20 });
        expect(html).toContain("id=typeans");
        expect(html).toContain("font-family: 'Arial'; font-size: 20px;");
        expect(html).not.toContain("[[type:");
        expect(replaceTypeAnswer("Q [[type:Back]]", "")).toBe("Q ");
    });

    it("keeps the answer separator above the comparison", () => {
        const font = { font: "Arial", size: 20 };
        const html = typeAnswerComparisonHtml("<hr id=answer>Back [[type:Back]]", "<code>ok</code>", font);
        expect(html.indexOf("<hr id=answer>")).toBeLessThan(html.indexOf("<code>ok</code>"));
        expect(html.match(/<hr id=answer>/g)).toHaveLength(1);
        expect(html).not.toContain("[[type:");
    });

    it("leaves a FrontSide answer alone when the marker only appeared on the front", () => {
        const font = { font: "Arial", size: 20 };
        const text = "Front<hr id=answer>Back";
        expect(typeAnswerComparisonHtml(text, "x", font)).toBe(text);
    });
});

describe("bodyClassesForCard", () => {
    it("names the card ordinal and theme", () => {
        expect(bodyClassesForCard(0, false)).toBe("card card1 isMac fancy");
        expect(bodyClassesForCard(2, true)).toBe("card card3 isMac nightMode night_mode fancy");
    });
});
