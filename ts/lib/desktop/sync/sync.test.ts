// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import {
    SyncCollectionResponse_ChangesRequired as Required,
    SyncStatusResponse_Required,
} from "@generated/anki/sync_pb";
import { get } from "svelte/store";
import { describe, expect, it } from "vitest";

import type { SettingsStore, SyncPhase } from "./sync";
import {
    canAutoSync,
    classifySyncError,
    describeProgress,
    loadSyncSettings,
    mediaUsnForFullSync,
    settingsPatchFromSync,
    stepAfterSync,
    syncAuth,
    SyncController,
    syncEndpoint,
} from "./sync";
import type { SyncOutput, SyncRpc } from "./sync-rpc";
import { BackendError } from "./sync-rpc";

class FakeStore implements SettingsStore {
    data = new Map<string, unknown>();

    constructor(initial: Record<string, unknown> = {}) {
        for (const [key, value] of Object.entries(initial)) {
            this.data.set(key, value);
        }
    }

    async get(key: string): Promise<unknown> {
        return this.data.get(key) ?? null;
    }

    async set(key: string, value: unknown): Promise<void> {
        if (value === null) {
            this.data.delete(key);
        } else {
            this.data.set(key, value);
        }
    }
}

function output(extra: Partial<SyncOutput> = {}): SyncOutput {
    return { hostNumber: 0, serverMessage: "", required: Required.NO_CHANGES, serverMediaUsn: 42, ...extra };
}

type FakeRpc = SyncRpc & { calls: string[] };

function fakeRpc(overrides: Partial<SyncRpc> = {}): FakeRpc {
    const calls: string[] = [];
    return {
        calls,
        async syncLogin(username, password, endpoint) {
            calls.push(`syncLogin ${username} ${password} ${endpoint ?? "-"}`);
            return "hkey-1";
        },
        async syncStatus() {
            calls.push("syncStatus");
            return { required: SyncStatusResponse_Required.NO_CHANGES };
        },
        async syncCollection(auth, syncMedia) {
            calls.push(`syncCollection ${auth.hkey} ${auth.endpoint ?? "-"} ${syncMedia}`);
            return output();
        },
        async fullUploadOrDownload(auth, upload, serverUsn) {
            calls.push(`full ${upload ? "upload" : "download"} ${serverUsn ?? "-"}`);
        },
        async syncMedia(auth) {
            calls.push(`syncMedia ${auth.hkey}`);
        },
        async mediaSyncStatus() {
            calls.push("mediaSyncStatus");
            return { active: false };
        },
        async latestProgress() {
            return { kind: "none" };
        },
        async abortSync() {
            calls.push("abortSync");
        },
        async abortMediaSync() {
            calls.push("abortMediaSync");
        },
        async setWantsAbort() {
            calls.push("setWantsAbort");
        },
        ...overrides,
    };
}

interface Script {
    login?: ({ username: string; password: string } | null)[];
    prompt?: number[];
}

interface Harness {
    controller: SyncController;
    rpc: FakeRpc;
    store: FakeStore;
    seen: SyncPhase[];
    notices: string[];
    hookCalls: string[];
}

/** A controller whose prompts are answered from a script, as the panel would. */
function harness(options: { rpc?: FakeRpc; store?: FakeStore; script?: Script } = {}): Harness {
    const rpc = options.rpc ?? fakeRpc();
    const store = options.store ?? new FakeStore();
    const script = options.script ?? {};
    const notices: string[] = [];
    const hookCalls: string[] = [];
    const controller = new SyncController(
        rpc,
        store,
        {
            notify: (message) => notices.push(message),
            willFullSync: () => hookCalls.push("willFullSync"),
            didFullSync: () => {
                hookCalls.push("didFullSync");
            },
            didSync: () => {
                hookCalls.push("didSync");
            },
        },
        { progressMs: 2, mediaMs: 1, lingerMs: 0 },
    );
    const seen: SyncPhase[] = [];
    controller.state.subscribe((state) => {
        seen.push(state);
        setTimeout(() => {
            if (state.phase === "login") {
                const answer = script.login?.shift();
                if (answer === undefined) {
                    return;
                }
                if (answer) {
                    controller.submitLogin(answer.username, answer.password);
                } else {
                    controller.cancelLogin();
                }
            } else if (state.phase === "prompt") {
                controller.answerPrompt(script.prompt?.shift() ?? state.defaultIndex);
            } else if (state.phase === "message") {
                controller.dismiss();
            }
        }, 0);
    });
    return { controller, rpc, store, seen, notices, hookCalls };
}

