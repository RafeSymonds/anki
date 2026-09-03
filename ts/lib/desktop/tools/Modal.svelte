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
        background: rgba(0, 0, 0, 0.35);
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
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius-large, 10px);
        box-shadow: var(--shadow);
        outline: none;
    }
    .head {
        padding: 12px 16px;
        font-weight: 600;
        border-bottom: 1px solid var(--border);
    }
    .body {
        padding: 16px;
        overflow: auto;
        min-height: 0;
    }
    .foot {
        padding: 10px 16px;
        border-top: 1px solid var(--border);
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
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 5px 12px;
        cursor: pointer;
    }
    .box :global(button:hover) {
        border-color: var(--button-hover-border);
    }
    .box :global(button.primary) {
        background: var(--button-primary-bg);
        color: white;
        border-color: transparent;
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
        background: var(--canvas);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 4px 6px;
    }
    .box :global(label) {
        display: flex;
        align-items: center;
        gap: 6px;
    }
</style>
