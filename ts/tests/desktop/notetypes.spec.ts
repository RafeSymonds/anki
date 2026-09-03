// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, type FrameLocator, type Locator, type Page, test } from "@playwright/test";

function editorFrame(page: Page): FrameLocator {
    return page.frameLocator("iframe[title=editor]");
}

function fieldLabel(editor: FrameLocator, index: number): Locator {
    return editor.locator(`.field-container[data-index="${index}"]`).locator(".label-name");
}

async function openNoteTypes(page: Page): Promise<void> {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Study Now" })).toBeVisible();
    await page.getByRole("button", { name: /Tools/ }).click();
    await page.getByRole("menuitem", { name: /Manage Note Types/ }).click();
    await expect(page.locator(".notetypes .row", { hasText: "Basic" }).first()).toBeVisible();
}

test.describe("note types", () => {
    test("adds a field to Basic and the add editor shows it", async ({ page }) => {
        await openNoteTypes(page);
        const basic = page.locator(".notetypes .row", { hasText: /^Basic \[/ });
        await expect(basic).toContainText("notes");
        await basic.click();

        page.once("dialog", (dialog) => dialog.accept("Extra"));
        await page.getByRole("button", { name: "Fields" }).click();
        const dialog = page.getByRole("dialog", { name: "Fields for Basic" });
        await expect(dialog.locator(".field-row")).toHaveText(["1: Front", "2: Back"]);
        await dialog.getByRole("button", { name: "Add", exact: true }).click();
        await expect(dialog.locator(".field-row")).toHaveText(["1: Front", "2: Back", "3: Extra"]);
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator(".toast")).toContainText("saved");

        await page.locator(".titlebar").getByRole("button", { name: "Add", exact: true }).click();
        const editor = editorFrame(page);
        await expect(fieldLabel(editor, 0)).toHaveText("Front", { timeout: 20_000 });
        await expect(fieldLabel(editor, 2)).toHaveText("Extra");
    });

    test("renames a card type and the card type list shows the new name", async ({ page }) => {
        await openNoteTypes(page);
        await page.locator(".notetypes .row", { hasText: /^Basic \[/ }).click();
        await page.getByRole("button", { name: "Cards" }).click();
        const dialog = page.getByRole("dialog", { name: "Card Types for Basic" });
        const cardTypes = dialog.locator("select.card-types");
        await expect(cardTypes.locator("option")).toHaveText(["1: Card 1: Front -> Back"]);
        // The preview renders the empty note with the field names filled in.
        const preview = dialog.frameLocator("iframe[title=card]").locator("#qa");
        await expect(preview).toContainText("(Front)", { timeout: 20_000 });

        page.once("dialog", (dialog) => dialog.accept("Recall"));
        await dialog.getByRole("button", { name: /Options/ }).click();
        await dialog.getByRole("button", { name: "Rename Card Type..." }).click();
        await expect(cardTypes.locator("option")).toHaveText(["1: Recall: Front -> Back"]);

        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(dialog).toHaveCount(0);

        // Saved: reopening shows the renamed template.
        await page.getByRole("button", { name: "Cards" }).click();
        await expect(
            page.getByRole("dialog", { name: "Card Types for Basic" }).locator("select.card-types option"),
        ).toHaveText(["1: Recall: Front -> Back"]);
    });

    test("the editor's Fields button opens the dialog for its note type", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Add", exact: true }).click();
        const editor = editorFrame(page);
        await expect(fieldLabel(editor, 0)).toHaveText("Front", { timeout: 20_000 });
        await editor.getByRole("button", { name: /Fields/ }).click();
        await expect(page.getByRole("dialog", { name: "Fields for Basic" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
    });
});
