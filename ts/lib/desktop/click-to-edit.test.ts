// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { fieldIndexForText, fieldText, isInteractiveTarget } from "./click-to-edit";

describe("click to edit", () => {
    const fields = ["<b>Question 3</b><br>What is the capital of country 3?", "City 3", ""];

    it("strips markup for comparison", () => {
        expect(fieldText(fields[0])).toBe("Question 3 What is the capital of country 3?");
        expect(fieldText("a&nbsp;b<br/>")).toBe("a b");
    });

    it("finds the field a clicked piece of text came from", () => {
        expect(fieldIndexForText(fields, "City 3")).toBe(1);
        expect(fieldIndexForText(fields, "capital of country 3")).toBe(0);
        // A click on a wrapper holding a whole field plus template text.
        expect(fieldIndexForText(fields, "Answer: City 3")).toBe(1);
    });

    it("prefers the shortest field containing the text", () => {
        expect(fieldIndexForText(["Paris is big", "Paris"], "Paris")).toBe(1);
    });

    it("gives up on empty, unmatched or blank-field clicks", () => {
        expect(fieldIndexForText(fields, "   ")).toBeNull();
        expect(fieldIndexForText(fields, "Show Answer")).toBeNull();
        expect(fieldIndexForText(["", ""], "anything")).toBeNull();
    });

    it("leaves controls alone", () => {
        expect(isInteractiveTarget("A")).toBe(true);
        expect(isInteractiveTarget("span", ["div", "button"])).toBe(true);
        expect(isInteractiveTarget("span", ["div"])).toBe(false);
    });
});
