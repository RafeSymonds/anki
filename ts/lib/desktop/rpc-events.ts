// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Notification that a backend call completed in any frame, the shell's
 * stand-in for Qt's `operation_did_execute` hook. The host's fetch shim
 * calls `window.top.__ankiRpcDone(method, frame)` after every successful
 * POST to `/_anki/{method}`.
 */

export type RpcDoneHandler = (method: string, frame: Window) => void;

const handlers = new Set<RpcDoneHandler>();

/** Backend methods that change the collection in ways other views show. */
export const OPERATION_METHODS = new Set([
    "addNote",
    "updateNotes",
    "removeNotes",
    "answerCard",
    "undo",
    "redo",
    "buryOrSuspendCards",
    "unburyDeck",
    "setFlag",
    "addNoteTags",
    "removeNoteTags",
    "setDueDate",
    "scheduleCardsAsNew",
    "updateDeckConfigs",
    "setCurrentDeck",
    "addDeck",
    "removeDecks",
    "renameDeck",
    "reparentDecks",
    "setDeckCollapsed",
    "importAnkiPackage",
    "importCsv",
    "importJsonFile",
    "importJsonString",
    "changeNotetype",
    "updateNotetype",
    "addNotetype",
    "removeNotetype",
    "customStudy",
    "addOrUpdateFilteredDeck",
    "rebuildFilteredDeck",
    "emptyFilteredDeck",
    "syncCollection",
    "fullUploadOrDownload",
    "restoreBuriedAndSuspendedCards",
    "sortCards",
    "gradeNow",
    "setDeck",
    "findAndReplace",
    "findAndReplaceTag",
]);

export function isOperation(method: string): boolean {
    return OPERATION_METHODS.has(method);
}

export function onRpcDone(handler: RpcDoneHandler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
}

export function dispatchRpcDone(method: string, frame: Window): void {
    for (const handler of handlers) {
        try {
            handler(method, frame);
        } catch (err) {
            console.warn("rpc-done handler failed", err);
        }
    }
}

interface HookWindow {
    __ankiRpcDone?: typeof dispatchRpcDone;
}

export function installRpcDoneHook(target: Window = window): void {
    (target as unknown as HookWindow).__ankiRpcDone = dispatchRpcDone;
}
