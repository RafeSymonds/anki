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

export interface SavePickerOptions extends FilePickerOptions {
    /** Suggested file name, e.g. "Default.apkg". */
    defaultName?: string;
}

/** Native save-file dialog; empty string when cancelled (ANKI_TEST_FILE_SAVE in tests). */
export async function pickSavePath(options: SavePickerOptions = {}): Promise<string> {
    const response = await post(
        "saveFilePicker",
        JSON.stringify({
            title: options.title ?? "",
            filter_description: options.filterDescription ?? "",
            extensions: options.extensions ?? [],
            default_name: options.defaultName ?? "",
        }),
    );
    const result = (await response.json()) as { path: string };
    return result.path ?? "";
}

export interface ProfilePaths {
    profileDir: string;
    /** The Qt app's `pm.backupFolder()`: <profile>/backups, created on demand. */
    backupFolder: string;
}

export async function profilePaths(): Promise<ProfilePaths> {
    const response = await post("profilePaths", "");
    const result = (await response.json()) as { profile_dir: string; backup_folder: string };
    return { profileDir: result.profile_dir, backupFolder: result.backup_folder };
}

/** Open the collection again after a call that closed it (exporting a .colpkg). */
export async function reopenCollection(): Promise<void> {
    await post("reopenCollection", "");
}

/** Replace the collection with a .colpkg: close, import, reopen (ColpkgImporter._import). */
export async function importCollectionPackage(path: string): Promise<void> {
    await post("importCollectionPackage", JSON.stringify({ path }));
}
