// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { dispatchMenu, isMenuId, MENU_IDS } from "./menu-actions";

describe("menu actions", () => {
    it("knows the ids the native menu emits", () => {
        expect(isMenuId("sync")).toBe(true);
        expect(isMenuId("check_database")).toBe(true);
        expect(isMenuId("nope")).toBe(false);
        expect(new Set(MENU_IDS).size).toBe(MENU_IDS.length);
    });

    it("runs the matching handler and reports the rest", () => {
        const ran: string[] = [];
        const missing: string[] = [];
        const handlers = {
            sync: () => {
                ran.push("sync");
            },
        };
        expect(dispatchMenu("sync", handlers, (id) => missing.push(id))).toBe(true);
        expect(dispatchMenu("stats", handlers, (id) => missing.push(id))).toBe(false);
        expect(dispatchMenu("bogus", handlers, (id) => missing.push(id))).toBe(false);
        expect(ran).toEqual(["sync"]);
        expect(missing).toEqual(["stats", "bogus"]);
    });
});
