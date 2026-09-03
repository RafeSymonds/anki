// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "@playwright/test";

test("switching to a new profile opens an empty collection and back again", async ({ page }) => {
    await page.goto("/");
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();

    // Unique per run: the suite passes over one data folder twice.
    page.once("dialog", (dialog) => dialog.accept(`Second ${Date.now() % 100000}`));
    await page.getByRole("button", { name: /Tools/ }).click();
    await page.getByRole("menuitem", { name: /Switch Profile/ }).click();
    await page.getByRole("button", { name: /New Profile/ }).click();

    // The new profile has no cards: the welcome panel shows.
    await expect(page.getByRole("heading", { name: "Welcome to Anki" })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /Tools/ }).click();
    await page.getByRole("menuitem", { name: /Switch Profile/ }).click();
    await page.getByRole("option", { name: /^User 1/ }).click();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.locator("nav.sidebar .row", { hasText: "Default" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
});
