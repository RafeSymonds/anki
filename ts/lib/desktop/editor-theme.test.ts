// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import { applyEditorStyles, EDITOR_CSS, EDITOR_STYLE_ID } from "./editor-theme";

describe("the editor stylesheet", () => {
    test("only reaches into the editor page", () => {
        const selectors = EDITOR_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
            .split("}")
            .map((block) => block.split("{")[0].trim())
            .filter(Boolean);
        for (const selector of selectors) {
            expect(selector.startsWith(".note-editor")).toBe(true);
        }
    });

    test("takes its colours from the shared tokens", () => {
        const colours = [...EDITOR_CSS.matchAll(/(?:color|background|border-color):\s*([^;]+);/g)]
            .map((match) => match[1].trim())
            .filter((value) => value !== "transparent" && value !== "0");
        expect(colours.length).toBeGreaterThan(4);
        for (const value of colours) {
            expect(value).toMatch(/^var\(--/);
        }
    });

    test("is appended last so it wins ties with the page's own rules", () => {
        const doc = document.implementation.createHTMLDocument("editor");
        doc.head.appendChild(doc.createElement("style"));
        applyEditorStyles(doc);
        applyEditorStyles(doc);
        const styles = doc.querySelectorAll(`#${EDITOR_STYLE_ID}`);
        expect(styles.length).toBe(1);
        expect(doc.head.lastElementChild).toBe(styles[0]);
    });

    test("ignores a document that is not there", () => {
        expect(() => applyEditorStyles(null)).not.toThrow();
    });
});
