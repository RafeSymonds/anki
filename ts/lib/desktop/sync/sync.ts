// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * AnkiWeb synchronisation for the shell: a port of qt/aqt/sync.py
 * (sync_collection, full_sync, full_upload/full_download, sync_login,
 * handle_sync_error, get_sync_status), the sync entry points in
 * qt/aqt/main.py and the media sync monitoring in qt/aqt/mediasync.py.
 *
 * The decisions are pure functions. `SyncController` runs the flow against
 * an injected `SyncRpc`, settings store and hooks, and publishes what the
 * user should see as a Svelte store (`state`) that SyncPanel.svelte renders;
 * the panel answers prompts through `submitLogin`, `answerPrompt`, `abort`
 * and `dismiss`.
 */

import {
    SyncCollectionResponse_ChangesRequired as Required,
    SyncStatusResponse_Required,
} from "@generated/anki/sync_pb";
import * as tr from "@generated/ftl";
import type { Readable } from "svelte/store";
import { get, writable } from "svelte/store";

import type { SyncAuthInput, SyncOutput, SyncProgress, SyncRpc } from "./sync-rpc";

/** qt-misc-sync is Qt-only; the TS bundle has no "Sync" string. */
export const SYNC_TITLE = "Sync";

// Settings (profiles.py)
// ---------------------------------------------------------------------------

/** The Qt profile keys, kept under the same names in desktop-settings.json. */
export interface SyncSettings {
    syncKey: string | null;
    syncUser: string | null;
    /** The endpoint the server last redirected us to. */
    currentSyncUrl: string | null;
    /** A self-hosted server chosen by the user. */
    customSyncUrl: string | null;
    syncMedia: boolean;
    autoSync: boolean;
    hostNum: number;
}

export interface SettingsStore {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" && value !== "" ? value : null;
}

export async function loadSyncSettings(store: SettingsStore): Promise<SyncSettings> {
    const [syncKey, syncUser, currentSyncUrl, customSyncUrl, syncMedia, autoSync, hostNum] = await Promise.all(
        ["syncKey", "syncUser", "currentSyncUrl", "customSyncUrl", "syncMedia", "autoSync", "hostNum"].map((key) =>
            store.get(key)
        ),
    );
    return {
        syncKey: stringOrNull(syncKey),
        syncUser: stringOrNull(syncUser),
        currentSyncUrl: stringOrNull(currentSyncUrl),
        customSyncUrl: stringOrNull(customSyncUrl),
        // profile.get("syncMedia", True) / profile.get("autoSync", True)
        syncMedia: typeof syncMedia === "boolean" ? syncMedia : true,
        autoSync: typeof autoSync === "boolean" ? autoSync : true,
        hostNum: typeof hostNum === "number" ? hostNum : 0,
    };
}

/** profiles.py sync_endpoint: the server's redirect wins over a custom URL. */
export function syncEndpoint(settings: SyncSettings): string | undefined {
    return settings.currentSyncUrl ?? settings.customSyncUrl ?? undefined;
}

/** profiles.py sync_auth: null until the user has logged in. */
export function syncAuth(settings: SyncSettings): SyncAuthInput | null {
    if (!settings.syncKey) {
        return null;
    }
    return { hkey: settings.syncKey, endpoint: syncEndpoint(settings) };
}

/** main.py can_auto_sync: credentials exist and syncing on open/close is on. */
export function canAutoSync(settings: SyncSettings): boolean {
    return !!settings.syncKey && settings.autoSync;
}

/** profiles.py clear_sync_auth. */
export async function clearSyncAuth(store: SettingsStore): Promise<void> {
    for (const key of ["syncKey", "syncUser", "hostNum", "currentSyncUrl"]) {
        await store.set(key, null);
    }
}

// Decisions (sync.py)
// ---------------------------------------------------------------------------

export type SyncErrorKind = "auth" | "interrupted" | "other";

/** Maps a failed call onto what handle_sync_error distinguishes. */
export function classifySyncError(err: unknown): { kind: SyncErrorKind; message: string } {
    const message = err instanceof Error ? err.message : String(err);
    const kind = typeof err === "object" && err !== null ? String((err as { kind?: unknown }).kind ?? "") : "";
    if (kind === "SYNC_AUTH_ERROR") {
        return { kind: "auth", message };
    }
    // postProto-style messages carry the status in development builds.
    if (kind === "INTERRUPTED" || /^(\d+: )?Interrupted$/.test(message)) {
        return { kind: "interrupted", message };
    }
    return { kind: "other", message };
}

export type FullSyncStep = "done" | "confirmDownload" | "confirmUpload" | "conflict";

