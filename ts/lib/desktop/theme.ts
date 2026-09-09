// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The desktop shell's palette, type and elevation, as one stylesheet that is
 * injected into the shell document and into every page it embeds (the note
 * editor, deck options, statistics, the card frame). The upstream tokens in
 * ts/lib/sass/_vars.scss are redefined here, so a component that already
 * reads `var(--canvas)` or `var(--fg-subtle)` picks up the new look without
 * being touched, inside an iframe as well as out.
 *
 * Dark mode follows the shell: it sets `night-mode` on the root element, and
 * passes `#night` to embedded pages, which do the same.
 */

export const THEME_STYLE_ID = "anki-desktop-theme";

/** Font stacks. `ui-rounded` is SF Pro Rounded on macOS, the app's target. */
const FONTS = `
    --app-font-display: ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont,
        "Segoe UI", system-ui, sans-serif;
    --app-font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue",
        Arial, sans-serif;
    --app-font-mono: ui-monospace, "SF Mono", Menlo, monospace;
`;

/** Sizes and spacing shared by every shell surface. */
const METRICS = `
    --font-size: 14px;
    --border-radius: 8px;
    --border-radius-medium: 14px;
    --border-radius-large: 22px;
    --app-radius-small: 6px;
    --app-radius: 10px;
    --app-radius-large: 16px;
    --app-gap: 12px;
    --app-pane-pad: 28px;
    --transition: 160ms;
`;

const LIGHT = `
    --fg: #171a20;
    --fg-subtle: #616b7c;
    --fg-disabled: #b3bac6;
    --fg-faint: #a7aebc;
    --fg-link: #3b46cf;

    --canvas: #f1f3f8;
    --canvas-elevated: #ffffff;
    --canvas-inset: #ffffff;
    --canvas-overlay: #ffffff;
    --canvas-code: #f4f6fa;
    --canvas-glass: rgba(255, 255, 255, 0.72);

    --border: #e2e6ef;
    --border-subtle: #edf0f6;
    --border-strong: #c6cddb;
    --border-focus: #4c56e0;

    --button-bg: #ffffff;
    --button-gradient-start: #ffffff;
    --button-gradient-end: #ffffff;
    --button-hover-border: #b9c1d2;
    --button-disabled: #eef1f6;
    --button-primary-bg: #4c56e0;
    --button-primary-gradient-start: #4c56e0;
    --button-primary-gradient-end: #4048d2;
    --button-primary-disabled: #b7bcf0;

    --shadow: 0 1px 2px rgba(18, 22, 33, 0.06), 0 10px 28px rgba(18, 22, 33, 0.1);
    --shadow-subtle: 0 1px 2px rgba(18, 22, 33, 0.06);
    --shadow-inset: inset 0 1px 2px rgba(18, 22, 33, 0.08);
    --shadow-focus: 0 0 0 3px rgba(76, 86, 224, 0.28);

    --accent-card: #3b46cf;
    --accent-note: #d98324;
    --accent-danger: #d64545;

    --state-new: #2f6fe0;
    --state-learn: #dd6135;
    --state-review: #10996a;
    --state-buried: #b48a2f;
    --state-suspended: #e9c46a;
    --state-marked: #8b5cf6;

    --highlight-bg: #eceef9;
    --highlight-fg: #171a20;
    --selected-bg: #4c56e0;
    --selected-fg: #ffffff;

    --app-ground: #f1f3f8;
    --app-sidebar: #e9ecf4;
    --app-surface: #ffffff;
    --app-surface-sunken: #f4f6fa;
    --app-accent: #4c56e0;
    --app-accent-hover: #3f49cf;
    --app-accent-soft: #eceef9;
    --app-accent-fg: #ffffff;
    --app-line: #e2e6ef;
    --app-new-soft: #e7effc;
    --app-learn-soft: #fceee7;
    --app-review-soft: #e3f5ed;
    --app-shadow-card: 0 1px 2px rgba(18, 22, 33, 0.05), 0 6px 18px rgba(18, 22, 33, 0.07);
    --app-shadow-pop: 0 8px 30px rgba(18, 22, 33, 0.16);
    /* Shading for an edge that cuts content off, as a gradient's solid end. */
    --app-shadow-edge: rgba(18, 22, 33, 0.13);

    /* Bootstrap paints the body and its buttons from its own variables on
       the pages the shell embeds. */
    --bs-body-bg: #f1f3f8;
    --bs-body-color: #171a20;
    --bs-border-color: #e2e6ef;
    --bs-primary: #4c56e0;
    --bs-link-color: #3b46cf;
    --bs-link-hover-color: #2f3ab8;
`;

