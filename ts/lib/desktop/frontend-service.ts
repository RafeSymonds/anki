// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The FrontendService (proto/anki/frontend.proto) implemented in the shell.
 *
 * Web code calls these through `postProto` like any backend method. The
 * host's init script (desktop/src/lib.rs) redirects those fetches to
 * `window.top.__ankiFrontendService(method, bytes, frame)`, which is
 * `dispatchFrontendCall` below. Handlers are registered by whichever part of
 * the shell owns the behaviour (the reviewer answers scheduling-state calls,
 * an embedded deck options page answers its close request, and so on).
 */

import type { Message } from "@bufbuild/protobuf";

export type FrontendHandler = (bytes: Uint8Array, frame: Window) => Promise<Uint8Array> | Uint8Array;

const handlers = new Map<string, FrontendHandler>();

/** Register a handler; returns a function that removes it again. */
export function registerFrontendHandler(method: string, handler: FrontendHandler): () => void {
    handlers.set(method, handler);
    return () => {
        if (handlers.get(method) === handler) {
            handlers.delete(method);
        }
    };
}

export function hasFrontendHandler(method: string): boolean {
    return handlers.has(method);
}

/** Wrap a typed function as a raw handler. */
export function typedHandler<I extends Message<I>, O extends Message<O>>(
    inputType: { fromBinary(bytes: Uint8Array): I },
    fn: (input: I, frame: Window) => O | Promise<O>,
): FrontendHandler {
    return async (bytes, frame) => {
        const output = await fn(inputType.fromBinary(bytes), frame);
        return output.toBinary();
    };
}

export async function dispatchFrontendCall(
    method: string,
    bytes: Uint8Array,
    frame: Window,
): Promise<Uint8Array> {
    const handler = handlers.get(method);
    if (!handler) {
        throw new Error(`frontend method not implemented in the app shell: ${method}`);
    }
    // Bytes may come from another frame's realm; copy them into ours.
    return await handler(new Uint8Array(bytes), frame);
}

interface ServiceWindow {
    __ankiFrontendService?: typeof dispatchFrontendCall;
}

export function installFrontendService(target: Window = window): void {
    (target as unknown as ServiceWindow).__ankiFrontendService = dispatchFrontendCall;
}
