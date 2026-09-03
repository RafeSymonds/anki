// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Keyboard shortcuts in the Qt notation used throughout aqt ("Ctrl+Shift+D",
 * "Shift+v", " ", "Enter"). "Ctrl" is the command key on macOS, as in Qt.
 */

export interface KeyCombo {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
}

export interface KeyLike {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
}

export function parseShortcut(spec: string): KeyCombo {
    if (spec === " ") {
        return { key: " ", ctrl: false, shift: false, alt: false };
    }
    const parts = spec.split("+");
    const key = parts.pop() ?? "";
    const modifiers = parts.map((p) => p.toLowerCase());
    return {
        key: normaliseKey(key),
        ctrl: modifiers.includes("ctrl") || modifiers.includes("cmd") || modifiers.includes("meta"),
        shift: modifiers.includes("shift"),
        alt: modifiers.includes("alt") || modifiers.includes("option"),
    };
}

function normaliseKey(key: string): string {
    switch (key) {
        case "Return":
            return "Enter";
        case "Esc":
            return "Escape";
        case "Space":
            return " ";
        default:
            return key.length === 1 ? key.toLowerCase() : key;
    }
}

function isLetter(key: string): boolean {
    return key.length === 1 && /[a-z]/i.test(key);
}

export function matchesShortcut(event: KeyLike, combo: KeyCombo): boolean {
    const key = normaliseKey(event.key);
    if (key !== combo.key) {
        return false;
    }
    if ((event.ctrlKey || event.metaKey) !== combo.ctrl) {
        return false;
    }
    if (event.altKey !== combo.alt) {
        return false;
    }
    // Punctuation like "!" already implies shift; only letters need it to match.
    if (isLetter(combo.key) || combo.shift) {
        return event.shiftKey === combo.shift;
    }
    return true;
}

/** Keys typed into a field must not trigger shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Element)) {
        return false;
    }
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return true;
    }
    return (target as HTMLElement).isContentEditable === true;
}

export type ShortcutAction = () => void;

export class ShortcutMap {
    private entries: { combo: KeyCombo; spec: string; action: ShortcutAction }[] = [];

    add(spec: string, action: ShortcutAction): this {
        this.entries.push({ combo: parseShortcut(spec), spec, action });
        return this;
    }

    addAll(entries: [string, ShortcutAction][]): this {
        for (const [spec, action] of entries) {
            this.add(spec, action);
        }
        return this;
    }

    /** Run the first matching action; true if one ran. */
    handle(event: KeyLike): boolean {
        for (const entry of this.entries) {
            if (matchesShortcut(event, entry.combo)) {
                entry.action();
                return true;
            }
        }
        return false;
    }

    specs(): string[] {
        return this.entries.map((e) => e.spec);
    }
}

/** "Ctrl+Shift+D" -> "⌘⇧D" for tooltips. */
export function shortcutLabel(spec: string): string {
    if (spec === " ") {
        return "Space";
    }
    const combo = parseShortcut(spec);
    let label = "";
    if (combo.ctrl) {
        label += "⌘";
    }
    if (combo.alt) {
        label += "⌥";
    }
    if (combo.shift) {
        label += "⇧";
    }
    return label + (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
}
