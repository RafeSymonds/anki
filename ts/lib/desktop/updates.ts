// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Updating from the newest GitHub release (desktop/src/updater.rs). Nothing
 * interrupts the user until they press Restart: a background check offers the
 * update, and downloading leaves the app usable.
 */

import { writable } from "svelte/store";

/** How often a long-running app looks again, on top of the check at launch. */
export const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

export type UpdateCheck =
    | { status: "unsupported"; reason: string }
    | { status: "current"; version: string }
    | { status: "available"; version: string };

export interface UpdateApi {
    check(): Promise<UpdateCheck>;
    download(): Promise<void>;
    /** Replaces the app and relaunches; only returns if that failed. */
    restart(): Promise<void>;
}

export type UpdatePhase =
    | { phase: "none" }
    | { phase: "available" | "downloading" | "ready" | "restarting"; version: string };

/** The host's message, without the command and status `post` puts in front. */
function reason(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return message.replace(/^\w+: \d+ /, "");
}

export class UpdateController {
    readonly state = writable<UpdatePhase>({ phase: "none" });
    private phase: UpdatePhase = { phase: "none" };

    constructor(
        private readonly api: UpdateApi,
        private readonly notify: (message: string) => void,
    ) {}

    private set(phase: UpdatePhase): void {
        this.phase = phase;
        this.state.set(phase);
    }

    /** Once a download has started, a check has nothing left to add. */
    private busy(): boolean {
        return !["none", "available"].includes(this.phase.phase);
    }

    private async refresh(): Promise<UpdateCheck> {
        const result = await this.api.check();
        this.set(
            result.status === "available"
                ? { phase: "available", version: result.version }
                : { phase: "none" },
        );
        return result;
    }

    /** The launch and periodic check: says nothing unless there is an update. */
    async checkQuietly(): Promise<void> {
        if (this.busy()) {
            return;
        }
        try {
            await this.refresh();
        } catch (err) {
            console.warn("update check failed", err);
        }
    }

    /** Check for Updates in the menu: always answers. */
    async checkNow(): Promise<void> {
        if (this.busy()) {
            this.notify("An update is already on its way.");
            return;
        }
        try {
            const result = await this.refresh();
            if (result.status === "unsupported") {
                this.notify(result.reason);
            } else if (result.status === "current") {
                this.notify(`Anki ${result.version} is the latest version.`);
            } else {
                this.notify(`Anki ${result.version} is available.`);
            }
        } catch (err) {
            this.notify(`Could not check for updates. ${reason(err)}`);
        }
    }

    async download(): Promise<void> {
        if (this.phase.phase !== "available") {
            return;
        }
        const { version } = this.phase;
        this.set({ phase: "downloading", version });
        try {
            await this.api.download();
            this.set({ phase: "ready", version });
        } catch (err) {
            this.set({ phase: "available", version });
            this.notify(`Could not download the update. ${reason(err)}`);
        }
    }

    /** Returns false when the install failed and the app carries on. */
    async restart(): Promise<boolean> {
        if (this.phase.phase !== "ready") {
            return false;
        }
        const { version } = this.phase;
        this.set({ phase: "restarting", version });
        try {
            await this.api.restart();
            return true;
        } catch (err) {
            this.set({ phase: "ready", version });
            this.notify(`Could not install the update. ${reason(err)}`);
            return false;
        }
    }
}