function phases(seen: SyncPhase[]): string[] {
    return seen.map((s) => s.phase);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const loggedIn = () => new FakeStore({ syncKey: "key", syncUser: "me@example.com" });

describe("settings", () => {
    it("defaults media and auto sync to on, like the Qt profile", async () => {
        const settings = await loadSyncSettings(new FakeStore());
        expect(settings).toEqual({
            syncKey: null,
            syncUser: null,
            currentSyncUrl: null,
            customSyncUrl: null,
            syncMedia: true,
            autoSync: true,
            hostNum: 0,
            autoSyncMediaMinutes: 15,
        });
        expect(syncAuth(settings)).toBeNull();
        expect(canAutoSync(settings)).toBe(false);
    });

    it("prefers the server's redirect over a custom server", async () => {
        const store = new FakeStore({
            syncKey: "k",
            customSyncUrl: "https://custom/",
            syncMedia: false,
            autoSync: false,
        });
        let settings = await loadSyncSettings(store);
        expect(syncEndpoint(settings)).toBe("https://custom/");
        expect(syncAuth(settings)).toEqual({ hkey: "k", endpoint: "https://custom/" });
        expect(settings.syncMedia).toBe(false);
        expect(canAutoSync(settings)).toBe(false);

        await store.set("currentSyncUrl", "https://sync3.ankiweb.net/");
        await store.set("autoSync", true);
        settings = await loadSyncSettings(store);
        expect(syncEndpoint(settings)).toBe("https://sync3.ankiweb.net/");
        expect(canAutoSync(settings)).toBe(true);
    });
});

describe("decisions", () => {
    it("classifies errors the way handle_sync_error does", () => {
        expect(classifySyncError(new BackendError("wrong password", "SYNC_AUTH_ERROR")).kind).toBe("auth");
        expect(classifySyncError(new BackendError("Interrupted", "INTERRUPTED")).kind).toBe("interrupted");
        expect(classifySyncError(new Error("500: Interrupted")).kind).toBe("interrupted");
        expect(classifySyncError(new Error("Interrupted")).kind).toBe("interrupted");
        expect(classifySyncError(new BackendError("server busy", "SYNC_OTHER_ERROR"))).toEqual({
            kind: "other",
            message: "server busy",
        });
        expect(classifySyncError("boom")).toEqual({ kind: "other", message: "boom" });
    });

    it("maps the required action onto the full sync steps", () => {
        expect(stepAfterSync(Required.NO_CHANGES)).toBe("done");
        expect(stepAfterSync(Required.FULL_DOWNLOAD)).toBe("confirmDownload");
        expect(stepAfterSync(Required.FULL_UPLOAD)).toBe("confirmUpload");
        expect(stepAfterSync(Required.FULL_SYNC)).toBe("conflict");
        expect(stepAfterSync(Required.NORMAL_SYNC)).toBe("conflict");
    });

    it("only passes the media usn on when media syncing is enabled", () => {
        expect(mediaUsnForFullSync(output({ serverMediaUsn: 7 }), true)).toBe(7);
        expect(mediaUsnForFullSync(output({ serverMediaUsn: 7 }), false)).toBeUndefined();
    });

    it("records the host number and a new endpoint", () => {
        expect(settingsPatchFromSync(output({ hostNumber: 3 }))).toEqual({ hostNum: 3 });
        expect(settingsPatchFromSync(output({ newEndpoint: "https://sync5/" }))).toEqual({
            hostNum: 0,
            currentSyncUrl: "https://sync5/",
        });
    });

    it("describes progress like the Qt timers", () => {
        const labels = { full: "Uploading...", checking: "Checking..." };
        expect(describeProgress({ kind: "normal", stage: "Decks", added: "+1", removed: "-2" }, labels)).toEqual({
            title: "Decks",
            lines: ["+1", "-2"],
        });
        expect(describeProgress({ kind: "full", transferred: 2048, total: 4096 }, labels)).toEqual({
            lines: ["Uploading..."],
            value: 2,
            max: 4,
        });
        expect(describeProgress({ kind: "full", transferred: 4096, total: 4096 }, labels)?.lines).toEqual([
            "Checking...",
        ]);
        expect(describeProgress({ kind: "media", added: "a", removed: "r", checked: "c" }, labels)).toEqual({
            lines: ["a, r, c"],
        });
        expect(describeProgress({ kind: "none" }, labels)).toBeNull();
    });
});

describe("SyncController", () => {
    it("asks to log in without credentials and does nothing when cancelled", async () => {
        const h = harness({ script: { login: [null] } });
        await h.controller.sync();
        expect(phases(h.seen)).toEqual(["idle", "login", "idle"]);
        expect(h.rpc.calls).toEqual([]);
        expect(h.store.data.size).toBe(0);
    });

    it("logs in, stores the credentials and syncs", async () => {
        const h = harness({ script: { login: [{ username: " me@example.com ", password: "pw" }] } });
        await h.controller.sync();
        await sleep(5);
        expect(h.rpc.calls).toEqual([
            "syncLogin me@example.com pw -",
            "syncCollection hkey-1 - true",
            "mediaSyncStatus",
            "syncStatus",
        ]);
        expect(h.store.data.get("syncKey")).toBe("hkey-1");
        expect(h.store.data.get("syncUser")).toBe("me@example.com");
        expect(h.notices).toHaveLength(1);
        expect(h.hookCalls).toEqual(["didSync"]);
        expect(phases(h.seen)).toEqual(["idle", "login", "progress", "progress", "idle", "media", "media", "idle"]);
        expect(get(h.controller.status)).toBe(SyncStatusResponse_Required.NO_CHANGES);
    });

    it("re-prompts with what was typed after an incomplete entry or a wrong password", async () => {
        const rpc = fakeRpc({
            async syncLogin(username, password) {
                rpc.calls.push(`syncLogin ${password}`);
                if (password === "bad") {
                    throw new BackendError("Email or password was incorrect", "SYNC_AUTH_ERROR");
                }
                return "hkey-2";
            },
        });
        const h = harness({
            rpc,
            script: {
                login: [
                    { username: "me", password: "" },
                    { username: "me", password: "bad" },
                    { username: "me", password: "good" },
                ],
            },
        });
        await h.controller.sync();
        const logins = h.seen.filter((s) => s.phase === "login");
        expect(logins.map((s) => s.phase === "login" && s.username)).toEqual(["", "me", "me"]);
        expect(h.seen.filter((s) => s.phase === "message").map((s) => s.phase === "message" && s.text)).toEqual([
            "Email or password was incorrect",
        ]);
        expect(h.store.data.get("syncKey")).toBe("hkey-2");
        expect(rpc.calls.filter((c) => c.startsWith("syncLogin"))).toEqual(["syncLogin bad", "syncLogin good"]);
    });

    it("uses the configured endpoint for login and sync", async () => {
        const store = new FakeStore({ customSyncUrl: "https://custom/" });
        const h = harness({ store, script: { login: [{ username: "u", password: "p" }] } });
        await h.controller.sync();
        expect(h.rpc.calls[0]).toBe("syncLogin u p https://custom/");
        expect(h.rpc.calls[1]).toBe("syncCollection hkey-1 https://custom/ true");
    });

    it("records the host number and endpoint and shows the server message", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                return output({ hostNumber: 3, newEndpoint: "https://sync3/", serverMessage: "<b>Hello</b>" });
            },
        });
        const h = harness({ rpc, store: loggedIn() });
        await h.controller.sync();
        expect(h.store.data.get("hostNum")).toBe(3);
        expect(h.store.data.get("currentSyncUrl")).toBe("https://sync3/");
        const messages = h.seen.filter((s) => s.phase === "message");
        expect(messages).toEqual([{ phase: "message", text: "<b>Hello</b>", html: true }]);
    });

    it("clears the credentials after an auth error", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                throw new BackendError("Email or password was incorrect", "SYNC_AUTH_ERROR");
            },
        });
        const store = new FakeStore({ syncKey: "k", syncUser: "u", hostNum: 2, currentSyncUrl: "https://x/" });
        const h = harness({ rpc, store });
        await h.controller.sync();
        expect(store.data.size).toBe(0);
        expect(phases(h.seen)).toContain("message");
        expect(h.hookCalls).toEqual([]);
        // The status check that follows a sync finds no credentials.
        await sleep(1);
        expect(get(h.controller.status)).toBe(SyncStatusResponse_Required.NO_CHANGES);
    });

    it("says nothing about an interrupted sync", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                throw new BackendError("Interrupted", "INTERRUPTED");
            },
        });
        const h = harness({ rpc, store: loggedIn() });
        await h.controller.sync();
        expect(phases(h.seen)).toEqual(["idle", "progress", "idle"]);
        expect(h.store.data.get("syncKey")).toBe("key");
    });

    it("offers upload, download and cancel on a conflict, defaulting to cancel", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                return output({ required: Required.FULL_SYNC });
            },
        });
        const h = harness({ rpc, store: loggedIn(), script: { prompt: [0] } });
        await h.controller.sync();
        await sleep(5);
        const prompt = h.seen.find((s) => s.phase === "prompt");
        expect(prompt?.phase === "prompt" && prompt.buttons.length).toBe(3);
        expect(prompt?.phase === "prompt" && prompt.defaultIndex).toBe(2);
        expect(prompt?.phase === "prompt" && prompt.markdown).toBe(true);
        expect(h.rpc.calls).toContain("full upload 42");
        expect(h.hookCalls).toEqual(["willFullSync", "didFullSync"]);
        expect(h.rpc.calls.filter((c) => c === "mediaSyncStatus")).toHaveLength(1);
        expect(get(h.controller.state)).toEqual({ phase: "idle" });
    });

    it("downloads on the conflict's second button", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                return output({ required: Required.FULL_SYNC });
            },
        });
        const h = harness({ rpc, store: loggedIn(), script: { prompt: [1] } });
        await h.controller.sync();
        expect(h.rpc.calls).toContain("full download 42");
    });

    it("confirms an empty-collection download and respects cancel", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                return output({ required: Required.FULL_DOWNLOAD });
            },
        });
        const h = harness({ rpc, store: loggedIn(), script: { prompt: [1] } });
        await h.controller.sync();
        const prompt = h.seen.find((s) => s.phase === "prompt");
        expect(prompt?.phase === "prompt" && prompt.buttons.length).toBe(2);
        expect(prompt?.phase === "prompt" && prompt.defaultIndex).toBe(0);
        expect(h.rpc.calls.some((c) => c.startsWith("full"))).toBe(false);
        expect(h.hookCalls).toEqual([]);
        expect(get(h.controller.state)).toEqual({ phase: "idle" });
    });

    it("confirms an empty-AnkiWeb upload", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                return output({ required: Required.FULL_UPLOAD });
            },
        });
        const h = harness({ rpc, store: loggedIn(), script: { prompt: [0] } });
        await h.controller.sync();
        expect(h.rpc.calls).toContain("full upload 42");
    });

    it("skips media when media syncing is off", async () => {
        let mediaRequested: boolean | undefined;
        const rpc = fakeRpc({
            async syncCollection(_auth, syncMedia) {
                mediaRequested = syncMedia;
                return output({ required: Required.FULL_DOWNLOAD });
            },
        });
        const store = loggedIn();
        await store.set("syncMedia", false);
        const h = harness({ rpc, store, script: { prompt: [0] } });
        await h.controller.sync();
        expect(mediaRequested).toBe(false);
        expect(h.rpc.calls).toContain("full download -");
        expect(h.rpc.calls).not.toContain("mediaSyncStatus");
    });

    it("reports a failed full sync after the collection was reopened", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                return output({ required: Required.FULL_UPLOAD });
            },
            async fullUploadOrDownload() {
                throw new BackendError("AnkiWeb encountered a problem", "SYNC_OTHER_ERROR");
            },
        });
        const h = harness({ rpc, store: loggedIn(), script: { prompt: [0] } });
        await h.controller.sync();
        expect(h.hookCalls).toEqual(["willFullSync", "didFullSync"]);
        expect(h.seen.filter((s) => s.phase === "message")).toEqual([
            { phase: "message", text: "AnkiWeb encountered a problem", html: false },
        ]);
        expect(h.rpc.calls).not.toContain("mediaSyncStatus");
    });

    it("shows sync progress while the collection syncs", async () => {
        const rpc = fakeRpc({
            async syncCollection() {
                await sleep(25);
                return output();
            },
            async latestProgress() {
                return { kind: "normal", stage: "Decks", added: "Added: 1", removed: "Removed: 0" };
            },
        });
        const h = harness({ rpc, store: loggedIn() });
        await h.controller.sync();
        expect(h.seen).toContainEqual({ phase: "progress", title: "Decks", lines: ["Added: 1", "Removed: 0"] });
    });

    it("aborts a running sync through abortSync", async () => {
        const holder: { controller?: SyncController } = {};
        const rpc = fakeRpc({
            async syncCollection() {
                await holder.controller?.abort();
                throw new BackendError("Interrupted", "INTERRUPTED");
            },
        });
        const h = harness({ rpc, store: loggedIn() });
        holder.controller = h.controller;
        await h.controller.sync();
        expect(h.rpc.calls.filter((c) => c !== "syncStatus")).toEqual(["abortSync"]);
        expect(phases(h.seen)).not.toContain("message");
    });

    it("follows the media sync and can abort it", async () => {
        let polls = 0;
        const holder: { controller?: SyncController } = {};
        const rpc = fakeRpc({
            async mediaSyncStatus() {
                polls += 1;
                if (polls === 1) {
                    return {
                        active: true,
                        progress: { added: "Added: 1", removed: "Removed: 0", checked: "Checked: 5" },
                    };
                }
                if (polls === 2) {
                    await holder.controller?.abort();
                    throw new BackendError("Interrupted", "INTERRUPTED");
                }
                return { active: false };
            },
        });
        const h = harness({ rpc, store: loggedIn() });
        holder.controller = h.controller;
        await h.controller.sync();
        const media = h.seen.filter((s) => s.phase === "media").map((s) => s.phase === "media" && [s.text, s.active]);
        expect(media[1]).toEqual(["Added: 1, Removed: 0, Checked: 5", true]);
        expect(h.rpc.calls).toContain("setWantsAbort");
        expect(h.rpc.calls).toContain("abortMediaSync");
        expect(media.at(-1)?.[1]).toBe(false);
        expect(phases(h.seen)).not.toContain("message");
    });

    it("ignores a second sync while one is running", async () => {
        let resolveSync: (() => void) | undefined;
        let syncs = 0;
        const rpc = fakeRpc({
            async syncCollection() {
                syncs += 1;
                await new Promise<void>((resolve) => (resolveSync = resolve));
                return output();
            },
        });
        const h = harness({ rpc, store: loggedIn() });
        const first = h.controller.sync();
        await sleep(1);
        await h.controller.sync();
        resolveSync?.();
        await first;
        expect(syncs).toBe(1);
    });

    it("auto-syncs only with credentials and the setting on", async () => {
        expect(await harness().controller.autoSync()).toBe(false);
        const off = loggedIn();
        await off.set("autoSync", false);
        const offHarness = harness({ store: off });
        expect(await offHarness.controller.autoSync()).toBe(false);
        expect(offHarness.rpc.calls).toEqual([]);
        const on = harness({ store: loggedIn() });
        expect(await on.controller.autoSync()).toBe(true);
        expect(on.rpc.calls[0]).toBe("syncCollection key - true");
    });

    it("refreshes the status, persists a redirect and swallows errors", async () => {
        let fail = false;
        const rpc = fakeRpc({
            async syncStatus() {
                if (fail) {
                    throw new Error("offline");
                }
                return { required: SyncStatusResponse_Required.NORMAL_SYNC, newEndpoint: "https://sync9/" };
            },
        });
        const h = harness({ rpc, store: loggedIn() });
        await h.controller.refreshStatus();
        expect(get(h.controller.status)).toBe(SyncStatusResponse_Required.NORMAL_SYNC);
        expect(h.store.data.get("currentSyncUrl")).toBe("https://sync9/");
        fail = true;
        await h.controller.refreshStatus();
        expect(get(h.controller.status)).toBe(SyncStatusResponse_Required.NORMAL_SYNC);
    });
});

