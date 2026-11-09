// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "@playwright/test";

test.describe("tools", () => {
    test("opens the statistics page", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Statistics" }).click();
        const graphs = page.frameLocator("iframe[title=page]");
        await expect(graphs.getByText("Future Due", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
        await page.getByRole("button", { name: /Close/ }).click();
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
    });

    test("custom study has no limits to raise", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Custom Study" }).click();
        const dialog = page.getByRole("dialog", { name: "Custom Study" });
        await expect(dialog.getByRole("radio", { name: "Review forgotten cards" })).toBeChecked();
        await expect(dialog.getByRole("radio", { name: /card limit/ })).toHaveCount(0);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toHaveCount(0);
    });

    test("creates a filtered deck from the dialog", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
        await page.keyboard.press("f");
        const dialog = page.getByRole("dialog", { name: /Options for/ });
        const name = dialog.getByPlaceholder(/Filtered Deck/);
        await expect(name).toBeVisible();
        // Unique per run: the suite passes over one collection twice.
        const deckName = `Cram ${Date.now() % 100000}`;
        await name.fill(deckName);
        // The suggested search is `deck:"Default" is:due`; nothing is due in
        // the seeded collection, so take every card of the deck instead.
        const search = dialog.locator("fieldset").first().getByRole("textbox");
        await expect(search).toHaveValue(/is:due/);
        await search.fill("deck:\"Default\"");
        await dialog.getByRole("button", { name: "Build" }).click();
        await expect(dialog).toHaveCount(0);

        const row = page.locator("nav.sidebar .row", { hasText: deckName });
        await expect(row).toBeVisible({ timeout: 10_000 });
        await expect(row).toHaveClass(/filtered/);
        await expect(row).toHaveClass(/current/);
        await expect(page.locator(".overview h1")).toHaveText(deckName);
        await expect(page.getByRole("button", { name: "Rebuild" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Empty" })).toBeVisible();
    });

    test("check database reports the result", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
        await page.getByRole("button", { name: "Tools" }).click();
        await page.getByRole("menuitem", { name: "Check Database" }).click();
        await expect(page.locator(".toast")).toContainText("Database rebuilt", { timeout: 30_000 });
    });

    test("study deck switcher selects a deck by typing", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
        await page.keyboard.press("/");
        const dialog = page.getByRole("dialog", { name: "Study Deck" });
        await dialog.getByRole("textbox").fill("dem");
        await expect(dialog.getByRole("option")).toHaveCount(1);
        await page.keyboard.press("Enter");
        await expect(dialog).toHaveCount(0);
        await expect(page.locator(".overview h1")).toHaveText("Demo");
    });
});
