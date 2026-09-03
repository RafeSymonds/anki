// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * `bridgeCommand` / `pycmd` in the desktop shell.
 *
 * In the Qt app these are injected by QWebChannel and land in Python. Here
 * the host installs a queueing stub in every frame before any script runs
 * (see desktop/src/lib.rs); the shell then attaches a real handler to each
 * frame it owns and drains whatever was queued in the meantime.
 */

export type BridgeCallback = (value: unknown) => void;
export type BridgeHandler = (command: string, callback?: BridgeCallback) => void;

interface BridgeWindow {
    __ankiShim?: boolean;
    __ankiBridgeHandler?: BridgeHandler;
    __ankiBridgeQueue?: [string, BridgeCallback | undefined][];
    bridgeCommand?: BridgeHandler;
    pycmd?: BridgeHandler;
}

export function installBridgeHandler(win: Window, handler: BridgeHandler): void {
    const target = win as unknown as BridgeWindow;
    target.__ankiBridgeHandler = handler;
    if (!target.__ankiShim) {
        // Running outside the Tauri host (browser, tests): define the globals ourselves.
        target.bridgeCommand = handler;
        target.pycmd = handler;
    }
    const queued = target.__ankiBridgeQueue ?? [];
    target.__ankiBridgeQueue = [];
    for (const [command, callback] of queued) {
        handler(command, callback);
    }
}

export function removeBridgeHandler(win: Window): void {
    const target = win as unknown as BridgeWindow;
    delete target.__ankiBridgeHandler;
}

/** Split `cmd:arg` the way the Python link handlers do. */
export function parseBridgeCommand(command: string): { cmd: string; arg: string } {
    const idx = command.indexOf(":");
    if (idx === -1) {
        return { cmd: command, arg: "" };
    }
    return { cmd: command.slice(0, idx), arg: command.slice(idx + 1) };
}
