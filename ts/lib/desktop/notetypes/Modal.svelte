<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

A dialog box over the shell. Escape asks to close it, and every key event
stops at the dialog so the shell's single-key shortcuts do not fire behind it.
-->
<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";

    export let title: string;
    export let width = "560px";
    export let height = "auto";
    /** Handles the dialog's own shortcuts; true when the key was used. */
    export let onKey: (event: KeyboardEvent) => boolean = () => false;

    const dispatch = createEventDispatcher<{ close: void }>();

    let dialog: HTMLDivElement;

    function onKeydown(event: KeyboardEvent): void {
        if (onKey(event)) {
            event.preventDefault();
        } else if (event.key === "Escape") {
            event.preventDefault();
            dispatch("close");
        }
        event.stopPropagation();
    }

    onMount(() => dialog.focus());
</script>

<div class="backdrop">
    <div
        class="dialog"
        role="dialog"
        aria-label={title}
        tabindex="-1"
        bind:this={dialog}
        style="width: {width}; height: {height}"
        on:keydown={onKeydown}
    >
        <div class="head">{title}</div>
        <div class="body"><slot /></div>
        <div class="foot"><slot name="buttons" /></div>
    </div>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(12, 15, 22, 0.32);
        backdrop-filter: blur(3px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 40;
    }
    .dialog {
        display: flex;
        flex-direction: column;
        max-width: 96vw;
        max-height: 92vh;
        background: var(--app-surface);
        color: var(--fg);
        border-radius: var(--app-radius-large);
        box-shadow: var(--app-shadow-pop);
        outline: none;
    }
    .head {
        flex: none;
        padding: 14px 18px 12px;
        font-family: var(--app-font-display);
        font-size: 15px;
        font-weight: 600;
        border-bottom: 1px solid var(--app-line);
    }
    .body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        padding: 12px 16px;
        overflow: auto;
    }
    .foot {
        flex: none;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 10px 16px;
        border-top: 1px solid var(--border);
    }
    .foot {
        border-top-color: var(--app-line);
    }
    .foot :global(button) {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--app-line);
        border-radius: var(--app-radius);
        padding: 6px 14px;
        cursor: pointer;
    }
    .foot :global(button:hover) {
        border-color: var(--button-hover-border);
    }
    .foot :global(button.primary) {
        background: var(--app-accent);
        color: var(--app-accent-fg);
        font-weight: 600;
    }
</style>
