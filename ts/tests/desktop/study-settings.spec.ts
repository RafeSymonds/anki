// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The deck overview explains how the deck is scheduled, and Adjust studying
 * changes it in the same words. Every test puts the deck back on the seeded
 * settings so the specs that follow see what they expect.
 */

import { expect, type Page, test } from "@playwright/test";

async function openOverview(page: Page): Promise<void> {
    await page.goto("/");
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
    await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Adjust studying" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Standard" })).toBeVisible({ timeout: 10_000 });
}

/** Put the shared preset back where the seed left it. */
async function restore(page: Page): Promise<void> {
    await openOverview(page);
    await openSettings(page);
    await page.getByRole("button", { name: "Standard" }).click();
    await page.getByRole("button", { name: "No limit", exact: true }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("study settings", () => {
    test.afterEach(async ({ page }) => {
        await restore(page);
    });

    test("the overview explains the deck without any daily limit", async ({ page }) => {
        await openOverview(page);
        await expect(page.getByRole("heading", { name: "How this deck is scheduled" })).toBeVisible();
        await expect(page.getByText(/cards a day/)).toHaveCount(0);
        await expect(page.getByText(/reviews a day/)).toHaveCount(0);
        await openSettings(page);
        await expect(page.getByRole("heading", { name: "How much a day" })).toHaveCount(0);
        await page.getByRole("button", { name: "Cancel" }).click();
    });

    test("the learning pace and session length are stored too", async ({ page }) => {
        await openOverview(page);
        await openSettings(page);
        await page.getByRole("button", { name: "Over the first day" }).click();
        await expect(
            page.getByText("Again after 10 minutes, then 1 hour, then 1 day."),
        ).toBeVisible();
        await page.getByRole("button", { name: "10 min", exact: true }).click();
        await expect(page.getByText(/After 10 minutes, Anki asks/)).toBeVisible();
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);

        await openOverview(page);
        await openSettings(page);
        await expect(page.getByRole("button", { name: "Over the first day" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await expect(page.getByRole("button", { name: "10 min", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await page.getByRole("button", { name: "Cancel" }).click();
    });

    test("cancelling changes nothing", async ({ page }) => {
        await openOverview(page);
        await openSettings(page);
        await page.getByRole("button", { name: "Over the first day" }).click();
        await page.getByRole("button", { name: "Cancel" }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await openSettings(page);
        await expect(page.getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "Cancel" }).click();
    });
});
