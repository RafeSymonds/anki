// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "@playwright/test";

test.describe("deck list and study", () => {
    test("shows the seeded decks with counts", async ({ page }) => {
        await page.goto("/");
        const sidebar = page.locator("nav.sidebar");
        await expect(sidebar.locator(".row", { hasText: "Default" })).toBeVisible();
        await expect(sidebar.locator(".row", { hasText: "Demo" })).toBeVisible();
        await expect(sidebar.locator(".row", { hasText: "Default" }).locator(".count.new")).toHaveText("12");
        // The deck name must not be truncated.
        const name = sidebar.locator(".row", { hasText: "Default" }).locator(".name");
        const box = await name.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(40);
    });

    test("answers a card and moves to the next one", async ({ page }) => {
        await page.goto("/");
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

    test("undo brings the answered card back", async ({ page }) => {
        await page.goto("/");
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
        await page.getByRole("button", { name: "Options" }).first().click();
        const options = page.frameLocator("iframe[title=page]");
        await expect(options.getByRole("heading", { name: "Daily Limits" }).first()).toBeVisible({ timeout: 20_000 });
        await page.getByRole("button", { name: /Close/ }).click();
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
    });
});
