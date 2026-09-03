// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { dispatchRpcDone, installRpcDoneHook, isOperation, onRpcDone } from "./rpc-events";

describe("rpc events", () => {
    it("classifies collection-changing methods", () => {
        expect(isOperation("answerCard")).toBe(true);
        expect(isOperation("updateNotes")).toBe(true);
        expect(isOperation("getDeckNames")).toBe(false);
        expect(isOperation("i18nResources")).toBe(false);
    });

    it("notifies every handler and survives a failing one", () => {
        const seen: string[] = [];
        const off1 = onRpcDone(() => {
            throw new Error("boom");
        });
        const off2 = onRpcDone((method) => seen.push(method));
        const frame = {} as Window;
        dispatchRpcDone("addNote", frame);
        expect(seen).toEqual(["addNote"]);
        off1();
        off2();
        dispatchRpcDone("addNote", frame);
        expect(seen).toEqual(["addNote"]);
    });

    it("installs the hook the host shim calls", () => {
        const target = {} as Window;
        installRpcDoneHook(target);
        expect(typeof (target as unknown as { __ankiRpcDone: unknown }).__ankiRpcDone).toBe("function");
    });
});
