// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Updating from GitHub. `--serve` has no app bundle to replace, so the host
 * answers "unsupported" for real and the rest stubs its answers; the swap
 * itself is covered by the steps under "Updates" in desktop/README.md.
 */

import { expect, type Page, test } from "@playwright/test";

const notice = (page: Page) => page.locator(".update-notice");

async function hostHasUpdate(page: Page): Promise<void> {
    await page.route(
        "**/_desktop/checkForUpdate",
        (route) => route.fulfill({ json: { status: "available", version: "9.9.9" } }),
    );
}

test.describe("updates", () => {
    test("a copy that cannot update shows nothing, and the menu says why", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Get shared decks" })).toBeVisible();
        await expect(notice(page)).toHaveCount(0);

        await page.evaluate(() =>
            (window as unknown as { __ankiMenu: (id: string) => void }).__ankiMenu("check_updates")
        );
        await expect(page.locator(".toast")).toContainText("installed app");
    });

    test("the sidebar takes an update from offer to restart", async ({ page }) => {
        await hostHasUpdate(page);
        await page.route("**/_desktop/downloadUpdate", (route) => route.fulfill({ json: null }));
        await page.route("**/_desktop/restartToUpdate", (route) => route.fulfill({ json: null }));

        await page.goto("/");
        await expect(notice(page)).toContainText("Anki 9.9.9 is available");

        await notice(page).getByRole("button", { name: "Update" }).click();
        const restart = notice(page).getByRole("button", { name: "Restart to update" });
        await expect(restart).toBeVisible();
        await expect(notice(page)).toContainText("Anki 9.9.9 is ready");

        const [request] = await Promise.all([
            page.waitForRequest((req) => req.url().includes("/_desktop/restartToUpdate")),
            restart.click(),
        ]);
        expect(request.method()).toBe("POST");
        await expect(notice(page)).toContainText("Restarting");
    });

    test("a failed download says why and can be tried again", async ({ page }) => {
        await hostHasUpdate(page);
        await page.route(
            "**/_desktop/downloadUpdate",
            (route) => route.fulfill({ status: 400, body: "the signature does not match" }),
        );

        await page.goto("/");
        await notice(page).getByRole("button", { name: "Update" }).click();
        await expect(page.locator(".toast")).toContainText("the signature does not match");
        await expect(notice(page).getByRole("button", { name: "Update" })).toBeVisible();
    });

    test("a failed install leaves the app running and able to quit", async ({ page }) => {
        await hostHasUpdate(page);
        await page.route("**/_desktop/downloadUpdate", (route) => route.fulfill({ json: null }));
        await page.route(
            "**/_desktop/restartToUpdate",
            (route) => route.fulfill({ status: 400, body: "permission denied" }),
        );
        // Answered here so the shared server survives the quit this test asks for.
        await page.route("**/_desktop/quit", (route) => route.fulfill({ json: null }));

        await page.goto("/");
        await notice(page).getByRole("button", { name: "Update" }).click();
        await notice(page).getByRole("button", { name: "Restart to update" }).click();
        await expect(page.locator(".toast")).toContainText("permission denied");
        await expect(notice(page).getByRole("button", { name: "Restart to update" })).toBeVisible();

        const [quit] = await Promise.all([
            page.waitForRequest((req) => req.url().includes("/_desktop/quit")),
            page.evaluate(() => (window as unknown as { __ankiBeforeQuit: () => Promise<void> }).__ankiBeforeQuit()),
        ]);
        expect(quit.method()).toBe("POST");
    });
});
