// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Get Shared Decks: the screen that makes other people's decks findable.
 * The harness points ANKI_DOWNLOADS_DIR at out/anki-e2e-downloads, which
 * holds one example deck file (see bin/anki).
 */

import { expect, type Page, test } from "@playwright/test";

/** Links open in the user's browser through the host, not in the shell. */
async function linkOpenedBy(page: Page, action: () => Promise<void>): Promise<string> {
    const [request] = await Promise.all([
        page.waitForRequest((req) => req.url().includes("/_desktop/openLink")),
        action(),
    ]);
    return request.postData() ?? "";
}

test.describe("get shared decks", () => {
    test("the sidebar leads to the screen, which explains the three steps", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Get shared decks" }).click();

        await expect(page.getByRole("heading", { name: "Get shared decks" })).toBeVisible();
        await expect(page.getByText("Find a deck on AnkiWeb")).toBeVisible();
        await expect(page.getByText("Press Download on the deck's page")).toBeVisible();
        await expect(page.getByText("Come back here and import it")).toBeVisible();

        const url = await linkOpenedBy(page, () => page.getByRole("button", { name: "Open AnkiWeb" }).click());
        expect(url).toBe("https://ankiweb.net/shared/decks");
    });

    test("a subject opens the AnkiWeb list filtered to it", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Get shared decks" }).click();
        const url = await linkOpenedBy(page, () => page.getByRole("button", { name: /Japanese/ }).click());
        expect(url).toBe("https://ankiweb.net/shared/decks?search=japanese");
    });

    test("deck files already downloaded are offered for import", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Get shared decks" }).click();
        const file = page.locator(".downloads .files li", { hasText: "Example Shared Deck" });
        await expect(file).toBeVisible();
        // The name loses its extension and the line says how big and how old.
        await expect(file.locator(".name")).toHaveText("Example Shared Deck");
        await expect(file.locator(".meta")).toContainText("downloaded");
        await expect(file.getByRole("button", { name: "Import" })).toBeVisible();
    });

    test("the sidebar + menu and the Tools menu both reach it", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "More ways to get decks" }).click();
        await page.getByRole("menuitem", { name: /Get Shared Decks/ }).click();
        await expect(page.getByRole("heading", { name: "Get shared decks" })).toBeVisible();
        await page.getByRole("button", { name: /Close/ }).click();

        await page.getByRole("button", { name: /Tools/ }).click();
        await page.getByRole("menuitem", { name: /Get Shared Decks/ }).click();
        await expect(page.getByRole("heading", { name: "Get shared decks" })).toBeVisible();
        await page.getByRole("button", { name: /Close/ }).click();
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
    });
});
