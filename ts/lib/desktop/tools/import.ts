// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Which importer handles a file, ported from IMPORTERS / import_file in
 * qt/aqt/import_export/importing.py. CSV, package and JSON imports are the
 * existing SvelteKit pages; a collection package replaces the collection and
 * goes through the native side instead.
 */

/** File endings offered by the open dialog (all_accepted_file_endings). */
export const IMPORT_EXTENSIONS = ["apkg", "colpkg", "zip", "csv", "tsv", "txt", "anki-json"];

export type ImportTarget =
    | { kind: "page"; route: string }
    | { kind: "collection" }
    | { kind: "unsupported" };

function baseName(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] ?? "";
}

/** ColpkgImporter.can_import: only full collection backups replace the collection. */
export function isCollectionPackage(filename: string): boolean {
    const name = filename.toLowerCase();
    return name === "collection.apkg"
        || (name.startsWith("backup-") && name.endsWith(".apkg"))
        || name.endsWith(".colpkg");
}

/** Python's urllib.parse.quote: escape every path segment, keep the slashes. */
export function quotePath(path: string): string {
    return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function importTargetFor(path: string): ImportTarget {
    const name = baseName(path).toLowerCase();
    if (isCollectionPackage(name)) {
        return { kind: "collection" };
    }
    if (name.endsWith(".apkg") || name.endsWith(".zip")) {
        return { kind: "page", route: `/import-anki-package/${quotePath(path)}` };
    }
    if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
        return { kind: "page", route: `/import-csv/${quotePath(path)}` };
    }
    if (name.endsWith(".anki-json")) {
        return { kind: "page", route: `/import-page/${quotePath(path)}` };
    }
    return { kind: "unsupported" };
}
