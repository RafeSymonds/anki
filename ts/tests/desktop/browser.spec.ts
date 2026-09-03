// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, type Locator, type Page, test } from "@playwright/test";

function rows(page: Page): Locator {
    return page.locator(".browser .table .row");
}

/** The cards/notes switch; the mode is remembered in the collection between tests. */
async function setMode(page: Page, mode: "cards" | "notes"): Promise<void> {
    const button = page.locator(".browser .mode button", { hasText: mode === "cards" ? "Cards" : "Notes" });
    if (!(await button.evaluate((el) => el.classList.contains("active")))) {
        await button.click();
    }
    await expect(page.locator(".browser .table")).toHaveAttribute("data-mode", mode);
}

async function openBrowser(page: Page, search: string, mode: "cards" | "notes" = "cards"): Promise<void> {
    await page.goto("/");
    await page.getByRole("button", { name: "Browse" }).click();
    const input = page.locator(".browser input.search");
    await expect(input).toBeVisible();
    await input.fill(search);
    await input.press("Enter");
    await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
    await setMode(page, mode);
}

/** Fluent wraps arguments in isolation marks: "Browse (\u20681\u2069 of \u206812\u2069 cards selected)". */
function statusPattern(selected: number | string, total: number | string): RegExp {
    return new RegExp(`\\u2068?${selected}\\u2069? of \\u2068?${total}\\u2069?`);
}

/** "Browse (x of y cards selected)" -> y */
async function totalFromStatus(page: Page): Promise<number> {
    const text = await page.locator(".browser .status").innerText();
    const match = /of \u2068?(\d+)\u2069?/.exec(text);
    expect(match).not.toBeNull();
    return Number(match![1]);
}

