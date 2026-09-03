// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Collection-level undo and redo. rslib answers `undo` with an error when
 * there is nothing to undo, which the shell would see as a failed call;
 * asking for the status first keeps "nothing to undo" an ordinary answer.
 */

import { getUndoStatus, redo, undo } from "@generated/backend";

export type UndoResult = { kind: "done"; operation: string } | { kind: "nothing" };

export async function undoLast(): Promise<UndoResult> {
    const status = await getUndoStatus({}, { alertOnError: false });
    if (!status.undo) {
        return { kind: "nothing" };
    }
    const result = await undo({}, { alertOnError: false });
    return { kind: "done", operation: result.operation };
}

export async function redoLast(): Promise<UndoResult> {
    const status = await getUndoStatus({}, { alertOnError: false });
    if (!status.redo) {
        return { kind: "nothing" };
    }
    const result = await redo({}, { alertOnError: false });
    return { kind: "done", operation: result.operation };
}