const DARK = `
    --fg: #e8ebf2;
    --fg-subtle: #98a1b2;
    --fg-disabled: #5a6272;
    --fg-faint: #6b7385;
    --fg-link: #9aa2ff;

    --canvas: #15171c;
    --canvas-elevated: #1d2027;
    --canvas-inset: #22262e;
    --canvas-overlay: #24282f;
    --canvas-code: #1a1d23;
    --canvas-glass: rgba(29, 32, 39, 0.72);

    --border: #2c313b;
    --border-subtle: #23272f;
    --border-strong: #3d4351;
    --border-focus: #8f97ff;

    --button-bg: #262a33;
    --button-gradient-start: #262a33;
    --button-gradient-end: #262a33;
    --button-hover-border: #4a5162;
    --button-disabled: #22262e;
    --button-primary-bg: #6169ec;
    --button-primary-gradient-start: #6169ec;
    --button-primary-gradient-end: #545ce0;
    --button-primary-disabled: #3b3f6b;

    --shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.45);
    --shadow-subtle: 0 1px 2px rgba(0, 0, 0, 0.45);
    --shadow-inset: inset 0 1px 2px rgba(0, 0, 0, 0.4);
    --shadow-focus: 0 0 0 3px rgba(143, 151, 255, 0.35);

    --accent-card: #9aa2ff;
    --accent-note: #e0a94f;
    --accent-danger: #ef6a6a;

    --state-new: #6ea4ff;
    --state-learn: #ff9160;
    --state-review: #45c98b;
    --state-buried: #d0aa5a;
    --state-suspended: #e9c46a;
    --state-marked: #a78bfa;

    --highlight-bg: #2b3040;
    --highlight-fg: #e8ebf2;
    --selected-bg: #4a52d8;
    --selected-fg: #ffffff;

    --app-ground: #15171c;
    --app-sidebar: #101216;
    --app-surface: #1d2027;
    --app-surface-sunken: #191c22;
    --app-accent: #8f97ff;
    --app-accent-hover: #a3aaff;
    --app-accent-soft: #262a44;
    --app-accent-fg: #14161c;
    --app-line: #2c313b;
    --app-new-soft: #1d2a3d;
    --app-learn-soft: #33241c;
    --app-review-soft: #16302a;
    --app-shadow-card: 0 1px 2px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.35);
    --app-shadow-pop: 0 10px 34px rgba(0, 0, 0, 0.55);
    --app-shadow-edge: rgba(0, 0, 0, 0.42);

    --bs-body-bg: #15171c;
    --bs-body-color: #e8ebf2;
    --bs-border-color: #2c313b;
    --bs-primary: #8f97ff;
    --bs-link-color: #9aa2ff;
    --bs-link-hover-color: #b3b9ff;
`;

/**
 * Shared rules. `:root:root` is deliberate: the same tokens are defined by
 * ts/lib/sass/_root-vars.scss at plain `:root`, and this sheet is inserted
 * before a page's own styles, so it needs the extra specificity to win.
 *
 * Dark values are also emitted for `prefers-color-scheme` so a page that
 * renders before the shell has tagged it does not flash white.
 */
export const THEME_CSS = `
:root:root {
${FONTS}${METRICS}${LIGHT}
    color-scheme: light;
}
:root:root.night-mode,
:root:root.night_mode,
:root:root body.night-mode,
:root:root body.nightMode {
${DARK}
    color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
    :root:root:not(.day-mode) {
${DARK}
        color-scheme: dark;
    }
}
html, body {
    font-family: var(--app-font-ui);
    -webkit-font-smoothing: antialiased;
}
/* Bootstrap's primary button appears on the pages the shell embeds. */
.btn.btn-primary {
    background-color: var(--app-accent);
    border-color: var(--app-accent);
    color: var(--app-accent-fg);
}
.btn.btn-primary:hover,
.btn.btn-primary:focus {
    background-color: var(--app-accent-hover);
    border-color: var(--app-accent-hover);
    color: var(--app-accent-fg);
}
`;

/**
 * Add the stylesheet to a document, or update it if it is already there.
 * It is inserted first so page styles that follow can still override it.
 */
export function applyDesktopTheme(doc: Document | null | undefined): void {
    if (!doc?.head) {
        return;
    }
    let style = doc.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = doc.createElement("style");
        style.id = THEME_STYLE_ID;
        doc.head.insertBefore(style, doc.head.firstChild);
    }
    if (style.textContent !== THEME_CSS) {
        style.textContent = THEME_CSS;
    }
}

/** Inject into a frame's document, ignoring one that is not loaded yet. */
export function applyDesktopThemeToFrame(frame: HTMLIFrameElement | null | undefined): void {
    try {
        applyDesktopTheme(frame?.contentDocument ?? undefined);
    } catch {
        // A cross-origin document cannot be themed; nothing else to do.
    }
}
