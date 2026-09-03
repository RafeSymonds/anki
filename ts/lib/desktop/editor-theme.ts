// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Polish for the note editor page inside its frame. The editor is the
 * upstream Svelte app (ts/routes/editor); rather than fork it, the shell
 * appends this stylesheet to its document, which softens the toolbar, the
 * note type and deck choosers and the fields to match the rest of the app.
 *
 * Colour, spacing, rounding, and the width of the two chooser buttons: no
 * element is added, removed or reordered, so the editor's own behaviour and
 * the tests against it are unaffected.
 */

export const EDITOR_STYLE_ID = "anki-desktop-editor-theme";

export const EDITOR_CSS = `
.note-editor {
    background: var(--app-surface);
}
/* "Type ... Deck ..." above the fields: labels recede, and the choosers are
   as wide as their names rather than half the window each. */
.note-editor .top-bar {
    gap: 8px;
    padding: 12px 14px 8px;
    background: transparent;
    border: 0;
    justify-content: flex-start;
}
.note-editor .top-bar .notetype-chooser,
.note-editor .top-bar .deck-chooser {
    flex: 0 1 auto;
    max-width: 40%;
}
.note-editor .top-bar .deck-chooser {
    margin-inline-start: 12px;
}
.note-editor .top-bar p {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--fg-subtle);
    margin: 0;
}
.note-editor .top-bar button.chooser-button {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-line);
    border-radius: var(--app-radius);
    padding: 5px 12px;
    font-weight: 600;
    width: auto;
}
.note-editor .top-bar button.chooser-button:hover {
    border-color: var(--app-accent);
    color: var(--app-accent);
}
.note-editor .editor-toolbar {
    background: transparent;
    border: 0;
    padding: 2px 12px 10px;
}
.note-editor .editor-toolbar button.label-button,
.note-editor .editor-toolbar button.icon-button {
    border-radius: var(--app-radius-small);
}
/* Each field is a card of its own, and the one being typed in is lifted. */
.note-editor .field-container .editing-area {
    border: 1px solid var(--app-line);
    border-radius: var(--app-radius);
    background: var(--canvas-inset);
    overflow: hidden;
    transition: border-color var(--transition), box-shadow var(--transition);
}
.note-editor .field-container .editing-area:focus-within {
    border-color: var(--app-accent);
    box-shadow: var(--shadow-focus);
}
.note-editor .field-container .label-container {
    background: transparent;
    padding-inline: 2px;
}
.note-editor .field-container .label-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-subtle);
}
.note-editor .tag-editor {
    background: transparent;
}
/* Along the foot the buttons are quiet; Add, which sits last in the markup,
   is the one that carries the accent. */
.note-editor .action-buttons button.label-button {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-line);
    color: var(--fg);
    border-radius: var(--app-radius);
    padding: 6px 16px;
}
.note-editor .action-buttons button.label-button:hover {
    border-color: var(--app-accent);
    color: var(--app-accent);
}
.note-editor .action-buttons .action-button:last-child button.label-button {
    background: var(--app-accent);
    border-color: transparent;
    color: var(--app-accent-fg);
    font-weight: 600;
}
.note-editor .action-buttons .action-button:last-child button.label-button:hover {
    background: var(--app-accent-hover);
    color: var(--app-accent-fg);
}
`;

/**
 * Append the stylesheet to an editor document, or update it in place. It
 * goes last so it wins ties with the page's own scoped rules.
 */
export function applyEditorStyles(doc: Document | null | undefined): void {
    if (!doc?.head) {
        return;
    }
    let style = doc.getElementById(EDITOR_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = doc.createElement("style");
        style.id = EDITOR_STYLE_ID;
        doc.head.appendChild(style);
    } else if (style !== doc.head.lastElementChild) {
        doc.head.appendChild(style);
    }
    if (style.textContent !== EDITOR_CSS) {
        style.textContent = EDITOR_CSS;
    }
}

export function applyEditorStylesToFrame(frame: HTMLIFrameElement | null | undefined): void {
    try {
        applyEditorStyles(frame?.contentDocument ?? undefined);
    } catch {
        // Not our document to style.
    }
}
