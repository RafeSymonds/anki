// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { type APIRequestContext, expect, test } from "@playwright/test";

const KEY = "firstCardGuideShown";

async function setGuideShown(request: APIRequestContext, value: boolean): Promise<void> {
    const response = await request.post("/_desktop/settingsSet", {
        data: JSON.stringify({ scope: "profile", key: KEY, value }),
    });
    expect(response.ok()).toBe(true);
}

test("the first answer shows a one-time guide to the four buttons", async ({ page, request }) => {
    // The seeded test profile has the guide marked as shown; undo that.
    await setGuideShown(request, false);

    await page.goto("/");
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
    await page.getByRole("button", { name: "Study Now" }).click();
    await expect(page.locator("button.show-answer")).toBeVisible({ timeout: 20_000 });
    // Question side: no guide yet.
    await expect(page.getByRole("note", { name: "How to answer" })).toHaveCount(0);

    await page.locator("button.show-answer").click();
    const guide = page.getByRole("note", { name: "How to answer" });
    await expect(guide).toBeVisible();
    await expect(guide.locator("li")).toHaveCount(4);
    await expect(guide).toContainText("Again");
    await expect(guide).toContainText("Good");

    await guide.getByRole("button", { name: "Got it" }).click();
    await expect(guide).toHaveCount(0);
    await expect(page.locator("button.ease3")).toBeVisible();

    // Dismissed for good: the next card, and a fresh page, do not show it.
    await page.locator("button.ease3").click();
    await expect(page.locator("button.show-answer")).toBeVisible();
    await page.locator("button.show-answer").click();
    await expect(page.locator("button.ease3")).toBeVisible();
    await expect(page.getByRole("note", { name: "How to answer" })).toHaveCount(0);

    await page.goto("/");
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
    await page.getByRole("button", { name: "Study Now" }).click();
    await page.locator("button.show-answer").click({ timeout: 20_000 });
    await expect(page.locator("button.ease3")).toBeVisible();
    await expect(page.getByRole("note", { name: "How to answer" })).toHaveCount(0);
});

test("answering with a key dismisses the guide too", async ({ page, request }) => {
    await setGuideShown(request, false);
    await page.goto("/");
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
    await page.getByRole("button", { name: "Study Now" }).click();
    await page.locator("button.show-answer").click({ timeout: 20_000 });
    await expect(page.getByRole("note", { name: "How to answer" })).toBeVisible();
    await page.keyboard.press("3");
    await expect(page.locator("button.show-answer")).toBeVisible();
    await page.locator("button.show-answer").click();
    await expect(page.locator("button.ease3")).toBeVisible();
    await expect(page.getByRole("note", { name: "How to answer" })).toHaveCount(0);
});
