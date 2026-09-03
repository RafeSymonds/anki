<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

A modal dialog box over the shell, the stand-in for the QDialogs of the
Qt app. Escape closes it; the footer slot holds the buttons.
-->
<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";

    export let title: string;
    export let width = "480px";

    const dispatch = createEventDispatcher<{ close: void }>();

    let box: HTMLDivElement;

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dispatch("close");
        }
    }

    onMount(() => {
        const first = box.querySelector<HTMLElement>(
            "[autofocus], input, select, button",
        );
        (first ?? box).focus();
    });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" on:keydown={onKeydown}>
    <div
        class="box"
        style="width: {width}"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabindex="-1"
        bind:this={box}
    >
        <div class="head">{title}</div>
        <div class="body">
            <slot />
        </div>
        <div class="foot">
            <slot name="footer" />
        </div>
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
    .box {
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        display: flex;
        flex-direction: column;
        background: var(--app-surface);
        color: var(--fg);
        border-radius: var(--app-radius-large);
        box-shadow: var(--app-shadow-pop);
        outline: none;
    }
    .head {
        padding: 16px 20px 12px;
        font-family: var(--app-font-display);
        font-size: 15px;
        font-weight: 600;
    }
    .body {
        padding: 0 20px 4px;
        overflow: auto;
        min-height: 0;
    }
    .foot {
        padding: 16px 20px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
    }
    .foot:empty {
        display: none;
    }
    .box :global(button) {
        font: inherit;
        color: var(--fg);
        background: var(--app-surface-sunken);
        border: 1px solid var(--app-line);
        border-radius: var(--app-radius);
        padding: 7px 14px;
        cursor: pointer;
    }
    .box :global(button:hover) {
        border-color: var(--button-hover-border);
    }
    .box :global(button.primary) {
        background: var(--app-accent);
        color: var(--app-accent-fg);
        border-color: transparent;
        font-weight: 600;
    }
    .box :global(button.primary:hover) {
        background: var(--app-accent-hover);
    }
    .box :global(button:disabled) {
        opacity: 0.5;
        cursor: default;
    }
    .box :global(input[type="text"]),
    .box :global(input[type="number"]),
    .box :global(select) {
        font: inherit;
        color: var(--fg);
        background: var(--app-surface-sunken);
        border: 1px solid var(--app-line);
        border-radius: var(--app-radius-small);
        padding: 6px 8px;
    }
    .box :global(input:focus-visible),
    .box :global(select:focus-visible),
    .box :global(button:focus-visible) {
        outline: 2px solid var(--app-accent);
        outline-offset: 1px;
    }
    .box :global(label) {
        display: flex;
        align-items: center;
        gap: 6px;
    }
</style>
