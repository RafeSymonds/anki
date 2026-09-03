// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The first-run welcome panel. Named to run last: it empties the shared
 * test collection to reach the fresh state the other specs must not see.
 */

import { Empty } from "@generated/anki/generic_pb";
import { RemoveNotesRequest } from "@generated/anki/notes_pb";
import { SearchRequest, SearchResponse, SortOrder } from "@generated/anki/search_pb";
import { expect, test } from "@playwright/test";

test("a collection with no cards shows the welcome panel and leads to adding", async ({ page, request }) => {
    const search = new SearchRequest({
        search: "",
        order: new SortOrder({ value: { case: "none", value: new Empty() } }),
    });
    const found = await request.post("/_anki/searchNotes", {
        data: Buffer.from(search.toBinary()),
        headers: { "Content-Type": "application/binary" },
    });
    const noteIds = SearchResponse.fromBinary(new Uint8Array(await found.body())).ids;
    expect(noteIds.length).toBeGreaterThan(0);
    const removed = await request.post("/_anki/removeNotes", {
        data: Buffer.from(new RemoveNotesRequest({ noteIds, cardIds: [] }).toBinary()),
        headers: { "Content-Type": "application/binary" },
    });
    expect(removed.ok()).toBe(true);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to Anki" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Study Now" })).toHaveCount(0);

    await page.getByRole("button", { name: /Make your first cards/ }).click();
    const editor = page.frameLocator("iframe[title=editor]");
    await expect(editor.locator(".field-container").first()).toBeVisible({ timeout: 20_000 });

    // Put the demo notes back so a following project (the other engine)
    // starts from the seeded collection too.
    const reseeded = await request.post("/_desktop/seedDemo", { data: "24" });
    expect(reseeded.ok()).toBe(true);
    await page.goto("/");
    await expect(page.locator("nav.sidebar .row", { hasText: "Default" })).toBeVisible();
});
