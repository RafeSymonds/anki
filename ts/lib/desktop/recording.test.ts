// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { chooseMimeType, extensionFor, formatElapsed, recordingName } from "./recording";

describe("recording", () => {
    it("prefers mp4 (WebKit) and falls back to webm (Chromium)", () => {
        expect(chooseMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
        expect(chooseMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
        expect(chooseMimeType(() => false)).toBeNull();
    });

    it("maps container types to extensions", () => {
        expect(extensionFor("audio/mp4")).toBe("m4a");
        expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
        expect(extensionFor("audio/ogg; codecs=opus")).toBe("ogg");
        expect(extensionFor("application/octet-stream")).toBe("webm");
    });

    it("names files like the Qt recorder did", () => {
        expect(recordingName(1_700_000_000_500, "audio/mp4")).toBe("rec1700000000.m4a");
    });

    it("formats elapsed time", () => {
        expect(formatElapsed(0)).toBe("0:00");
        expect(formatElapsed(7_400)).toBe("0:07");
        expect(formatElapsed(65_000)).toBe("1:05");
    });
});