/** What sync_collection's on_future_done and full_sync do with `required`. */
export function stepAfterSync(required: Required): FullSyncStep {
    switch (required) {
        case Required.NO_CHANGES:
            return "done";
        case Required.FULL_DOWNLOAD:
            return "confirmDownload";
        case Required.FULL_UPLOAD:
            return "confirmUpload";
        default:
            return "conflict";
    }
}

/** full_sync's server_usn: media is only synced afterwards when enabled. */
export function mediaUsnForFullSync(out: SyncOutput, mediaEnabled: boolean): number | undefined {
    return mediaEnabled ? out.serverMediaUsn : undefined;
}

/** The profile updates sync_collection's on_future_done makes. */
export function settingsPatchFromSync(out: SyncOutput): Record<string, unknown> {
    const patch: Record<string, unknown> = { hostNum: out.hostNumber || 0 };
    if (out.newEndpoint) {
        patch.currentSyncUrl = out.newEndpoint;
    }
    return patch;
}

export interface ProgressView {
    title?: string;
    lines: string[];
    /** Kilobytes transferred / total, like on_full_sync_timer. */
    value?: number;
    max?: number;
}

/** on_normal_sync_timer / on_full_sync_timer: what to show for a progress report. */
export function describeProgress(
    progress: SyncProgress,
    labels: { full: string; checking: string },
): ProgressView | null {
    switch (progress.kind) {
        case "normal":
            return { title: progress.stage, lines: [progress.added, progress.removed] };
        case "full":
            return {
                lines: [progress.transferred === progress.total ? labels.checking : labels.full],
                value: Math.floor(progress.transferred / 1024),
                max: Math.floor(progress.total / 1024),
            };
        case "media":
            return { lines: [mediaProgressText(progress)] };
        default:
            return null;
    }
}

/** MediaSyncer.monitor's log line. */
export function mediaProgressText(p: { added: string; removed: string; checked: string }): string {
    return `${p.added}, ${p.removed}, ${p.checked}`;
}

// The flow
// ---------------------------------------------------------------------------

export interface PromptButton {
    label: string;
    /** Rendered as the primary action. */
    primary?: boolean;
}

export type SyncPhase =
    | { phase: "idle" }
    | { phase: "login"; username: string; password: string }
    | { phase: "progress"; title: string; lines: string[]; value?: number; max?: number }
    | { phase: "prompt"; text: string; markdown: boolean; buttons: PromptButton[]; defaultIndex: number }
    | { phase: "message"; text: string; html: boolean }
    | { phase: "media"; text: string; active: boolean };

export interface SyncHooks {
    /** A short notice, like Qt's tooltip(). */
    notify(message: string): void;
    /** gui_hooks.collection_will_temporarily_close: leave screens holding collection state. */
    willFullSync?(): void;
    /** mw.reopen(after_full_sync=True) + mw.reset(): make sure the collection is open, reload views. */
    didFullSync?(): Promise<void> | void;
    /** mw.reset() after a normal sync. */
    didSync?(): Promise<void> | void;
}

export interface SyncTiming {
    progressMs: number;
    mediaMs: number;
    /** How long the final media status stays visible. */
    lingerMs: number;
}

const DEFAULT_TIMING: SyncTiming = { progressMs: 150, mediaMs: 250, lingerMs: 2500 };

