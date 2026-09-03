// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The deck overview explains how the deck is scheduled, and Adjust studying
 * changes it in the same words. Every test puts the deck back on the seeded
 * plan (20 new, 200 reviews) so the specs that follow see what they expect.
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
    await expect(page.getByRole("button", { name: "Steady" })).toBeVisible({ timeout: 10_000 });
}

/** Put the shared preset back where the seed left it. */
async function restore(page: Page): Promise<void> {
    await openOverview(page);
    await openSettings(page);
    await page.getByRole("button", { name: "Steady" }).click();
    await page.getByRole("button", { name: "Standard" }).click();
    await page.getByRole("button", { name: "No limit", exact: true }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("study settings", () => {
    test.afterEach(async ({ page }) => {
        await restore(page);
    });

    test("the overview says what the deck's settings mean", async ({ page }) => {
        await openOverview(page);
        await expect(page.getByRole("heading", { name: "How this deck is scheduled" })).toBeVisible();
        await expect(page.getByText(/new cards a day means roughly/)).toBeVisible();
        await expect(page.getByText(/the rest wait until tomorrow/)).toBeVisible();
        await expect(page.getByText(/once your reviews build up/)).toBeVisible();
    });

    test("a lighter plan is saved and shows up on the overview", async ({ page }) => {
        await openOverview(page);
        await openSettings(page);
        await page.getByRole("button", { name: "Gentle" }).click();
        // The consequence line follows the choice before it is saved.
        await expect(page.getByRole("dialog").getByText(/About \d+ minutes a day/)).toBeVisible();
        await page.getByRole("button", { name: "Save" }).click();

        await expect(page.getByText("5 new cards a day", { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/Up to 50 reviews a day/)).toBeVisible();
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
        await page.getByRole("button", { name: "Fast" }).click();
        await page.getByRole("button", { name: "Cancel" }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByText("20 new cards a day", { exact: true })).toBeVisible();
    });
});
