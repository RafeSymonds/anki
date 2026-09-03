// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The entries of the Qt main window's File and Tools menus that the shell
 * offers from its Tools dropdown, with the shortcuts they had in main.ui and
 * main.py (setupMenus).
 */

import * as tr from "@generated/ftl";

export type ToolId =
    | "stats"
    | "import"
    | "export"
    | "createBackup"
    | "studyDeck"
    | "filteredDeck"
    | "customStudy"
    | "checkDatabase"
    | "checkMedia"
    | "emptyCards"
    | "noteTypes"
    | "switchProfile"
    | "preferences";

export interface ToolEntry {
    id: ToolId;
    label: string;
    /** Qt notation, see shortcuts.ts. */
    shortcut?: string;
}

/** Qt shortcut -> tool, in the order the ShortcutMap should try them. */
export const TOOL_SHORTCUTS: [string, ToolId][] = [
    ["t", "stats"],
    ["Ctrl+Shift+i", "import"],
    ["Ctrl+e", "export"],
    ["Ctrl+p", "preferences"],
    ["c", "customStudy"],
    ["f", "filteredDeck"],
    ["/", "studyDeck"],
    ["Ctrl+Shift+n", "noteTypes"],
    ["Ctrl+Shift+p", "switchProfile"],
];

export function shortcutFor(id: ToolId): string | undefined {
    return TOOL_SHORTCUTS.find(([, tool]) => tool === id)?.[0];
}

/** Menu sections: File entries, deck tools, maintenance, then the two screens. */
export function toolSections(): ToolEntry[][] {
    const entry = (id: ToolId, label: string): ToolEntry => ({ id, label, shortcut: shortcutFor(id) });
    return [
        [
            entry("switchProfile", "Switch Profile…"),
            entry("import", `${tr.actionsImport()}…`),
            entry("export", `${tr.actionsExport()}…`),
            entry("createBackup", "Create Backup"),
        ],
        [
            entry("studyDeck", `${tr.decksStudyDeck()}…`),
            entry("filteredDeck", "Create Filtered Deck…"),
            entry("customStudy", `${tr.actionsCustomStudy()}…`),
        ],
        [
            entry("checkDatabase", "Check Database"),
            entry("checkMedia", tr.mediaCheckCheckMediaAction()),
            entry("emptyCards", `${tr.actionsEmptyCards()}…`),
        ],
        [
            entry("noteTypes", tr.browsingManageNoteTypes()),
            entry("stats", tr.statisticsTitle()),
            entry("preferences", tr.preferencesPreferences()),
        ],
    ];
}
