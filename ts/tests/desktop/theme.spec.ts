// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * A page opened while the system is dark used to flash white for a frame:
 * the served HTML carried no colours of its own, and the page's script
 * added the night-mode class only once its bundle had run. The host now
 * paints the document and sets the class in the first script of the head
 * (desktop/src/scheme.rs), so these hold before the page's own code runs.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const DARK_GROUND = "rgb(21, 23, 28)";
const LIGHT_GROUND = "rgb(241, 243, 248)";

async function groundOf(page: Page, path: string): Promise<string> {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    return page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
}

test.describe("first paint in dark mode", () => {
    test.use({ colorScheme: "dark" });

    test("the shell is dark before its own styles load", async ({ page }) => {
        expect(await groundOf(page, "/")).toBe(DARK_GROUND);
        expect(
            await page.evaluate(() => document.documentElement.classList.contains("night-mode")),
        ).toBe(true);
    });

    test("an embedded page is dark before its own styles load", async ({ page }) => {
        expect(await groundOf(page, "/deck-options/1")).toBe(DARK_GROUND);
        expect(
            await page.evaluate(() => document.documentElement.classList.contains("night-mode")),
        ).toBe(true);
    });

    test("the card frame is dark, and leaves the text colour to the note type", async ({ page }) => {
        await page.goto("/_desktop/card.html", { waitUntil: "domcontentloaded" });
        const painted = await page.evaluate(() => ({
            html: getComputedStyle(document.documentElement).backgroundColor,
            night: document.documentElement.classList.contains("night-mode"),
        }));
        expect(painted.html).toBe("rgb(29, 32, 39)");
        expect(painted.night).toBe(true);
    });
});

test.describe("first paint in light mode", () => {
    test.use({ colorScheme: "light" });

    test("the shell is on the light ground with no night-mode class", async ({ page }) => {
        expect(await groundOf(page, "/")).toBe(LIGHT_GROUND);
        expect(
            await page.evaluate(() => document.documentElement.classList.contains("night-mode")),
        ).toBe(false);
    });
});
