// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { Progress, Progress_FullSync, Progress_NormalSync } from "@generated/anki/collection_pb";
import { Empty } from "@generated/anki/generic_pb";
import { MediaSyncProgress, SyncAuth } from "@generated/anki/sync_pb";
import { describe, expect, it } from "vitest";

import { BackendError, ERROR_KIND_HEADER, postBackend, progressFromProto } from "./sync-rpc";

describe("postBackend", () => {
    it("posts protobuf bytes and decodes the reply", async () => {
        let seenUrl = "";
        let seenBody: Uint8Array | undefined;
        const fetchImpl = (async (url: string, init?: RequestInit) => {
            seenUrl = url;
            seenBody = init?.body as Uint8Array;
            return new Response(new SyncAuth({ hkey: "abc" }).toBinary(), { status: 200 });
        }) as unknown as typeof fetch;
        const auth = await postBackend("syncLogin", new Empty(), SyncAuth, fetchImpl);
        expect(seenUrl).toBe("/_anki/syncLogin");
        expect(seenBody).toEqual(new Empty().toBinary());
        expect(auth.hkey).toBe("abc");
    });

    it("turns a failure into a BackendError carrying the kind header", async () => {
        const fetchImpl = (async () =>
            new Response("Email or password was incorrect", {
                status: 500,
                headers: { [ERROR_KIND_HEADER]: "SYNC_AUTH_ERROR" },
            })) as unknown as typeof fetch;
        const err = await postBackend("syncLogin", new Empty(), SyncAuth, fetchImpl).catch((e) => e);
        expect(err).toBeInstanceOf(BackendError);
        expect(err.kind).toBe("SYNC_AUTH_ERROR");
        expect(err.message).toBe("Email or password was incorrect");

        const noKind = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
        const other = await postBackend("syncLogin", new Empty(), SyncAuth, noKind).catch((e) => e);
        expect(other.kind).toBe("");
    });
});

describe("progressFromProto", () => {
    it("keeps the sync-related progress values", () => {
        expect(
            progressFromProto(
                new Progress({
                    value: {
                        case: "normalSync",
                        value: new Progress_NormalSync({ stage: "Cards", added: "+2", removed: "-1" }),
                    },
                }),
            ),
        ).toEqual({ kind: "normal", stage: "Cards", added: "+2", removed: "-1" });
        expect(
            progressFromProto(
                new Progress({
                    value: { case: "fullSync", value: new Progress_FullSync({ transferred: 10, total: 20 }) },
                }),
            ),
        ).toEqual({ kind: "full", transferred: 10, total: 20 });
        expect(
            progressFromProto(
                new Progress({
                    value: {
                        case: "mediaSync",
                        value: new MediaSyncProgress({ added: "a", removed: "r", checked: "c" }),
                    },
                }),
            ),
        ).toEqual({ kind: "media", added: "a", removed: "r", checked: "c" });
        expect(progressFromProto(new Progress({ value: { case: "importing", value: "x" } }))).toEqual({ kind: "none" });
        expect(progressFromProto(new Progress())).toEqual({ kind: "none" });
    });
});
