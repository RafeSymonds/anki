// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The controller's start-up race: the default search (deck:current) loads
 * config first, and the user may type or search meanwhile. Their input
 * must win and must not be wiped from the box. rslib is stubbed.
 */

import type { SearchNode } from "@generated/anki/search_pb";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const searches: string[] = [];
/** What setConfigJsonNoUndo stored, by key. */
const config: Record<string, unknown> = {};
/** getConfigString (the default search's first call) waits on this gate. */
let configGate: Promise<void>;
let releaseConfig: () => void = () => undefined;
function resetGate(): void {
    configGate = new Promise<void>((resolve) => (releaseConfig = resolve));
}
resetGate();

vi.mock("../desktop-api", () => ({
    settingsGet: async () => null,
    settingsSet: async () => undefined,
}));

vi.mock("@generated/backend", () => {
    const stubs: Record<string, (...args: unknown[]) => Promise<unknown>> = {
        allBrowserColumns: async () => ({ columns: [] }),
        getConfigBool: async () => ({ val: false }),
        getConfigJson: async (request: unknown) => {
            const key = (request as { val: string }).val;
            if (!(key in config)) {
                throw new Error("not set");
            }
            return { json: new TextEncoder().encode(JSON.stringify(config[key])) };
        },
        setConfigJsonNoUndo: async (request: unknown) => {
            const { key, valueJson } = request as { key: string; valueJson: Uint8Array };
            config[key] = JSON.parse(new TextDecoder().decode(valueJson));
            return {};
        },
        setActiveBrowserColumns: async () => ({}),
        getConfigString: () => configGate.then(() => ({ val: "" })),
        buildSearchString: async (node: unknown) => {
            const filter = (node as SearchNode).filter;
            if (filter.case === "deck") {
                return { val: `deck:${filter.value}` };
            }
            return { val: filter.case === "parsableText" && filter.value ? filter.value : "deck:*" };
        },
        searchCards: async (request: unknown) => {
            searches.push((request as { search: string }).search);
            return { ids: [1n, 2n] };
        },
    };
    return new Proxy(
        {},
        {
            // Never answer `then`: the mock loader awaits the module object.
            has: (_target, name) => typeof name === "string" && name !== "then",
            get: (_target, name) =>
                typeof name !== "string" || name === "then" ? undefined : (stubs[name] ?? (async () => ({}))),
        },
    );
});

import { BrowserController } from "./browser";

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

function controllerWithoutSidebar(): BrowserController {
    const controller = new BrowserController();
    vi.spyOn(controller, "refreshSidebar").mockResolvedValue();
    return controller;
}

describe("browser start-up", () => {
    beforeEach(() => {
        searches.length = 0;
        for (const key of Object.keys(config)) {
            delete config[key];
        }
        resetGate();
    });

    it("keeps text typed while the default search loads, then searches it on Enter", async () => {
        const controller = controllerWithoutSidebar();
        const started = controller.start(null);
        await settle();
        controller.searchText.set("deck:Default");
        releaseConfig();
        await started;

        expect(searches).toEqual(["deck:current"]);
        expect(get(controller.searchText)).toBe("deck:Default");

        await controller.searchFromInput();
        expect(searches).toEqual(["deck:current", "deck:Default"]);
    });

    it("skips the default search when the user already searched while loading", async () => {
        const controller = controllerWithoutSidebar();
        const started = controller.start(null);
        controller.searchText.set("tag:demo");
        const typed = controller.searchFromInput();
        await Promise.all([started, typed]);

        expect(searches).toEqual(["tag:demo"]);
        expect(get(controller.searchText)).toBe("tag:demo");
    });

    it("shows the default search's text in an untouched box", async () => {
        const controller = controllerWithoutSidebar();
        const started = controller.start(null);
        await settle();
        releaseConfig();
        await started;
        expect(searches).toEqual(["deck:current"]);
        expect(get(controller.searchText)).toBe("");
    });
});

describe("saved searches", () => {
    it("saves, refuses to overwrite silently, renames and removes", async () => {
        const controller = controllerWithoutSidebar();
        expect(await controller.savedSearches()).toEqual({});

        expect(await controller.saveSearch("Mine", "deck:Default")).toBe(true);
        expect(config.savedFilters).toEqual({ Mine: "deck:Default" });
        // Same name, same search: nothing to ask.
        expect(await controller.saveSearch("Mine", "deck:Default")).toBe(true);
        // Same name, other search: the caller must confirm.
        expect(await controller.saveSearch("Mine", "tag:x")).toBe(false);
        expect(config.savedFilters).toEqual({ Mine: "deck:Default" });
        expect(await controller.saveSearch("Mine", "tag:x", true)).toBe(true);
        expect(await controller.savedSearches()).toEqual({ Mine: "tag:x" });

        expect(await controller.saveSearch("Other", "is:due")).toBe(true);
        expect(await controller.renameSavedSearch("Mine", "Other")).toBe(false);
        expect(await controller.renameSavedSearch("Mine", "Ours")).toBe(true);
        expect(await controller.savedSearches()).toEqual({ Ours: "tag:x", Other: "is:due" });

        await controller.removeSavedSearch("Other");
        expect(await controller.savedSearches()).toEqual({ Ours: "tag:x" });
        expect(controller.refreshSidebar).toHaveBeenCalled();
    });

    it("ignores malformed stored entries", async () => {
        config.savedFilters = { good: "deck:A", bad: 7 };
        const controller = controllerWithoutSidebar();
        expect(await controller.savedSearches()).toEqual({ good: "deck:A" });
    });
});
