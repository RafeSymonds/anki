// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The card frame is a pane inside the shell, not the whole window the Qt
 * webview was. Cards with a big image used to break on that difference:
 * upstream caps images at 95vh, which plus the document's own margins was
 * always taller than the pane, so the prompt under the image fell off the
 * bottom and the jump to the answer then scrolled the top of the image
 * away with nothing to show that it had. desktop/web/card.html sizes them
 * against the pane instead, and fills it with the card's own background.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** A 4:5 image, small on the wire and far taller than any pane. */
const TALL_IMAGE = "data:image/svg+xml;charset=utf-8,"
    + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#888"/></svg>`,
    );

const QUESTION = `<img src="${TALL_IMAGE}"><br>Card frame layout probe`;
const ANSWER = `${QUESTION}<hr id="answer">Probe answer`;

/** Render `html` in the frame the way the reviewer does, and measure it. */
async function render(page: Page, html: string, asAnswer: boolean) {
    await page.goto("/");
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
    await page.getByRole("button", { name: "Study Now" }).click();
    await page.frameLocator("iframe[title=card]").locator("#qa").waitFor();

    return page.evaluate(
        async ([html, asAnswer]) => {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const frame = document.querySelector("iframe[title=card]") as HTMLIFrameElement;
            const w = frame.contentWindow as any;
            if (asAnswer) {
                w._showAnswer(html, "card card1");
            } else {
                w._showQuestion(html, html, "card card1");
            }
            const image = () => w.document.querySelector("#qa img") as HTMLImageElement | null;
            for (let i = 0; i < 100 && !image()?.complete; i++) {
                await new Promise((r) => setTimeout(r, 50));
            }
            // Let the reviewer's own post-image scroll settle first.
            await new Promise((r) => setTimeout(r, 300));
            const root = w.document.documentElement;
            const margin = parseFloat(w.getComputedStyle(w.document.body).marginTop);
            return {
                frameHeight: w.innerHeight,
                documentHeight: root.scrollHeight,
                bodyHeight: w.document.body.getBoundingClientRect().height,
                imageHeight: image()?.getBoundingClientRect().height ?? 0,
                scrollY: w.scrollY,
                margin,
                paneBackground: getComputedStyle(document.querySelector(".card-pane")!)
                    .backgroundColor,
                frameBackground: w.getComputedStyle(root).backgroundColor,
                bodyBackground: w.getComputedStyle(w.document.body).backgroundColor,
            };
        },
        [html, asAnswer] as [string, boolean],
    );
}

test.describe("card frame", () => {
    test("a card fronted by a tall image still shows its prompt", async ({ page }) => {
        const m = await render(page, QUESTION, false);
        // The image is budgeted against the pane, not the window, so it and
        // the document's margins fit with room left for a line of prompt.
        expect(m.imageHeight).toBeLessThanOrEqual(m.frameHeight - 2 * m.margin);
        expect(m.documentHeight - m.frameHeight).toBeLessThan(m.imageHeight);
        // The question is never shown pre-scrolled.
        expect(m.scrollY).toBe(0);
    });

    test("the card's own background covers the pane", async ({ page }) => {
        const m = await render(page, "Card frame background probe", false);
        // A short card used to paint a strip of its colour and leave the
        // rest of the pane showing the frame's ground behind it.
        expect(m.bodyHeight).toBeGreaterThanOrEqual(m.frameHeight - 2 * m.margin);
        expect(m.frameBackground).toBe(m.paneBackground);
        expect(m.bodyBackground).toBe(m.paneBackground);
    });

    test("scrolling to the answer shades the edge it cut", async ({ page }) => {
        const m = await render(page, ANSWER, true);
        expect(m.scrollY).toBeGreaterThan(0);
        const shaded = await page.evaluate(() => {
            const pane = document.querySelector(".card-pane")!;
            return {
                above: pane.classList.contains("cut-above"),
                opacity: getComputedStyle(pane, "::before").opacity,
            };
        });
        expect(shaded.above).toBe(true);
        expect(shaded.opacity).toBe("1");
    });
});
