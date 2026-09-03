// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The FrontendService methods every embedded page may call, answered by the
 * shell: user prompts, links, clipboard, file picking, the settings store.
 * Screen-specific methods (closing an editor, scheduling states) are
 * registered by the components that own them.
 */

import { AVTag } from "@generated/anki/card_rendering_pb";
import {
    AskUserRequest,
    ConvertPastedImageRequest,
    ConvertPastedImageResponse,
    openFilePickerRequest,
    ReadClipboardRequest,
    ReadClipboardResponse,
    SetSettingJsonRequest,
    ShowMessageBoxRequest,
    WriteClipboardRequest,
} from "@generated/anki/frontend_pb";
import { Bool, Empty, Json, String as PbString } from "@generated/anki/generic_pb";
import { SearchNode } from "@generated/anki/search_pb";
import { avPlayer } from "./audio";
import { openLink, openMedia, pickFile, settingsGet, settingsSet, showInMediaFolder } from "./desktop-api";
import { registerFrontendHandler, typedHandler } from "./frontend-service";

export interface ShellHooks {
    /** Show a short notice to the user. */
    notify(message: string): void;
    /** Yes/no question; resolves to the answer. */
    askUser(text: string, title?: string): Promise<boolean>;
    /** Informational message the user dismisses. */
    showMessage(text: string, title?: string): Promise<void>;
    /** Open the browser with a search; may be unavailable. */
    searchInBrowser?(search: SearchNode): void;
    /** The editor in `frame` asked for the Fields dialog of its note type. */
    openFieldsDialog?(frame: Window): void;
    /** The editor in `frame` asked for the card templates of its note. */
    openCardsDialog?(frame: Window): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function jsonBytes(value: unknown): Json {
    return new Json({ json: encoder.encode(JSON.stringify(value ?? null)) });
}

function parseJsonBytes(bytes: Uint8Array): unknown {
    const text = decoder.decode(bytes);
    return text ? JSON.parse(text) : null;
}

async function readClipboard(types: string[]): Promise<Map<string, Uint8Array>> {
    const data = new Map<string, Uint8Array>();
    if (!navigator.clipboard?.read) {
        return data;
    }
    try {
        for (const item of await navigator.clipboard.read()) {
            for (const type of item.types) {
                if (types.length && !types.includes(type)) {
                    continue;
                }
                const blob = await item.getType(type);
                data.set(type, new Uint8Array(await blob.arrayBuffer()));
            }
        }
    } catch {
        // Clipboard access needs a user gesture; nothing to read otherwise.
    }
    return data;
}

async function writeClipboard(data: Map<string, Uint8Array>): Promise<void> {
    if (!navigator.clipboard?.write || data.size === 0) {
        return;
    }
    const parts: Record<string, Blob> = {};
    for (const [type, bytes] of data) {
        parts[type] = new Blob([bytes], { type });
    }
    try {
        await navigator.clipboard.write([new ClipboardItem(parts)]);
    } catch (err) {
        console.warn("clipboard write failed", err);
    }
}

/** Register the shell-wide handlers. Returns a function that removes them. */
export function installShellServices(hooks: ShellHooks): () => void {
    const unregister = [
        registerFrontendHandler(
            "openLink",
            typedHandler(PbString, async (input) => {
                await openLink(input.val);
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "askUser",
            typedHandler(
                AskUserRequest,
                async (input) => new Bool({ val: await hooks.askUser(input.text, input.title) }),
            ),
        ),
        registerFrontendHandler(
            "showMessageBox",
            typedHandler(ShowMessageBoxRequest, async (input) => {
                await hooks.showMessage(input.text, input.title);
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "getProfileConfigJson",
            typedHandler(PbString, async (input) => jsonBytes(await settingsGet("profile", input.val))),
        ),
        registerFrontendHandler(
            "setProfileConfigJson",
            typedHandler(SetSettingJsonRequest, async (input) => {
                await settingsSet("profile", input.key, parseJsonBytes(input.valueJson));
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "getMetaJson",
            typedHandler(PbString, async (input) => jsonBytes(await settingsGet("meta", input.val))),
        ),
        registerFrontendHandler(
            "setMetaJson",
            typedHandler(SetSettingJsonRequest, async (input) => {
                await settingsSet("meta", input.key, parseJsonBytes(input.valueJson));
                return new Empty();
            }),
        ),
        registerFrontendHandler("saveCustomColours", typedHandler(Empty, () => new Empty())),
        registerFrontendHandler(
            "playFile",
            typedHandler(PbString, (input) => {
                avPlayer.playTags([new AVTag({ value: { case: "soundOrVideo", value: input.val } })]);
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "openMedia",
            typedHandler(PbString, async (input) => {
                await openMedia(input.val);
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "showInMediaFolder",
            typedHandler(PbString, async (input) => {
                await showInMediaFolder(input.val);
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "openFilePicker",
            typedHandler(openFilePickerRequest, async (input) =>
                new PbString({
                    val: await pickFile({
                        title: input.title,
                        filterDescription: input.filterDescription,
                        extensions: input.extensions,
                    }),
                })),
        ),
        registerFrontendHandler(
            "readClipboard",
            typedHandler(ReadClipboardRequest, async (input) => {
                const data: Record<string, Uint8Array> = {};
                for (const [type, bytes] of await readClipboard(input.types)) {
                    data[type] = bytes;
                }
                return new ReadClipboardResponse({ data });
            }),
        ),
        registerFrontendHandler(
            "writeClipboard",
            typedHandler(WriteClipboardRequest, async (input) => {
                await writeClipboard(new Map(Object.entries(input.data)));
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "convertPastedImage",
            typedHandler(ConvertPastedImageRequest, (input) => new ConvertPastedImageResponse({ data: input.data })),
        ),
        registerFrontendHandler(
            "searchInBrowser",
            typedHandler(SearchNode, (input) => {
                if (hooks.searchInBrowser) {
                    hooks.searchInBrowser(input);
                } else {
                    hooks.notify("The browser is not available yet");
                }
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "openFieldsDialog",
            typedHandler(Empty, (_input, frame) => {
                if (hooks.openFieldsDialog) {
                    hooks.openFieldsDialog(frame);
                } else {
                    hooks.notify("Fields are not editable here yet");
                }
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "openCardsDialog",
            typedHandler(Empty, (_input, frame) => {
                if (hooks.openCardsDialog) {
                    hooks.openCardsDialog(frame);
                } else {
                    hooks.notify("Card templates are not editable here yet");
                }
                return new Empty();
            }),
        ),
        registerFrontendHandler(
            "recordAudio",
            typedHandler(Empty, () => {
                hooks.notify("Recording is not available yet");
                return new PbString({ val: "" });
            }),
        ),
    ];
    return () => {
        for (const fn of unregister) {
            fn();
        }
    };
}
