// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "@playwright/test";

// Headless engines have no microphone: answer getUserMedia with a synthetic
// tone so the real MediaRecorder and the save path are exercised.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const fake = async (): Promise<MediaStream> => {
            const context = new AudioContext();
            const oscillator = context.createOscillator();
            const destination = context.createMediaStreamDestination();
            oscillator.connect(destination);
            oscillator.start();
            await context.resume();
            return destination.stream;
        };
        Object.defineProperty(navigator, "mediaDevices", {
            value: { getUserMedia: fake },
            configurable: true,
        });
    });
});

test("record audio in the editor saves a file and inserts a sound tag", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add" }).click();
    const editor = page.frameLocator("iframe[title=editor]");
    await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });
    await editor.locator(".chooser-button").first().click();
    await editor.locator("button[aria-label=\"Select Basic\"]").click();

    const front = editor
        .locator(".field-container[data-index='0']")
        .locator(".rich-text-editable")
        .locator("anki-editable[contenteditable='true']");
    await front.click();
    await editor.locator("button[title^='Record audio']").click();

    const dialog = page.getByRole("dialog", { name: "Record audio" });
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole("button", { name: "Save" });
    await expect(save).toBeEnabled({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await save.click();

    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expect(front).toContainText(/\[sound:rec\d+\.(m4a|webm|ogg)\]/, { timeout: 15_000 });
});

test("cancelling the recorder inserts nothing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add" }).click();
    const editor = page.frameLocator("iframe[title=editor]");
    await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });
    const front = editor
        .locator(".field-container[data-index='0']")
        .locator(".rich-text-editable")
        .locator("anki-editable[contenteditable='true']");
    await front.click();
    await editor.locator("button[title^='Record audio']").click();
    const dialog = page.getByRole("dialog", { name: "Record audio" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(front).toHaveText("");
});
