// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// The sync sheet without an account: opening, cancelling and validation.
// Nothing here talks to AnkiWeb; the seeded collection has no credentials,
// so the flow stops at the login sheet.

import { expect, type Page, test } from "@playwright/test";

async function profileSetting(page: Page, key: string): Promise<unknown> {
    return await page.evaluate(async (key) => {
        const response = await fetch("/_desktop/settingsGet", {
            method: "POST",
            body: JSON.stringify({ scope: "profile", key }),
        });
        return await response.json();
    }, key);
}

test.describe("sync", () => {
    test("opens the login sheet, cancels, and nothing changes", async ({ page }) => {
        await page.goto("/");
        const sidebar = page.locator("nav.sidebar");
        await expect(sidebar.locator(".row", { hasText: "Default" })).toBeVisible();
        const rowsBefore = await sidebar.locator(".row").allInnerTexts();

        await page.getByRole("button", { name: "Sync" }).click();
        const sheet = page.locator(".sync-sheet");
        await expect(sheet).toBeVisible();
        await expect(sheet.getByText("Account Required")).toBeVisible();
        await expect(sheet.getByLabel("Email:")).toBeFocused();
        await sheet.getByRole("button", { name: "Cancel" }).click();
        await expect(sheet).toHaveCount(0);

        // The Y shortcut opens it too; Escape closes it.
        await page.keyboard.press("y");
        await expect(sheet).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);

        expect(await sidebar.locator(".row").allInnerTexts()).toEqual(rowsBefore);
        expect(await profileSetting(page, "syncKey")).toBeNull();
        expect(await profileSetting(page, "syncUser")).toBeNull();
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
    });

    test("keeps asking while a field is empty and stores nothing", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Sync" }).click();
        const sheet = page.locator(".sync-sheet");
        await sheet.getByLabel("Email:").fill("someone@example.com");
        await sheet.getByRole("button", { name: "Log In" }).click();
        // Re-prompted with the email kept, as the Qt dialog does.
        await expect(sheet.getByLabel("Email:")).toHaveValue("someone@example.com");
        await sheet.getByLabel("Password:").fill("");
        await sheet.getByLabel("Email:").fill("");
        await sheet.getByLabel("Email:").press("Enter");
        await expect(sheet).toHaveCount(0);
        expect(await profileSetting(page, "syncKey")).toBeNull();
        expect(await profileSetting(page, "syncUser")).toBeNull();
    });

    test("the collection can be reopened from the shell and sync errors carry their kind", async ({ page }) => {
        await page.goto("/");
        const reopened = await page.evaluate(async () => {
            const response = await fetch("/_desktop/reopenCollection", { method: "POST", body: "" });
            return response.status;
        });
        expect(reopened).toBe(200);
        // A sync call without auth fails before any network access.
        const failure = await page.evaluate(async () => {
            const response = await fetch("/_anki/syncCollection", { method: "POST", body: new Uint8Array() });
            return { status: response.status, kind: response.headers.get("anki-error-kind") };
        });
        expect(failure).toEqual({ status: 500, kind: "INVALID_INPUT" });
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
    });
});
