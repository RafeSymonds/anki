// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Practice all cards goes over a deck again and again without touching the
 * schedule. The specs share one collection, so counts are compared with what
 * they were, not with fixed numbers.
 */

import { expect, type Page, test } from "@playwright/test";

async function overviewCounts(page: Page): Promise<string[]> {
    return Promise.all(
        [".new-count", ".learn-count", ".review-count"].map((count) => page.locator(`.overview ${count}`).innerText()),
    );
}

async function openDeck(page: Page): Promise<void> {
    await page.goto("/");
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
    await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
}

test.describe("practice", () => {
    test("repeats every card, round after round, and leaves the schedule alone", async ({ page }) => {
        const calls: string[] = [];
        page.on("request", (request) => {
            calls.push(new URL(request.url()).pathname);
        });
        await openDeck(page);
        const before = await overviewCounts(page);

        await page.getByRole("button", { name: "Practice all cards" }).click();
        const remaining = page.locator(".reviewer .remaining");
        await expect(remaining).toHaveText(/^\d+ left$/);
        await expect(page.getByText("Practice, round 1.")).toBeVisible();
        const total = Number((await remaining.innerText()).split(" ")[0]);
        expect(total).toBeGreaterThan(1);

        const card = page.frameLocator("iframe[title=card]").locator("#qa");
        const seen = new Set<string>();
        for (let i = total; i > 0; i--) {
            await expect(remaining).toHaveText(`${i} left`);
            await expect(page.locator("button.show-answer")).toBeVisible();
            seen.add((await card.innerText()).trim());
            await page.keyboard.press("Space");
            await expect(page.locator("button.ease3")).toBeVisible();
            await page.keyboard.press("3");
        }
        // Every card came up, and the next round starts over with all of them.
        expect(seen.size).toBe(total);
        await expect(page.getByText("Practice, round 2.")).toBeVisible();
        await expect(remaining).toHaveText(`${total} left`);

        await page.getByRole("button", { name: /Decks/ }).click();
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
        expect(await overviewCounts(page)).toEqual(before);
        expect(calls.filter((path) => path.endsWith("/answerCard"))).toEqual([]);
    });

    test("Again brings the card back and only Again and Good are offered", async ({ page }) => {
        await openDeck(page);
        await page.getByRole("button", { name: "Practice all cards" }).click();
        const remaining = page.locator(".reviewer .remaining");
        await expect(remaining).toHaveText(/^\d+ left$/);
        const left = await remaining.innerText();

        await page.keyboard.press("Space");
        await expect(page.locator("button.ease1 .interval")).toHaveText("Soon");
        await expect(page.locator("button.ease3 .interval")).toHaveText("Next round");
        await expect(page.locator("button.ease2")).toHaveCount(0);
        await expect(page.locator("button.ease4")).toHaveCount(0);

        // Keys for the answers practice does not take do nothing.
        await page.keyboard.press("4");
        await expect(page.locator("button.ease3")).toBeVisible();

        await page.locator("button.ease1").click();
        await expect(page.locator("button.show-answer")).toBeVisible();
        await expect(remaining).toHaveText(left);
    });

    test("studying afterwards goes back to the scheduler's four answers", async ({ page }) => {
        await openDeck(page);
        await page.getByRole("button", { name: "Practice all cards" }).click();
        await expect(page.getByText("Practice, round 1.")).toBeVisible();
        await page.getByRole("button", { name: /Decks/ }).click();

        await page.getByRole("button", { name: "Study Now" }).click();
        await expect(page.locator("button.show-answer")).toBeVisible();
        await expect(page.getByText(/Practice, round/)).toHaveCount(0);
        await page.keyboard.press("Space");
        for (const ease of [1, 2, 3, 4]) {
            await expect(page.locator(`button.ease${ease}`)).toBeVisible();
        }
    });
});
