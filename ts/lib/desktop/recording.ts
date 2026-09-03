// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Audio recording for the editor's Record Audio button. The browser engine
 * decides the container: WebKit records AAC in MP4, Chromium Opus in WebM.
 * The pure parts live here so they can be unit tested; RecorderDialog.svelte
 * drives the microphone and MediaRecorder.
 */

/** Preferred containers, best first; the first the engine supports wins. */
export const MIME_PREFERENCE = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"] as const;

export function chooseMimeType(isSupported: (type: string) => boolean): string | null {
    return MIME_PREFERENCE.find((type) => isSupported(type)) ?? null;
}

/** File extension for a recorder MIME type (parameters ignored). */
export function extensionFor(mimeType: string): string {
    const base = mimeType.split(";")[0].trim().toLowerCase();
    switch (base) {
        case "audio/mp4":
        case "audio/x-m4a":
        case "audio/aac":
            return "m4a";
        case "audio/webm":
        case "video/webm":
            return "webm";
        case "audio/ogg":
            return "ogg";
        case "audio/wav":
        case "audio/x-wav":
            return "wav";
        case "audio/mpeg":
            return "mp3";
        default:
            return "webm";
    }
}

/** `rec<seconds>.<ext>`, the shape the Qt recorder used (which was .mp3). */
export function recordingName(nowMs: number, mimeType: string): string {
    return `rec${Math.floor(nowMs / 1000)}.${extensionFor(mimeType)}`;
}

/** "0:07" style elapsed display. */
export function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
