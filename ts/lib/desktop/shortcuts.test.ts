// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { matchesShortcut, parseShortcut, shortcutLabel, ShortcutMap } from "./shortcuts";

function key(key: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) {
    return {
        key,
        ctrlKey: mods.ctrl ?? false,
        metaKey: mods.meta ?? false,
        shiftKey: mods.shift ?? false,
        altKey: mods.alt ?? false,
    };
}

describe("parseShortcut", () => {
    it("reads Qt notation", () => {
        expect(parseShortcut("Ctrl+Shift+D")).toEqual({ key: "d", ctrl: true, shift: true, alt: false });
        expect(parseShortcut("Shift+v")).toEqual({ key: "v", ctrl: false, shift: true, alt: false });
        expect(parseShortcut(" ")).toEqual({ key: " ", ctrl: false, shift: false, alt: false });
        expect(parseShortcut("Return")).toEqual({ key: "Enter", ctrl: false, shift: false, alt: false });
        expect(parseShortcut("Ctrl+Alt+N")).toEqual({ key: "n", ctrl: true, shift: false, alt: true });
    });
});

describe("matchesShortcut", () => {
    it("treats command as control, like Qt on macOS", () => {
        const combo = parseShortcut("Ctrl+1");
        expect(matchesShortcut(key("1", { meta: true }), combo)).toBe(true);
        expect(matchesShortcut(key("1", { ctrl: true }), combo)).toBe(true);
        expect(matchesShortcut(key("1"), combo)).toBe(false);
    });

    it("requires shift for letters but not for punctuation", () => {
        expect(matchesShortcut(key("V", { shift: true }), parseShortcut("Shift+v"))).toBe(true);
        expect(matchesShortcut(key("v"), parseShortcut("Shift+v"))).toBe(false);
        expect(matchesShortcut(key("V", { shift: true }), parseShortcut("v"))).toBe(false);
        expect(matchesShortcut(key("!", { shift: true }), parseShortcut("!"))).toBe(true);
        expect(matchesShortcut(key("*", { shift: true }), parseShortcut("*"))).toBe(true);
    });

    it("does not fire with extra modifiers", () => {
        expect(matchesShortcut(key("e", { meta: true }), parseShortcut("e"))).toBe(false);
        expect(matchesShortcut(key("e", { alt: true }), parseShortcut("e"))).toBe(false);
    });
});

describe("ShortcutMap", () => {
    it("runs the first matching action only", () => {
        const calls: string[] = [];
        const map = new ShortcutMap()
            .add("e", () => calls.push("edit"))
            .add("Ctrl+Shift+D", () => calls.push("due"))
            .add("Enter", () => calls.push("enter"));
        expect(map.handle(key("e"))).toBe(true);
        expect(map.handle(key("D", { meta: true, shift: true }))).toBe(true);
        expect(map.handle(key("Enter"))).toBe(true);
        expect(map.handle(key("z"))).toBe(false);
        expect(calls).toEqual(["edit", "due", "enter"]);
    });
});

describe("shortcutLabel", () => {
    it("uses mac glyphs", () => {
        expect(shortcutLabel("Ctrl+Shift+D")).toBe("⌘⇧D");
        expect(shortcutLabel(" ")).toBe("Space");
        expect(shortcutLabel("Enter")).toBe("Enter");
    });
});
