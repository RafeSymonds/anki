// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Calls into the host's native side (desktop/src/desktop_api.rs). */

export type SettingsScope = "profile" | "meta";

async function post(command: string, body: string | Uint8Array): Promise<Response> {
    const response = await fetch(`/_desktop/${command}`, { method: "POST", body });
    if (!response.ok) {
        throw new Error(`${command}: ${response.status} ${await response.text()}`);
    }
    return response;
}

export async function openLink(url: string): Promise<void> {
    await post("openLink", url);
}

export async function openMedia(filename: string): Promise<void> {
    await post("openMedia", filename);
}

export async function showInMediaFolder(filename: string): Promise<void> {
    await post("showInMediaFolder", filename);
}

export async function settingsGet(scope: SettingsScope, key: string): Promise<unknown> {
    const response = await post("settingsGet", JSON.stringify({ scope, key }));
    return await response.json();
}

export async function settingsSet(scope: SettingsScope, key: string, value: unknown): Promise<void> {
    await post("settingsSet", JSON.stringify({ scope, key, value: value ?? null }));
}

/** Close the open collection (desktop/src/sync.rs); harmless if closed. */
export async function closeCollection(): Promise<void> {
    await post("closeCollection", "");
}

/** Make sure the profile's collection is open again, e.g. after a full sync. */
export async function reopenCollection(): Promise<void> {
    await post("reopenCollection", "");
}

export interface FilePickerOptions {
    title?: string;
    filterDescription?: string;
    extensions?: string[];
}

/** Native open-file dialog; empty string when cancelled. */
export async function pickFile(options: FilePickerOptions = {}): Promise<string> {
    const response = await post(
        "openFilePicker",
        JSON.stringify({
            title: options.title ?? "",
            filter_description: options.filterDescription ?? "",
            extensions: options.extensions ?? [],
        }),
    );
    const result = (await response.json()) as { path: string };
    return result.path ?? "";
}
