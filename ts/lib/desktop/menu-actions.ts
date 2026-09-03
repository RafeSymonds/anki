// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The native menu bar (desktop/src/menu.rs) runs `window.__ankiMenu(id)`
 * for the item the user picked. The shell registers a handler table here;
 * ids not in the table are reported rather than silently dropped.
 */

export const MENU_IDS = [
    "preferences",
    "sync",
    "switch_profile",
    "import",
    "export",
    "undo",
    "redo",
    "decks",
    "add",
    "browse",
    "stats",
    "study_deck",
    "create_filtered_deck",
    "note_types",
    "check_database",
    "check_media",
    "empty_cards",
    "create_backup",
    "guide",
    "support",
    "quit",
] as const;

export type MenuId = (typeof MENU_IDS)[number];

export type MenuHandlers = Partial<Record<MenuId, () => void | Promise<void>>>;

export function isMenuId(id: string): id is MenuId {
    return (MENU_IDS as readonly string[]).includes(id);
}

/** Run the handler for `id`; returns false when nothing handles it. */
export function dispatchMenu(id: string, handlers: MenuHandlers, onMissing?: (id: string) => void): boolean {
    if (isMenuId(id)) {
        const handler = handlers[id];
        if (handler) {
            void handler();
            return true;
        }
    }
    onMissing?.(id);
    return false;
}

interface MenuWindow {
    __ankiMenu?: (id: string) => void;
}

/** Expose the handler table to the native side. Returns an uninstaller. */
export function installMenuHandlers(handlers: MenuHandlers, onMissing?: (id: string) => void): () => void {
    const target = window as unknown as MenuWindow;
    target.__ankiMenu = (id: string) => {
        dispatchMenu(id, handlers, onMissing);
    };
    return () => {
        delete target.__ankiMenu;
    };
}
