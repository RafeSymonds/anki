// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

import { type UpdateApi, type UpdateCheck, UpdateController } from "./updates";

function setup(check: UpdateCheck = { status: "available", version: "0.2.0" }) {
    const api: UpdateApi = {
        check: vi.fn(async () => check),
        download: vi.fn(() => Promise.resolve()),
        restart: vi.fn(() => Promise.resolve()),
    };
    const messages: string[] = [];
    const controller = new UpdateController(api, (message) => messages.push(message));
    return { api, messages, controller };
}

describe("update controller", () => {
    it("goes from a found update through download to restart", async () => {
        const { api, controller } = setup();
        await controller.checkQuietly();
        expect(get(controller.state)).toEqual({ phase: "available", version: "0.2.0" });

        await controller.download();
        expect(api.download).toHaveBeenCalledOnce();
        expect(get(controller.state)).toEqual({ phase: "ready", version: "0.2.0" });

        expect(await controller.restart()).toBe(true);
        expect(api.restart).toHaveBeenCalledOnce();
        expect(get(controller.state)).toEqual({ phase: "restarting", version: "0.2.0" });
    });

    it("stays quiet at launch unless there is an update", async () => {
        for (
            const check of [
                { status: "current", version: "0.2.0" },
                { status: "unsupported", reason: "dev build" },
            ] as UpdateCheck[]
        ) {
            const { messages, controller } = setup(check);
            await controller.checkQuietly();
            expect(get(controller.state)).toEqual({ phase: "none" });
            expect(messages).toEqual([]);
        }
        const { api, messages, controller } = setup();
        vi.mocked(api.check).mockRejectedValue(new Error("offline"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await controller.checkQuietly();
        warn.mockRestore();
        expect(get(controller.state)).toEqual({ phase: "none" });
        expect(messages).toEqual([]);
    });

    it("always answers Check for Updates", async () => {
        const latest = setup({ status: "current", version: "0.2.0" });
        await latest.controller.checkNow();
        expect(latest.messages).toEqual(["Anki 0.2.0 is the latest version."]);

        const devBuild = setup({ status: "unsupported", reason: "Not here." });
        await devBuild.controller.checkNow();
        expect(devBuild.messages).toEqual(["Not here."]);

        const found = setup();
        await found.controller.checkNow();
        expect(found.messages).toEqual(["Anki 0.2.0 is available."]);

        const offline = setup();
        vi.mocked(offline.api.check).mockRejectedValue(new Error("checkForUpdate: 400 offline"));
        await offline.controller.checkNow();
        expect(offline.messages).toEqual(["Could not check for updates. offline"]);
    });

    it("does not check again once a download has started", async () => {
        const { api, messages, controller } = setup();
        await controller.checkQuietly();
        await controller.download();
        vi.mocked(api.check).mockClear();

        await controller.checkQuietly();
        await controller.checkNow();
        expect(api.check).not.toHaveBeenCalled();
        expect(get(controller.state)).toEqual({ phase: "ready", version: "0.2.0" });
        expect(messages).toEqual(["An update is already on its way."]);
    });

    it("can retry after a failed download", async () => {
        const { api, messages, controller } = setup();
        await controller.checkQuietly();
        vi.mocked(api.download).mockRejectedValueOnce(new Error("downloadUpdate: 400 bad signature"));
        await controller.download();
        expect(get(controller.state)).toEqual({ phase: "available", version: "0.2.0" });
        expect(messages).toEqual(["Could not download the update. bad signature"]);

        await controller.download();
        expect(get(controller.state)).toEqual({ phase: "ready", version: "0.2.0" });
    });

    it("stays ready after a failed install", async () => {
        const { api, messages, controller } = setup();
        await controller.checkQuietly();
        await controller.download();
        vi.mocked(api.restart).mockRejectedValueOnce(new Error("restartToUpdate: 400 denied"));
        expect(await controller.restart()).toBe(false);
        expect(get(controller.state)).toEqual({ phase: "ready", version: "0.2.0" });
        expect(messages).toEqual(["Could not install the update. denied"]);
    });

    it("ignores steps taken out of order", async () => {
        const { api, controller } = setup();
        await controller.download();
        expect(await controller.restart()).toBe(false);
        expect(api.download).not.toHaveBeenCalled();
        expect(api.restart).not.toHaveBeenCalled();
    });
});