type LoginAnswer = { username: string; password: string } | null;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SyncController {
    /** What SyncPanel shows. */
    readonly state = writable<SyncPhase>({ phase: "idle" });
    /** True while a collection sync runs, for the toolbar spinner. */
    readonly syncing = writable(false);
    /** get_sync_status's answer, for the toolbar colour; null until checked. */
    readonly status = writable<SyncStatusResponse_Required | null>(null);

    private pending: ((answer: unknown) => void) | null = null;
    private busy = false;
    private readonly timing: SyncTiming;

    constructor(
        private readonly rpc: SyncRpc,
        private readonly store: SettingsStore,
        private readonly hooks: SyncHooks,
        timing: Partial<SyncTiming> = {},
    ) {
        this.timing = { ...DEFAULT_TIMING, ...timing };
    }

    get phase(): Readable<SyncPhase> {
        return this.state;
    }

    /** main.py on_sync_button_clicked: log in if needed, then sync. A
     * second request while one runs (including its media sync) is ignored. */
    async sync(): Promise<void> {
        if (this.busy) {
            return;
        }
        this.busy = true;
        this.syncing.set(true);
        try {
            let settings = await loadSyncSettings(this.store);
            let auth = syncAuth(settings);
            if (!auth) {
                if (!(await this.login(settings))) {
                    return;
                }
                settings = await loadSyncSettings(this.store);
                auth = syncAuth(settings);
                if (!auth) {
                    return;
                }
            }
            await this.syncCollection(auth, settings);
        } finally {
            this.finish();
            this.busy = false;
            this.syncing.set(false);
            void this.refreshStatus();
        }
    }

    /** main.py maybe_auto_sync_on_open_close; true if a sync was started. */
    async autoSync(): Promise<boolean> {
        const settings = await loadSyncSettings(this.store);
        if (!canAutoSync(settings)) {
            return false;
        }
        await this.sync();
        return true;
    }

    /** sync.py get_sync_status: cheap unless the server must be asked. Errors are swallowed. */
    async refreshStatus(): Promise<void> {
        const settings = await loadSyncSettings(this.store);
        const auth = syncAuth(settings);
        if (!auth) {
            this.status.set(SyncStatusResponse_Required.NO_CHANGES);
            return;
        }
        try {
            const out = await this.rpc.syncStatus(auth);
            if (out.newEndpoint) {
                await this.store.set("currentSyncUrl", out.newEndpoint);
            }
            this.status.set(out.required);
        } catch (err) {
            console.warn("sync status check failed:", err);
        }
    }

    // Answers from the panel

    submitLogin(username: string, password: string): void {
        const answer: LoginAnswer = { username: username.trim(), password };
        this.resolve(answer);
    }

    cancelLogin(): void {
        this.resolve(null);
    }

    answerPrompt(index: number): void {
        this.resolve(index);
    }

    /** Closes a message. */
    dismiss(): void {
        const current = get(this.state);
        if (current.phase === "message") {
            this.resolve(undefined);
        } else if (current.phase === "media" && !current.active) {
            this.state.set({ phase: "idle" });
        }
    }

    /** The Abort button: a collection sync (col.abort_sync) or the media sync (MediaSyncer.abort). */
    async abort(): Promise<void> {
        const current = get(this.state);
        if (current.phase === "progress") {
            await this.rpc.abortSync();
        } else if (current.phase === "media" && current.active) {
            await this.rpc.setWantsAbort();
            await this.rpc.abortMediaSync();
            this.state.set({ ...current, text: tr.syncMediaAborting() });
        }
    }

    // Internals

    private ask<T>(state: SyncPhase): Promise<T> {
        return new Promise<T>((resolve) => {
            this.pending = resolve as (answer: unknown) => void;
            this.state.set(state);
        });
    }

    private resolve(answer: unknown): void {
        const pending = this.pending;
        this.pending = null;
        pending?.(answer);
    }

    private finish(): void {
        this.pending = null;
        // A finished media sync keeps its last line up until it fades out.
        if (get(this.state).phase !== "media") {
            this.state.set({ phase: "idle" });
        }
    }

    private showMessage(text: string, html = false): Promise<void> {
        return this.ask<void>({ phase: "message", text, html });
    }

    /** sync.py handle_sync_error. */
    private async handleSyncError(err: unknown): Promise<void> {
        const { kind, message } = classifySyncError(err);
        if (kind === "interrupted") {
            return;
        }
        if (kind === "auth") {
            await clearSyncAuth(this.store);
        }
        await this.showMessage(message);
    }

    /** sync.py sync_login + get_id_and_pass_from_user; true once credentials are stored. */
    private async login(settings: SyncSettings): Promise<boolean> {
        let username = settings.syncUser ?? "";
        let password = "";
        for (;;) {
            const answer = await this.ask<LoginAnswer>({ phase: "login", username, password });
            if (!answer) {
                return false;
            }
            ({ username, password } = answer);
            if (!username && !password) {
                return false;
            }
            if (!username || !password) {
                // Qt re-opens the dialog with what was typed.
                continue;
            }
            this.state.set({ phase: "progress", title: SYNC_TITLE, lines: [tr.syncConnecting()] });
            try {
                const hkey = await this.rpc.syncLogin(username, password, syncEndpoint(settings));
                await this.store.set("syncKey", hkey);
                await this.store.set("syncUser", username);
                return true;
            } catch (err) {
                const { kind, message } = classifySyncError(err);
                if (kind === "auth") {
                    await this.showMessage(message);
                    continue;
                }
                await this.handleSyncError(err);
                return false;
            }
        }
    }

    /** sync.py sync_collection. */
    private async syncCollection(auth: SyncAuthInput, settings: SyncSettings): Promise<void> {
        this.state.set({ phase: "progress", title: tr.syncChecking(), lines: [] });
        const stop = this.pollProgress({ full: "", checking: tr.syncChecking() });
        let out: SyncOutput;
        try {
            out = await this.rpc.syncCollection(auth, settings.syncMedia);
        } catch (err) {
            stop();
            await this.handleSyncError(err);
            return;
        }
        stop();
        for (const [key, value] of Object.entries(settingsPatchFromSync(out))) {
            await this.store.set(key, value);
        }
        if (out.serverMessage) {
            await this.showMessage(out.serverMessage, true);
        }
        const step = stepAfterSync(out.required);
        if (step === "done") {
            // Drop the sheet before the notice so it is not shown behind it.
            this.state.set({ phase: "idle" });
            this.hooks.notify(tr.syncCollectionComplete());
            await this.hooks.didSync?.();
            if (settings.syncMedia) {
                // rslib started the media sync in the background; follow it.
                await this.monitorMedia();
            }
            return;
        }
        await this.fullSync(step, auth, mediaUsnForFullSync(out, settings.syncMedia));
    }

    /** sync.py full_sync / confirm_full_download / confirm_full_upload. */
    private async fullSync(step: FullSyncStep, auth: SyncAuthInput, serverUsn: number | undefined): Promise<void> {
        if (step === "confirmDownload") {
            const choice = await this.ask<number>({
                phase: "prompt",
                text: tr.syncConfirmEmptyDownload(),
                markdown: false,
                buttons: [{ label: tr.syncDownloadFromAnkiweb(), primary: true }, { label: tr.syncCancelButton() }],
                defaultIndex: 0,
            });
            if (choice === 0) {
                await this.fullUploadOrDownload(auth, false, serverUsn);
            }
        } else if (step === "confirmUpload") {
            const choice = await this.ask<number>({
                phase: "prompt",
                text: tr.syncConfirmEmptyUpload(),
                markdown: false,
                buttons: [{ label: tr.syncUploadToAnkiweb(), primary: true }, { label: tr.syncCancelButton() }],
                defaultIndex: 0,
            });
            if (choice === 0) {
                await this.fullUploadOrDownload(auth, true, serverUsn);
            }
        } else {
            const choice = await this.ask<number>({
                phase: "prompt",
                text: tr.syncConflictExplanation2(),
                markdown: true,
                buttons: [
                    { label: tr.syncUploadToAnkiweb() },
                    { label: tr.syncDownloadFromAnkiweb() },
                    { label: tr.syncCancelButton(), primary: true },
                ],
                defaultIndex: 2,
            });
            if (choice === 0) {
                await this.fullUploadOrDownload(auth, true, serverUsn);
            } else if (choice === 1) {
                await this.fullUploadOrDownload(auth, false, serverUsn);
            }
        }
    }

    /** sync.py full_upload / full_download. */
    private async fullUploadOrDownload(
        auth: SyncAuthInput,
        upload: boolean,
        serverUsn: number | undefined,
    ): Promise<void> {
        const label = upload ? tr.syncUploadingToAnkiweb() : tr.syncDownloadingFromAnkiweb();
        this.hooks.willFullSync?.();
        this.state.set({ phase: "progress", title: label, lines: [label] });
        const stop = this.pollProgress({ full: label, checking: tr.syncChecking() });
        let failure: unknown = null;
        try {
            await this.rpc.fullUploadOrDownload(auth, upload, serverUsn);
        } catch (err) {
            failure = err;
        }
        stop();
        // rslib reopens the collection itself; this recovers if that failed.
        await this.hooks.didFullSync?.();
        if (failure !== null) {
            await this.handleSyncError(failure);
            return;
        }
        if (serverUsn !== undefined) {
            await this.monitorMedia();
        }
    }

    private pollProgress(labels: { full: string; checking: string }): () => void {
        let inFlight = false;
        const timer = setInterval(async () => {
            if (inFlight) {
                return;
            }
            inFlight = true;
            try {
                const view = describeProgress(await this.rpc.latestProgress(), labels);
                if (view) {
                    this.state.update((s) => (s.phase === "progress" ? { ...s, ...view } : s));
                }
            } catch {
                // A missed progress report is not an error.
            } finally {
                inFlight = false;
            }
        }, this.timing.progressMs);
        return () => clearInterval(timer);
    }

    /** MediaSyncer.start_monitoring / _on_finished / _handle_sync_error. */
    private async monitorMedia(): Promise<void> {
        this.state.set({ phase: "media", text: tr.syncMediaStarting(), active: true });
        let text: string;
        try {
            for (;;) {
                const status = await this.rpc.mediaSyncStatus();
                if (!status.active) {
                    break;
                }
                if (status.progress) {
                    const progress = mediaProgressText(status.progress);
                    this.state.update((s) => (s.phase === "media" ? { ...s, text: progress } : s));
                }
                await sleep(this.timing.mediaMs);
            }
            text = tr.syncMediaComplete();
        } catch (err) {
            const { kind, message } = classifySyncError(err);
            if (kind === "interrupted") {
                text = tr.syncMediaAborted();
            } else {
                text = tr.syncMediaFailed();
                await this.showMessage(message);
            }
        }
        const final: SyncPhase = { phase: "media", text, active: false };
        this.state.set(final);
        setTimeout(() => {
            if (get(this.state) === final) {
                this.state.set({ phase: "idle" });
            }
        }, this.timing.lingerMs);
    }
}
