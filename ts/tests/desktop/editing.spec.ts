// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, type FrameLocator, type Locator, type Page, test } from "@playwright/test";

function editorFrame(page: Page): FrameLocator {
    return page.frameLocator("iframe[title=editor]");
}

/** The contenteditable for a field inside the editor frame (see ts/tests/e2e/helpers.ts). */
/** Click the glyphs of the first text node in the card matching `pattern`. */
async function clickCardText(card: Locator, pattern: RegExp): Promise<void> {
    const position = await card.evaluate((qa, source) => {
        const regex = new RegExp(source);
        const walker = qa.ownerDocument.createTreeWalker(qa, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.parentElement?.tagName === "STYLE" || !regex.test(node.textContent ?? "")) {
                continue;
            }
            const range = qa.ownerDocument.createRange();
            range.selectNodeContents(node);
            const rect = range.getClientRects()[0];
            const box = qa.getBoundingClientRect();
            if (rect) {
                return {
                    x: rect.left - box.left + Math.min(rect.width / 2, 20),
                    y: rect.top - box.top + rect.height / 2,
                };
            }
        }
        return null;
    }, pattern.source);
    if (!position) {
        throw new Error(`no card text matching ${pattern}`);
    }
    await card.click({ position });
}

function fieldLabel(editor: FrameLocator, index: number): Locator {
    return editor.locator(`.field-container[data-index="${index}"]`).locator(".label-name");
}

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

        // The editor remembers the last note type and deck; pin both so the
        // second pass over the collection (WebKit after Chromium) starts the
        // same way.
        await editor.locator(".chooser-button").first().click();
        await editor.locator("button[aria-label=\"Select Basic\"]").click();
        await editor.locator(".chooser-button").nth(1).click();
        await editor.locator("button[aria-label=\"Select Default\"]").click();

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

    test("clicking text on the card opens the edit panel on that field", async ({ page }) => {
        await page.goto("/");
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.getByRole("button", { name: "Study Now" }).click();
        const card = page.frameLocator("iframe[title=card]").locator("#qa");
        await expect(card).toContainText("What is the capital of country");
        await page.locator("button.show-answer").click();
        await expect(card).toContainText("City");

        // The answer text comes from the second field.
        await clickCardText(card, /City \d+/);
        const editor = editorFrame(page);
        await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });
        await expect(editableField(editor, 1)).toBeFocused({ timeout: 10_000 });

        // Clicking the question text moves to the first field.
        await clickCardText(card, /What is the capital/);
        await expect(editableField(editor, 0)).toBeFocused({ timeout: 10_000 });
        await page.keyboard.press("Escape");
        await expect(page.locator("iframe[title=editor]")).toHaveCount(0);
    });

    test("the kind picker switches between basic, both directions and fill in the blank", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Add" }).click();
        const editor = editorFrame(page);
        await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });
        const picker = page.getByRole("radiogroup", { name: "Kind of card" });
        await expect(picker).toBeVisible();
        // Reopening starts the picker on the type the editor is showing,
        // rather than on nothing until something is clicked.
        await picker.getByRole("radio", { name: "Basic", exact: true }).click();
        await expect(fieldLabel(editor, 0)).toHaveText("Front", { timeout: 10_000 });
        await page.getByRole("button", { name: /Close/ }).click();
        await page.getByRole("button", { name: "Add" }).click();
        await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });
        await expect(picker.getByRole("radio", { name: "Basic", exact: true })).toHaveAttribute(
            "aria-checked",
            "true",
            { timeout: 10_000 },
        );

        await picker.getByRole("radio", { name: "Fill in the blank" }).click();
        await expect(fieldLabel(editor, 0)).toHaveText("Text", { timeout: 10_000 });
        await expect(picker.getByRole("radio", { name: "Fill in the blank" })).toHaveAttribute("aria-checked", "true");

        // Adding a cloze note without a blank explains how to make one first.
        const front = editableField(editor, 0);
        await front.click();
        await front.pressSequentially("Paris is the capital of France");
        let question = "";
        page.once("dialog", (dialog) => {
            question = dialog.message();
            void dialog.dismiss();
        });
        await editor.getByRole("button", { name: "Add", exact: true }).click();
        await expect.poll(() => question).toContain("No blanks yet");
        await expect(front).toContainText("Paris");

        await picker.getByRole("radio", { name: "Both directions" }).click();
        await expect(fieldLabel(editor, 0)).toHaveText("Front", { timeout: 10_000 });
        await expect(editor.locator(".chooser-button").first()).toContainText("reversed");
        await picker.getByRole("radio", { name: "Basic", exact: true }).click();
        await expect(editor.locator(".chooser-button").first()).toHaveText(/^Basic$/);
        await page.getByRole("button", { name: /Close/ }).click();
    });

    test("the live preview shows the card as it is typed and stays on across reopenings", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Add" }).click();
        const editor = editorFrame(page);
        await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });
        const toggle = page.getByRole("button", { name: "Preview", exact: true });
        if ((await toggle.getAttribute("aria-pressed")) !== "true") {
            await toggle.click();
        }
        const preview = page.locator(".add-preview");
        await expect(preview).toBeVisible();
        await expect(preview).toContainText("Type in a field");

        await page.getByRole("radio", { name: "Basic", exact: true }).click();
        await expect(fieldLabel(editor, 0)).toHaveText("Front", { timeout: 10_000 });
        const front = editableField(editor, 0);
        await front.click();
        await front.pressSequentially("Preview me");
        const question = preview.frameLocator("iframe[title=card]").first().locator("#qa");
        await expect(question).toContainText("Preview me", { timeout: 15_000 });
        await expect(preview).not.toContainText("Type in a field");

        // The choice is remembered for the next time the panel opens.
        // Closing with text typed asks whether to discard it.
        page.once("dialog", (dialog) => void dialog.accept());
        await page.getByRole("button", { name: /Close/ }).click();
        await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
        await page.getByRole("button", { name: "Add" }).click();
        await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await page.getByRole("button", { name: "Preview", exact: true }).click();
        await expect(page.locator(".add-preview")).toHaveCount(0);
        await page.getByRole("button", { name: /Close/ }).click();
    });

    test("edits the current card during review and the card re-renders", async ({ page }) => {
        await page.goto("/");
        await page.locator("nav.sidebar .row", { hasText: "Default" }).click();
        await page.getByRole("button", { name: "Study Now" }).click();
        const card = page.frameLocator("iframe[title=card]").locator("#qa");
        await expect(card).toContainText("What is the capital of country");

        await page.getByRole("button", { name: "Edit" }).click();
        const editor = editorFrame(page);
        const front = editableField(editor, 0);
        await expect(front).toBeVisible({ timeout: 20_000 });
        await front.click();
        // Replace the text rather than steering the caret: selection APIs
        // inside the editor's shadow root differ between engines.
        await front.press("Meta+a");
        await front.pressSequentially("What is the capital of country 0? EDITED");

        // Closing saves and redraws the card with the new text.
        await page.locator(".editor-header button").click();
        await expect(card).toContainText("EDITED", { timeout: 10_000 });
        await expect(page.locator("iframe[title=editor]")).toHaveCount(0);
    });
});
