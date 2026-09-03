// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Getting a deck somebody else made. AnkiWeb hosts them, the browser
 * downloads an .apkg, and the app imports it. The Qt app left every step of
 * that to the user; the Get Shared Decks screen walks through it and lists
 * the deck files already sitting in Downloads.
 */

export const SHARED_DECKS_URL = "https://ankiweb.net/shared/decks";

/** The shared deck list, filtered to a subject. */
export function categoryUrl(search: string): string {
    return `${SHARED_DECKS_URL}?search=${encodeURIComponent(search)}`;
}

export interface DeckCategory {
    label: string;
    /** What someone would find under it. */
    hint: string;
    /** The term the AnkiWeb list is searched for. */
    search: string;
}

/** Subjects with the most shared decks, in the order the screen shows them. */
export const SHARED_CATEGORIES: DeckCategory[] = [
    { label: "Japanese", hint: "Kanji, vocabulary, grammar", search: "japanese" },
    { label: "Spanish", hint: "Vocabulary and verb forms", search: "spanish" },
    { label: "French", hint: "Vocabulary and verb forms", search: "french" },
    { label: "German", hint: "Vocabulary and der/die/das", search: "german" },
    { label: "Medicine", hint: "Anatomy, pharmacology, USMLE", search: "medicine" },
    { label: "Biology", hint: "Cells, genetics, physiology", search: "biology" },
    { label: "Geography", hint: "Countries, capitals, flags", search: "geography" },
    { label: "Exam prep", hint: "SAT, GRE, MCAT word lists", search: "exam" },
];

/** One deck file found in Downloads, as the host reports it. */
export interface DownloadedDeck {
    name: string;
    path: string;
    /** Bytes. */
    size: number;
    /** Seconds since the epoch. */
    modified: number;
}

/** The file name without its extension, underscores read as spaces. */
export function displayName(fileName: string): string {
    const withoutExtension = fileName.replace(/\.(apkg|colpkg)$/i, "");
    return withoutExtension.replace(/[_+]+/g, " ").trim() || fileName;
}

/** A size a person can judge: "820 KB", "14.2 MB". */
export function formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return "";
    }
    if (bytes < 1024) {
        return `${Math.round(bytes)} bytes`;
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
        return `${Math.round(kb)} KB`;
    }
    const mb = kb / 1024;
    if (mb < 100) {
        return `${mb.toFixed(1)} MB`;
    }
    return `${Math.round(mb)} MB`;
}

/** How long ago the file was downloaded, in the words a person would use. */
export function relativeTime(modifiedSecs: number, nowMs: number): string {
    const seconds = Math.round(nowMs / 1000 - modifiedSecs);
    if (!Number.isFinite(seconds) || seconds < 60) {
        return "just now";
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    }
    const days = Math.floor(hours / 24);
    if (days < 30) {
        return `${days} day${days === 1 ? "" : "s"} ago`;
    }
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** A collection package replaces everything; it is imported a different way. */
export function isCollectionFile(fileName: string): boolean {
    return /\.colpkg$/i.test(fileName);
}

/** What to say under a file: how big it is and when it arrived. */
export function fileSubtitle(file: DownloadedDeck, nowMs: number): string {
    const parts = [formatSize(file.size), `downloaded ${relativeTime(file.modified, nowMs)}`];
    if (isCollectionFile(file.name)) {
        parts.push("replaces your whole collection");
    }
    return parts.filter(Boolean).join(" · ");
}
