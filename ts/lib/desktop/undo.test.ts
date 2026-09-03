// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let status = { undo: "", redo: "" };

vi.mock("@generated/backend", () => ({
    getUndoStatus: async () => {
        calls.push("status");
        return status;
    },
    undo: async () => {
        calls.push("undo");
        return { operation: status.undo };
    },
    redo: async () => {
        calls.push("redo");
        return { operation: status.redo };
    },
}));

import { redoLast, undoLast } from "./undo";

describe("undo", () => {
    beforeEach(() => {
        calls.length = 0;
        status = { undo: "", redo: "" };
    });

    it("does not call undo when there is nothing to undo", async () => {
        expect(await undoLast()).toEqual({ kind: "nothing" });
        expect(await redoLast()).toEqual({ kind: "nothing" });
        expect(calls).toEqual(["status", "status"]);
    });

    it("undoes and redoes what the status names", async () => {
        status = { undo: "Answer Card", redo: "" };
        expect(await undoLast()).toEqual({ kind: "done", operation: "Answer Card" });
        status = { undo: "", redo: "Answer Card" };
        expect(await redoLast()).toEqual({ kind: "done", operation: "Answer Card" });
        expect(calls).toEqual(["status", "undo", "status", "redo"]);
    });
});
