// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Simulation test for the shell: a seeded random walk over the actions a
 * user can take (study, rate, undo, switch decks, open and close screens),
 * checking after every step that the shell is still responsive, no page
 * errors or failed backend calls occurred, and finally that the database
 * checker finds nothing wrong.
 *
 * Reproduce with ANKI_MONKEY_SEED=<n> ANKI_MONKEY_STEPS=<n>.
 */

import { CheckDatabaseResponse } from "@generated/anki/collection_pb";
import { Empty } from "@generated/anki/generic_pb";
import { expect, type Page, test } from "@playwright/test";

/** mulberry32: small, seedable, good enough for a random walk. */
function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type Action = { name: string; run: (page: Page, rng: () => number) => Promise<void> };

const actions: Action[] = [
    { name: "study", run: (p) => p.getByRole("button", { name: "Study Now" }).click({ timeout: 2000 }) },
    { name: "space", run: (p) => p.keyboard.press("Space") },
    { name: "ease1", run: (p) => p.keyboard.press("1") },
    { name: "ease2", run: (p) => p.keyboard.press("2") },
    { name: "ease3", run: (p) => p.keyboard.press("3") },
    { name: "ease4", run: (p) => p.keyboard.press("4") },
    { name: "undo", run: (p) => p.keyboard.press("u") },
    { name: "bury", run: (p) => p.keyboard.press("-") },
    { name: "flag", run: (p) => p.keyboard.press("Meta+3") },
    { name: "decks", run: (p) => p.keyboard.press("d") },
    {
        name: "pick-deck",
        run: async (p, rng) => {
            const rows = p.locator("nav.sidebar .row");
            const n = await rows.count();
            if (n) {
                await rows.nth(Math.floor(rng() * n)).click({ timeout: 2000 });
            }
        },
    },
    {
        name: "options",
        run: async (p) => {
            await p.getByRole("button", { name: "Options" }).first().click({ timeout: 2000 });
            await p.frameLocator("iframe[title=page]").getByRole("heading", { name: "Daily Limits" }).first()
                .waitFor({ timeout: 15_000 });
            await p.getByRole("button", { name: /Close/ }).first().click({ timeout: 2000 });
        },
    },
    {
        name: "add-close",
        run: async (p) => {
            await p.keyboard.press("a");
            await p.frameLocator("iframe[title=editor]").locator(".field-container").first().waitFor({
                timeout: 15_000,
            });
            await p.getByRole("button", { name: /Close/ }).first().click({ timeout: 2000 });
        },
    },
];

test("a random walk over the shell keeps it responsive and the collection consistent", async ({ page, request }) => {
    test.setTimeout(180_000);
    const seed = Number(process.env.ANKI_MONKEY_SEED ?? 1);
    const steps = Number(process.env.ANKI_MONKEY_STEPS ?? 40);
    const rng = makeRng(seed);

    const errors: string[] = [];
    page.on("pageerror", (err) => {
        // A frame torn down mid-request (closing the editor while it saves)
        // reports this from the discarded frame; it is not a shell fault.
        if (/frame or worker th[a-z]+ has been detached|Blob loading failed/.test(err.message)) {
            return;
        }
        errors.push(`pageerror: ${err.message}`);
    });
    page.on("response", (response) => {
        if (response.url().includes("/_anki/") && response.status() >= 500) {
            errors.push(`${response.status()} ${response.url()}`);
        }
    });

    await page.goto("/");
    await expect(page.locator("nav.sidebar .row").first()).toBeVisible();

    const history: string[] = [];
    for (let i = 0; i < steps; i++) {
        const action = actions[Math.floor(rng() * actions.length)];
        history.push(action.name);
        try {
            await action.run(page, rng);
        } catch {
            // An action that does not apply to the current screen is a no-op,
            // like pressing a key the screen ignores.
        }
        await page.waitForTimeout(80);
        // The shell must still be standing after every step.
        await expect(page.locator("nav.sidebar"), `after step ${i} (${history.join(" > ")})`).toBeVisible();
        expect(errors, `errors after step ${i} (${history.join(" > ")})`).toEqual([]);
    }

    // Leave any screen and confirm the overview still works; end on the
    // Default deck so later specs start where the seed left things.
    await page.keyboard.press("Escape");
    await page.keyboard.press("d");
    await expect(page.locator("nav.sidebar .row").first()).toBeVisible();
    await page.locator("nav.sidebar .row", { hasText: "Default" }).click();

    // The collection itself must be clean.
    const response = await request.post("/_anki/checkDatabase", {
        data: Buffer.from(new Empty().toBinary()),
        headers: { "Content-Type": "application/binary" },
    });
    expect(response.ok()).toBe(true);
    const check = CheckDatabaseResponse.fromBinary(new Uint8Array(await response.body()));
    expect(check.problems, `history: ${history.join(" > ")}`).toEqual([]);
});
