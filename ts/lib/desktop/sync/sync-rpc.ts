// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The backend sync RPCs (proto/anki/sync.proto) and `latestProgress`, called
 * directly rather than through `postProto` so that a failure carries the
 * backend error kind (the host puts it in the `anki-error-kind` response
 * header, see desktop/src/scheme.rs) and shows no alert of its own: the sync
 * flow decides what an error means, e.g. an auth failure asks to log in again.
 */

import type { Message } from "@bufbuild/protobuf";
import { Progress } from "@generated/anki/collection_pb";
import { Empty } from "@generated/anki/generic_pb";
import type { SyncCollectionResponse_ChangesRequired, SyncStatusResponse_Required } from "@generated/anki/sync_pb";
import {
    FullUploadOrDownloadRequest,
    MediaSyncStatusResponse,
    SyncAuth,
    SyncCollectionRequest,
    SyncCollectionResponse,
    SyncLoginRequest,
    SyncStatusResponse,
} from "@generated/anki/sync_pb";

export const ERROR_KIND_HEADER = "anki-error-kind";

/** A failed backend call, with the kind name from proto/anki/backend.proto. */
export class BackendError extends Error {
    constructor(message: string, readonly kind: string) {
        super(message);
        this.name = "BackendError";
    }
}

export interface SyncAuthInput {
    hkey: string;
    endpoint?: string;
}

/** SyncCollectionResponse as plain data. */
export interface SyncOutput {
    hostNumber: number;
    serverMessage: string;
    required: SyncCollectionResponse_ChangesRequired;
    newEndpoint?: string;
    serverMediaUsn: number;
}

export interface SyncStatus {
    required: SyncStatusResponse_Required;
    newEndpoint?: string;
}

export interface MediaProgress {
    added: string;
    removed: string;
    checked: string;
}

export interface MediaStatus {
    active: boolean;
    progress?: MediaProgress;
}

/** The parts of collection.proto's Progress the sync flow shows. */
export type SyncProgress =
    | { kind: "normal"; stage: string; added: string; removed: string }
    | { kind: "full"; transferred: number; total: number }
    | { kind: "media"; added: string; removed: string; checked: string }
    | { kind: "none" };

/** What the sync flow needs from the backend; faked in tests. */
export interface SyncRpc {
    /** Resolves to the host key. */
    syncLogin(username: string, password: string, endpoint?: string): Promise<string>;
    syncStatus(auth: SyncAuthInput): Promise<SyncStatus>;
    syncCollection(auth: SyncAuthInput, syncMedia: boolean): Promise<SyncOutput>;
    /** Start a media-only sync in the background (follow it with mediaSyncStatus). */
    syncMedia(auth: SyncAuthInput): Promise<void>;
    fullUploadOrDownload(auth: SyncAuthInput, upload: boolean, serverUsn?: number): Promise<void>;
    mediaSyncStatus(): Promise<MediaStatus>;
    latestProgress(): Promise<SyncProgress>;
    abortSync(): Promise<void>;
    abortMediaSync(): Promise<void>;
    setWantsAbort(): Promise<void>;
}

/** POST protobuf bytes to `/_anki/{method}`; errors become BackendError. */
export async function postBackend<T extends Message<T>>(
    method: string,
    input: Message,
    outputType: { fromBinary(bytes: Uint8Array): T },
    fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<T> {
    const response = await fetchImpl(`/_anki/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/binary" },
        body: input.toBinary(),
    });
    if (!response.ok) {
        throw new BackendError(await response.text(), response.headers.get(ERROR_KIND_HEADER) ?? "");
    }
    return outputType.fromBinary(new Uint8Array(await response.arrayBuffer()));
}

export function progressFromProto(progress: Progress): SyncProgress {
    const value = progress.value;
    switch (value.case) {
        case "normalSync":
            return { kind: "normal", stage: value.value.stage, added: value.value.added, removed: value.value.removed };
        case "fullSync":
            return { kind: "full", transferred: value.value.transferred, total: value.value.total };
        case "mediaSync":
            return {
                kind: "media",
                added: value.value.added,
                removed: value.value.removed,
                checked: value.value.checked,
            };
        default:
            return { kind: "none" };
    }
}

function authMessage(auth: SyncAuthInput): SyncAuth {
    return new SyncAuth({ hkey: auth.hkey, endpoint: auth.endpoint });
}

/** The real thing: talks to rslib through the host. */
export const backendSyncRpc: SyncRpc = {
    async syncLogin(username, password, endpoint) {
        const auth = await postBackend("syncLogin", new SyncLoginRequest({ username, password, endpoint }), SyncAuth);
        return auth.hkey;
    },
    async syncStatus(auth) {
        const out = await postBackend("syncStatus", authMessage(auth), SyncStatusResponse);
        return { required: out.required, newEndpoint: out.newEndpoint };
    },
    async syncCollection(auth, syncMedia) {
        const out = await postBackend(
            "syncCollection",
            new SyncCollectionRequest({ auth: authMessage(auth), syncMedia }),
            SyncCollectionResponse,
        );
        return {
            hostNumber: out.hostNumber,
            serverMessage: out.serverMessage,
            required: out.required,
            newEndpoint: out.newEndpoint,
            serverMediaUsn: out.serverMediaUsn,
        };
    },
    async syncMedia(auth) {
        await postBackend("syncMedia", authMessage(auth), Empty);
    },
    async fullUploadOrDownload(auth, upload, serverUsn) {
        await postBackend(
            "fullUploadOrDownload",
            new FullUploadOrDownloadRequest({ auth: authMessage(auth), upload, serverUsn }),
            Empty,
        );
    },
    async mediaSyncStatus() {
        const out = await postBackend("mediaSyncStatus", new Empty(), MediaSyncStatusResponse);
        const p = out.progress;
        return {
            active: out.active,
            progress: p ? { added: p.added, removed: p.removed, checked: p.checked } : undefined,
        };
    },
    async latestProgress() {
        return progressFromProto(await postBackend("latestProgress", new Empty(), Progress));
    },
    async abortSync() {
        await postBackend("abortSync", new Empty(), Empty);
    },
    async abortMediaSync() {
        await postBackend("abortMediaSync", new Empty(), Empty);
    },
    async setWantsAbort() {
        await postBackend("setWantsAbort", new Empty(), Empty);
    },
};
