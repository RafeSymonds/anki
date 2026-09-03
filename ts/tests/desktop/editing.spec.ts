// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, type FrameLocator, type Locator, type Page, test } from "@playwright/test";

function editorFrame(page: Page): FrameLocator {
    return page.frameLocator("iframe[title=editor]");
}

/** The contenteditable for a field inside the editor frame (see ts/tests/e2e/helpers.ts). */
function editableField(editor: FrameLocator, index: number): Locator {
    return editor
        .locator(`.field-container[data-index="${index}"]`)
        .locator(".rich-text-editable")
        .locator("anki-editable[contenteditable='true']");
}

test.describe("adding and editing notes", () => {
    test("adds a note from the shell and the deck count grows", async ({ page }) => {
        await page.goto("/");
        const sidebar = page.locator("nav.sidebar");
        const defaultRow = sidebar.locator(".row", { hasText: "Default" });
        await expect(defaultRow).toBeVisible();
        const before = Number(await defaultRow.locator(".count.new").innerText());

        await page.getByRole("button", { name: "Add" }).click();
        const editor = editorFrame(page);
        await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });

        const front = editableField(editor, 0);
        const back = editableField(editor, 1);
        await front.click();
        await front.pressSequentially("Shell front");
        await back.click();
        await back.pressSequentially("Shell back");

        await editor.getByRole("button", { name: "Add", exact: true }).click();
        // The editor clears its first field after a successful add.
        await expect(front).toHaveText("", { timeout: 10_000 });

        await expect(defaultRow.locator(".count.new")).toHaveText(String(before + 1), { timeout: 10_000 });

        await page.getByRole("button", { name: /Close/ }).click();
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
    });

    test("edits the current card during review and the card re-renders", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Study Now" }).click();
        const card = page.frameLocator("iframe[title=card]").locator("#qa");
        await expect(card).toContainText("What is the capital of country");

        await page.getByRole("button", { name: "Edit" }).click();
        const editor = editorFrame(page);
        const front = editableField(editor, 0);
        await expect(front).toBeVisible({ timeout: 20_000 });
        await front.click();
        // Put the caret at the very end of the field, past any wrapped line.
        await front.evaluate((el) => {
            const range = el.ownerDocument.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const selection = el.ownerDocument.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
        });
        await front.pressSequentially(" EDITED");

        // Closing saves and redraws the card with the new text.
        await page.locator(".editor-header button").click();
        await expect(card).toContainText("EDITED", { timeout: 10_000 });
        await expect(page.locator("iframe[title=editor]")).toHaveCount(0);
    });
});
