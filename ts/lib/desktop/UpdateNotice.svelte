<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The sidebar's offer of a newer version (updates.ts): shown only while there
is one, so a copy that is up to date has nothing extra on screen.
-->
<script lang="ts">
    import { createEventDispatcher } from "svelte";

    import type { UpdateController } from "./updates";

    export let controller: UpdateController;

    const dispatch = createEventDispatcher<{ restart: void }>();
    const state = controller.state;
</script>

{#if $state.phase !== "none"}
    <div class="update-notice" role="status">
        {#if $state.phase === "available"}
            <span>Anki {$state.version} is available</span>
            <button on:click={() => void controller.download()}>Update</button>
        {:else if $state.phase === "downloading"}
            <span>Downloading Anki {$state.version}…</span>
        {:else if $state.phase === "ready"}
            <span>Anki {$state.version} is ready</span>
            <button on:click={() => dispatch("restart")}>Restart to update</button>
        {:else}
            <span>Restarting…</span>
        {/if}
    </div>
{/if}

<style>
    .update-notice {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        font-size: 12px;
        color: var(--fg);
        background: var(--app-accent-soft);
        border-radius: var(--app-radius);
    }
    button {
        font: inherit;
        font-weight: 600;
        color: var(--app-accent-fg);
        background: var(--app-accent);
        border: 0;
        border-radius: var(--app-radius-small);
        padding: 5px 10px;
        cursor: pointer;
    }
    button:hover {
        background: var(--app-accent-hover);
    }
</style>
