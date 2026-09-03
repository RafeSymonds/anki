<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The Tools dropdown in the titlebar: the File and Tools menu entries of the
Qt main window, with their shortcuts.
-->
<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import { shortcutLabel } from "../shortcuts";
    import type { ToolId } from "./tools";
    import { toolSections } from "./tools";

    const dispatch = createEventDispatcher<{ action: ToolId }>();

    let open = false;
    let root: HTMLElement;
    const sections = toolSections();

    function choose(id: ToolId): void {
        open = false;
        dispatch("action", id);
    }

    function onDocumentClick(event: MouseEvent): void {
        if (open && !root.contains(event.target as Node)) {
            open = false;
        }
    }

    onMount(() => document.addEventListener("click", onDocumentClick));
    onDestroy(() => document.removeEventListener("click", onDocumentClick));
</script>

<div class="tools-menu" bind:this={root}>
    <button
        class="tool"
        aria-haspopup="menu"
        aria-expanded={open}
        on:click={() => (open = !open)}
    >
        Tools ▾
    </button>
    {#if open}
        <div class="menu" role="menu">
            {#each sections as section, i}
                {#if i > 0}
                    <div class="separator"></div>
                {/if}
                {#each section as entry (entry.id)}
                    <button role="menuitem" on:click={() => choose(entry.id)}>
                        <span>{entry.label}</span>
                        {#if entry.shortcut}
                            <span class="shortcut">
                                {shortcutLabel(entry.shortcut)}
                            </span>
                        {/if}
                    </button>
                {/each}
            {/each}
        </div>
    {/if}
</div>

<style>
    .tools-menu {
        position: relative;
    }
    .tool {
        font: inherit;
        font-size: 13px;
        color: var(--fg-subtle);
        background: transparent;
        border: 0;
        border-radius: var(--app-radius-small);
        padding: 5px 10px;
        cursor: pointer;
        white-space: nowrap;
        transition:
            background var(--transition),
            color var(--transition);
    }
    .tool:hover,
    .tool[aria-expanded="true"] {
        background: var(--app-surface-sunken);
        color: var(--fg);
    }
    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 8px);
        min-width: 230px;
        background: var(--app-surface);
        color: var(--fg);
        border: 1px solid var(--app-line);
        border-radius: var(--app-radius);
        box-shadow: var(--app-shadow-pop);
        padding: 6px;
        display: flex;
        flex-direction: column;
        z-index: 30;
    }
    .menu button {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        text-align: start;
        background: transparent;
        border: 0;
        font: inherit;
        color: inherit;
        padding: 6px 10px;
        cursor: pointer;
        border-radius: var(--border-radius);
    }
    .menu button:hover {
        background: var(--app-accent-soft);
        color: var(--fg);
    }
    .shortcut {
        color: var(--fg-subtle);
        font-size: 12px;
    }
    .menu button:hover .shortcut {
        color: inherit;
    }
    .separator {
        height: 1px;
        background: var(--app-line);
        margin: 5px 8px;
    }
</style>