test.describe("browser", () => {
    test("searches, shows rows and selects into the editor", async ({ page }) => {
        await openBrowser(page, "deck:Default");
        const total = await totalFromStatus(page);
        // The seed puts every second demo note into Default.
        expect(total).toBeGreaterThanOrEqual(12);
        await expect(rows(page)).toHaveCount(total);
        // Cells come from browserRowForId: the sort field shows the question
        // (which note comes first depends on the sort the last run left).
        await expect(rows(page).first().locator(".cell").first()).toContainText(/Question|capital of country/);

        // The first row is selected after a search, as in Qt, and the editor shows it.
        await expect(rows(page).first()).toHaveClass(/selected/);
        const editor = page.frameLocator("iframe[title=editor]");
        await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });

        // Selecting another row loads its note.
        const secondText = (await rows(page).nth(1).locator(".cell").first().innerText()).trim();
        await rows(page).nth(1).click();
        await expect(rows(page).nth(1)).toHaveClass(/selected/);
        await expect(page.locator(".browser .status")).toHaveText(statusPattern(1, "\\d+"));
        const firstField = editor
            .locator(".field-container[data-index='0']")
            .locator(".rich-text-editable")
            .locator("anki-editable[contenteditable='true']");
        await expect(firstField).toContainText(secondText.replace(/^Question \d+ /, "").slice(0, 20), {
            timeout: 10_000,
        });

        // Shift-click extends the selection.
        await rows(page).nth(3).click({ modifiers: ["Shift"] });
        await expect(page.locator(".browser .status")).toHaveText(statusPattern(3, "\\d+"));
        await expect(page.locator("iframe[title=editor]")).toHaveCount(0);
    });

    test("sets a flag with the shortcut and the row colour follows", async ({ page }) => {
        await openBrowser(page, "deck:Default");
        const row = rows(page).first();
        await row.click();
        await expect(row).toHaveAttribute("data-color", "default");
        await page.keyboard.press("Control+1");
        await expect(row).toHaveAttribute("data-color", "flag-red", { timeout: 10_000 });
        // The same shortcut toggles the flag off again.
        await page.keyboard.press("Control+1");
        await expect(row).toHaveAttribute("data-color", "default", { timeout: 10_000 });
    });

    test("toggles notes mode and deletes a note", async ({ page }) => {
        await openBrowser(page, "deck:Default");
        const before = await totalFromStatus(page);

        await setMode(page, "notes");
        await expect(page.locator(".browser .status")).toContainText("notes selected");
        await expect(rows(page)).toHaveCount(before);

        await rows(page).first().click();
        await page.keyboard.press("Control+Delete");
        await expect(page.locator(".browser .status")).toHaveText(statusPattern("\\d+", before - 1), {
            timeout: 10_000,
        });
        await expect(rows(page)).toHaveCount(before - 1);
        // The next row took over the selection.
        await expect(rows(page).first()).toHaveClass(/selected/);
    });

    test("card actions change the rows: suspend, mark, tags, deck, replace, due date", async ({ page }) => {
        await openBrowser(page, "deck:Default");
        const row = rows(page).nth(1);
        await row.click();
        const id = await row.getAttribute("data-id");
        const rowById = page.locator(`.browser .table .row[data-id="${id}"]`);

        await page.keyboard.press("Control+j");
        await expect(rowById).toHaveAttribute("data-color", "suspended", { timeout: 10_000 });
        await page.keyboard.press("Control+j");
        await expect(rowById).toHaveAttribute("data-color", "default", { timeout: 10_000 });

        await page.keyboard.press("Control+k");
        await expect(rowById).toHaveAttribute("data-color", "marked", { timeout: 10_000 });
        await page.keyboard.press("Control+k");
        await expect(rowById).toHaveAttribute("data-color", "default", { timeout: 10_000 });

        // Add Tags asks for the tags.
        const dialog = page.locator("form.dialog");
        await page.keyboard.press("Control+Shift+a");
        await expect(dialog).toBeVisible();
        await dialog.locator("input[type=text]").fill("e2etag");
        await dialog.getByRole("button", { name: "OK" }).click();
        await expect(page.locator(".toast")).toContainText("note updated", { timeout: 10_000 });

        // Find and Replace in the selected note only.
        await page.keyboard.press("Control+Alt+f");
        await expect(dialog).toBeVisible();
        await dialog.locator("input[type=text]").nth(0).fill("capital");
        await dialog.locator("input[type=text]").nth(1).fill("CAPITAL");
        await dialog.getByRole("button", { name: "OK" }).click();
        await expect(rowById.locator(".cell").nth(0)).toContainText("CAPITAL", { timeout: 10_000 });

        // Set Due Date asks for the days; the card is no longer new.
        await expect(rowById.locator(".cell").nth(2)).toContainText("New");
        await page.keyboard.press("Control+Shift+d");
        await expect(dialog).toBeVisible();
        await dialog.locator("input[type=text]").fill("1");
        await dialog.getByRole("button", { name: "OK" }).click();
        await expect(rowById.locator(".cell").nth(2)).not.toContainText("New", { timeout: 10_000 });

        // Change Deck offers the deck list.
        await page.keyboard.press("Control+d");
        await expect(dialog).toBeVisible();
        await dialog.locator("select").selectOption({ label: "Demo" });
        await dialog.getByRole("button", { name: "Move Cards" }).click();
        await expect(rowById.locator(".cell").nth(3)).toHaveText("Demo", { timeout: 10_000 });

        // The tag search finds the note.
        const input = page.locator(".browser input.search");
        await input.fill("tag:e2etag");
        await input.press("Enter");
        await expect(rows(page)).toHaveCount(1);
        expect(await rows(page).first().getAttribute("data-id")).toBe(id);
    });

    test("preview, card info and change notetype embed the existing pages", async ({ page }) => {
        await openBrowser(page, "deck:Default");
        const total = await totalFromStatus(page);
        await rows(page).first().click();

        await page.keyboard.press("Control+Shift+p");
        const card = page.frameLocator(".preview-pane iframe[title=card]").locator("#qa");
        await expect(card).toContainText("capital of country", { timeout: 20_000 });
        await page.keyboard.press("Control+Shift+p");
        await expect(page.locator(".preview-pane")).toHaveCount(0);

        await page.keyboard.press("Control+Shift+i");
        const info = page.frameLocator("iframe[title='card info']");
        await expect(info.getByText("Added", { exact: true })).toBeVisible({ timeout: 20_000 });
        await page.locator(".card-info .bar button").click();
        await expect(page.locator(".card-info")).toHaveCount(0);

        await page.keyboard.press("Control+Shift+m");
        const change = page.frameLocator("iframe[title='change notetype']");
        await change.getByRole("combobox").nth(1).click();
        await change.getByRole("option", { name: "Basic (and reversed card)" }).click();
        await change.getByRole("button", { name: "Save" }).click();
        await expect(page.locator("iframe[title='change notetype']")).toHaveCount(0, { timeout: 20_000 });
        await expect(page.locator(".toast")).toContainText("note updated");
        // The note now has two cards, and the rows were searched again.
        await expect(page.locator(".browser .status")).toHaveText(statusPattern("\\d+", total + 1), {
            timeout: 10_000,
        });
    });

    test("saves the current search, reruns it from the sidebar, renames and removes it", async ({ page }) => {
        await openBrowser(page, "deck:Default");
        const sidebar = page.locator(".browser-sidebar");
        const saved = sidebar.locator(".row", { has: page.locator(".name", { hasText: /^Saved Searches$/ }) });
        await expect(saved).toBeVisible();

        const name = `Mine ${Date.now() % 100000}`;
        page.once("dialog", (dialog) => dialog.accept(name));
        await saved.getByRole("button", { name: "Save Current Search" }).click();
        const entry = sidebar.locator(".row", { has: page.locator(".name", { hasText: name }) });
        await expect(entry).toBeVisible();

        // Another search, then the saved one brings the first back.
        const input = page.locator(".browser input.search");
        await input.fill("tag:demo");
        await input.press("Enter");
        await expect(input).toHaveValue("tag:demo");
        await entry.click();
        await expect(input).toHaveValue(/deck:Default/);

        const renamed = `${name} b`;
        page.once("dialog", (dialog) => dialog.accept(renamed));
        await entry.hover();
        await entry.getByRole("button", { name: `Rename ${name}` }).click();
        const renamedEntry = sidebar.locator(".row", { has: page.locator(".name", { hasText: renamed }) });
        await expect(renamedEntry).toBeVisible();

        page.once("dialog", (dialog) => dialog.accept());
        await renamedEntry.hover();
        await renamedEntry.getByRole("button", { name: `Delete ${renamed}` }).click();
        await expect(renamedEntry).toHaveCount(0);
    });

    test("sidebar items search and the sort header reorders", async ({ page }) => {
        await openBrowser(page, "deck:Default");
        // The deck, not the "demo" tag.
        await page.locator(".browser-sidebar .row", { has: page.locator(".name", { hasText: /^Demo$/ }) }).click();
        await expect(page.locator(".browser input.search")).toHaveValue(/deck:Demo/);
        await expect(rows(page).first().locator(".cell").first()).toContainText(/Question|capital/);
        // Let the editor finish loading the first row's note before clicking on.
        const editor = page.frameLocator("iframe[title=editor]");
        await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });

        const head = page.locator(".browser .head", { hasText: "Sort Field" });
        if (!(await head.evaluate((el) => el.classList.contains("sorted")))) {
            await head.click();
            await expect(head).toHaveClass(/sorted/);
        }
        const firstBefore = await rows(page).first().getAttribute("data-id");
        const arrowBefore = await head.locator(".arrow").innerText();
        // Clicking the sorted column reverses the order.
        await head.click();
        await expect(head.locator(".arrow")).not.toHaveText(arrowBefore);
        expect(await rows(page).first().getAttribute("data-id")).not.toBe(firstBefore);
    });
});
