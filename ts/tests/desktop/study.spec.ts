// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "@playwright/test";

test.describe("deck list and study", () => {
    test("shows the seeded decks with counts", async ({ page }) => {
        await page.goto("/");
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        const sidebar = page.locator("nav.sidebar");
        await expect(sidebar.locator(".row", { hasText: "Default" })).toBeVisible();
        await expect(sidebar.locator(".row", { hasText: "Demo" })).toBeVisible();
        // The sidebar count matches the overview's count for the same deck.
        const sidebarNew = await sidebar.locator(".row", { hasText: "Default" }).locator(".count.new").innerText();
        expect(Number(sidebarNew)).toBeGreaterThan(0);
        await expect(page.locator(".overview .new-count")).toHaveText(sidebarNew);
        // The deck name must not be truncated.
        const name = sidebar.locator(".row", { hasText: "Default" }).locator(".name");
        const box = await name.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(40);
    });

    test("answers a card and moves to the next one", async ({ page }) => {
        await page.goto("/");
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.getByRole("button", { name: "Study Now" }).click();

        const card = page.frameLocator("iframe[title=card]").locator("#qa");
        await expect(card).toContainText("What is the capital of country");
        const firstQuestion = (await card.innerText()).trim();

        await page.keyboard.press("Space");
        await expect(page.locator("button.ease3")).toBeVisible();
        await expect(card).toContainText("City");
        // Intervals come from rslib's scheduler.
        await expect(page.locator("button.ease1 .interval")).not.toHaveText("");

        await page.locator("button.ease3").click();
        await expect(page.getByRole("button", { name: /Show Answer/ })).toBeVisible();
        expect((await card.innerText()).trim()).not.toBe(firstQuestion);
    });

    test("shows how many cards are left and counts down when one graduates", async ({ page }) => {
        await page.goto("/");
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.getByRole("button", { name: "Study Now" }).click();
        const remaining = page.locator(".reviewer .remaining");
        await expect(remaining).toHaveText(/^\d+ left$/);
        const before = Number((await remaining.innerText()).split(" ")[0]);
        expect(before).toBeGreaterThan(1);

        const showAnswer = page.locator("button.show-answer");
        await expect(showAnswer).toBeVisible();
        await showAnswer.click();
        // Still shown on the answer side, and every button carries its interval.
        await expect(remaining).toHaveText(`${before} left`);
        for (const ease of [1, 2, 3, 4]) {
            await expect(page.locator(`button.ease${ease} .interval`)).not.toHaveText("");
        }
        // Easy graduates a new card, so it is no longer due today.
        await page.locator("button.ease4").click();
        await expect(remaining).toHaveText(`${before - 1} left`);
    });

    test("undo brings the answered card back", async ({ page }) => {
        await page.goto("/");
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.getByRole("button", { name: "Study Now" }).click();
        const card = page.frameLocator("iframe[title=card]").locator("#qa");
        await expect(card).toContainText("Question");
        const firstQuestion = (await card.innerText()).trim();

        await page.keyboard.press("Space");
        await page.locator("button.ease3").click();
        await expect(page.getByRole("button", { name: /Show Answer/ })).toBeVisible();
        expect((await card.innerText()).trim()).not.toBe(firstQuestion);

        await page.getByRole("button", { name: "Undo" }).click();
        await expect(card).toHaveText(firstQuestion, { useInnerText: true });
    });

    test("opens and closes deck options", async ({ page }) => {
        await page.goto("/");
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.getByRole("button", { name: "Options" }).first().click();
        const options = page.frameLocator("iframe[title=page]");
        await expect(options.getByRole("heading", { name: "Daily Limits" }).first()).toBeVisible({ timeout: 20_000 });
        await page.getByRole("button", { name: /Close/ }).click();
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
    });
});
