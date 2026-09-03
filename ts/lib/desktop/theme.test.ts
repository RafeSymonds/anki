// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import { applyDesktopTheme, THEME_CSS, THEME_STYLE_ID } from "./theme";

/** Every token the stylesheet defines for the light theme. */
function tokensIn(block: string): string[] {
    return [...block.matchAll(/(--[a-z0-9-]+):/g)].map((match) => match[1]);
}

describe("the theme stylesheet", () => {
    test("defines the same tokens in both themes", () => {
        const light = THEME_CSS.slice(
            THEME_CSS.indexOf(":root:root {"),
            THEME_CSS.indexOf(":root:root.night-mode"),
        );
        const dark = THEME_CSS.slice(
            THEME_CSS.indexOf(":root:root.night-mode"),
            THEME_CSS.indexOf("@media"),
        );
        const colorTokens = (block: string) =>
            tokensIn(block)
                .filter((name) => !name.startsWith("--app-font"))
                .filter((name) => !["--font-size", "--transition"].includes(name))
                .filter((name) => !name.startsWith("--border-radius"))
                .filter((name) => !name.startsWith("--app-radius"))
                .filter((name) => !["--app-gap", "--app-pane-pad"].includes(name))
                .sort();
        expect(colorTokens(dark)).toEqual(colorTokens(light));
        expect(colorTokens(light).length).toBeGreaterThan(30);
    });

    test("outranks the tokens the app's own stylesheet defines at :root", () => {
        // The sheet is inserted first, so it needs the higher specificity.
        expect(THEME_CSS).toContain(":root:root {");
        expect(THEME_CSS).not.toMatch(/(^|\n):root \{/);
    });

    test("keeps the dark values for a system dark preference", () => {
        const media = THEME_CSS.slice(THEME_CSS.indexOf("@media"));
        expect(media).toContain("prefers-color-scheme: dark");
        expect(media).toContain("--canvas: #15171c");
    });

    test("colours the states apart from each other", () => {
        for (const token of ["--state-new", "--state-learn", "--state-review"]) {
            expect(THEME_CSS).toContain(`${token}:`);
        }
    });
});

describe("applying the theme", () => {
    test("adds one style element and reuses it", () => {
        const doc = document.implementation.createHTMLDocument("test");
        applyDesktopTheme(doc);
        applyDesktopTheme(doc);
        const styles = doc.querySelectorAll(`#${THEME_STYLE_ID}`);
        expect(styles.length).toBe(1);
        expect(styles[0].textContent).toBe(THEME_CSS);
        // First in the head, so a page's own styles still win.
        expect(doc.head.firstChild).toBe(styles[0]);
    });

    test("ignores a document that is not there", () => {
        expect(() => applyDesktopTheme(null)).not.toThrow();
        expect(() => applyDesktopTheme(undefined)).not.toThrow();
    });
});
