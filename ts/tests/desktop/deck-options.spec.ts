// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "@playwright/test";

test("deck options open on the essentials and can show everything", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Options" }).first().click();
    const options = page.frameLocator("iframe[title=page]");
    await expect(options.getByRole("tab", { name: "Essentials" })).toBeVisible({ timeout: 20_000 });
    // Essentials hides the long tail of sections.
    await expect(options.getByRole("heading", { name: "Auto Advance" })).toHaveCount(0);

    await options.getByRole("tab", { name: "Advanced" }).click();
    await expect(options.getByRole("heading", { name: "Auto Advance" }).first()).toBeVisible();
    await expect(options.getByRole("heading", { name: "Burying" }).first()).toBeVisible();
    // There are no daily limits to set, in either view.
    await expect(options.getByRole("heading", { name: "Daily Limits" })).toHaveCount(0);

    await options.getByRole("tab", { name: "Essentials" }).click();
    await expect(options.getByRole("heading", { name: "Auto Advance" })).toHaveCount(0);
    await page.getByRole("button", { name: /Close/ }).click();
    await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
});