describe("periodic media sync", () => {
    async function loggedIn(extra: Record<string, unknown> = {}): Promise<FakeStore> {
        const store = new FakeStore();
        await store.set("syncKey", "hkey-x");
        for (const [key, value] of Object.entries(extra)) {
            await store.set(key, value);
        }
        return store;
    }

    it("runs a media-only sync once the interval has passed, quietly", async () => {
        const { controller, rpc, seen, notices } = harness({ store: await loggedIn() });
        const start = Date.now();
        expect(await controller.periodicMediaSync(start)).toBe(true);
        expect(rpc.calls).toEqual(["syncMedia hkey-x", "mediaSyncStatus"]);
        // Background: no sheet, no notice.
        expect(seen.filter((s) => s.phase !== "idle")).toEqual([]);
        expect(notices).toEqual([]);

        // Too soon for another (default 15 minutes)...
        expect(await controller.periodicMediaSync(start + 60_000)).toBe(false);
        expect(rpc.calls).toHaveLength(2);
        // ...until the interval has passed since the last one finished.
        expect(await controller.periodicMediaSync(Date.now() + 16 * 60_000)).toBe(true);
        expect(rpc.calls).toHaveLength(4);
    });

    it("does nothing when logged out, media sync is off, or the interval is 0", async () => {
        const loggedOut = harness();
        expect(await loggedOut.controller.periodicMediaSync()).toBe(false);
        expect(loggedOut.rpc.calls).toEqual([]);

        const mediaOff = harness({ store: await loggedIn({ syncMedia: false }) });
        expect(await mediaOff.controller.periodicMediaSync()).toBe(false);
        expect(mediaOff.rpc.calls).toEqual([]);

        const disabled = harness({ store: await loggedIn({ autoSyncMediaMinutes: 0 }) });
        expect(await disabled.controller.periodicMediaSync()).toBe(false);
        expect(disabled.rpc.calls).toEqual([]);
    });

    it("reports a failure to start as a notice and does not block later runs", async () => {
        const rpc = fakeRpc({
            async syncMedia() {
                throw new Error("offline");
            },
        });
        const { controller, notices } = harness({ rpc, store: await loggedIn() });
        expect(await controller.periodicMediaSync()).toBe(true);
        expect(notices).toEqual(["offline"]);
        expect(await controller.periodicMediaSync(Date.now() + 16 * 60_000)).toBe(true);
    });
});
