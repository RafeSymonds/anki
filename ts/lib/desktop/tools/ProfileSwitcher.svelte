<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Switch between profiles (each its own collection, settings and media), or
create a new one. The page reloads on the new profile, like the Qt app
closing and reopening its main window.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    import { listProfiles, switchProfile } from "../desktop-api";

    const dispatch = createEventDispatcher<{ close: void; notify: string }>();

    let profiles: string[] = [];
    let current = "";
    let selected = "";
    let busy = false;
    let error = "";

    onMount(async () => {
        const list = await listProfiles();
        profiles = list.profiles;
        current = list.current;
        selected = current;
    });

    async function open(name: string): Promise<void> {
        if (!name || busy) {
            return;
        }
        if (name === current) {
            dispatch("close");
            return;
        }
        busy = true;
        error = "";
        try {
            await switchProfile(name);
            location.reload();
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
            busy = false;
        }
    }

    async function create(): Promise<void> {
        const name = prompt(tr.actionsName(), "");
        if (!name?.trim()) {
            return;
        }
        if (profiles.includes(name.trim())) {
            error = `A profile called ${name.trim()} already exists.`;
            return;
        }
        await open(name.trim());
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            dispatch("close");
        } else if (event.key === "Enter") {
            void open(selected);
        }
    }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="backdrop" role="presentation" on:click|self={() => dispatch("close")}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Switch profile">
        <h2>Switch Profile</h2>
        <p class="hint">Each profile has its own collection, settings and media.</p>
        <div class="list" role="listbox">
            {#each profiles as name (name)}
                <button
                    role="option"
                    aria-selected={name === selected}
                    class:selected={name === selected}
                    on:click={() => (selected = name)}
                    on:dblclick={() => open(name)}
                >
                    {name}
                    {#if name === current}
                        <span class="current">(open)</span>
                    {/if}
                </button>
            {/each}
        </div>
        {#if error}
            <p class="error">{error}</p>
        {/if}
        <div class="buttons">
            <button on:click={create} disabled={busy}>New Profile…</button>
            <span class="spacer"></span>
            <button on:click={() => dispatch("close")} disabled={busy}>
                {tr.actionsCancel()}
            </button>
            <button
                class="primary"
                on:click={() => open(selected)}
                disabled={busy || !selected}
            >
                Open
            </button>
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
        z-index: 50;
    }
    .dialog {
        width: 380px;
        max-width: 90vw;
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius-medium);
        box-shadow: var(--shadow);
        padding: 16px;
    }
    h2 {
        margin: 0 0 4px;
        font-size: 1.1rem;
    }
    .hint {
        margin: 0 0 12px;
        color: var(--fg-subtle);
        font-size: 13px;
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 260px;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 4px;
        background: var(--canvas);
    }
    .list button {
        text-align: start;
        font: inherit;
        color: var(--fg);
        background: transparent;
        border: 0;
        border-radius: var(--border-radius);
        padding: 6px 10px;
        cursor: pointer;
    }
    .list button.selected {
        background: var(--selected-bg);
        color: var(--selected-fg);
    }
    .current {
        color: var(--fg-subtle);
        font-size: 12px;
        margin-inline-start: 6px;
    }
    .error {
        color: var(--accent-danger);
        font-size: 13px;
        margin: 8px 0 0;
    }
    .buttons {
        display: flex;
        gap: 8px;
        margin-top: 14px;
    }
    .spacer {
        flex: 1;
    }
    .buttons button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 5px 12px;
        cursor: pointer;
    }
    .buttons button.primary {
        background: var(--button-primary-bg);
        color: white;
        border-color: transparent;
    }
</style>
