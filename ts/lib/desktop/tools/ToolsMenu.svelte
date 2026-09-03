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
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 3px 10px;
        cursor: pointer;
    }
    .tool:hover {
        border-color: var(--button-hover-border);
    }
    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        min-width: 220px;
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow);
        padding: 4px;
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
        background: var(--highlight-bg);
        color: var(--highlight-fg);
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
        background: var(--border);
        margin: 4px 6px;
    }
</style>
