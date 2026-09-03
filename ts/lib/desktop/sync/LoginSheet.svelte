<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The AnkiWeb login form (get_id_and_pass_from_user in qt/aqt/sync.py).
Submits whatever was typed; the sync flow decides whether to re-prompt.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onMount } from "svelte";

    export let username = "";
    export let password = "";

    const dispatch = createEventDispatcher<{
        submit: { username: string; password: string };
        cancel: void;
    }>();

    let userInput: HTMLInputElement;

    onMount(() => {
        userInput?.focus();
    });

    function submit(): void {
        dispatch("submit", { username, password });
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            event.preventDefault();
            submit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            dispatch("cancel");
        }
    }
</script>

<form class="login" on:submit|preventDefault={submit}>
    <div class="intro">
        {@html tr.syncAccountRequired({ link: "https://ankiweb.net/account/register" })}
    </div>
    <label>
        <span>{tr.syncAnkiwebIdLabel()}</span>
        <input
            bind:this={userInput}
            bind:value={username}
            type="text"
            autocomplete="username"
            spellcheck="false"
            on:keydown={onKeydown}
        />
    </label>
    <label>
        <span>{tr.syncPasswordLabel()}</span>
        <input
            bind:value={password}
            type="password"
            autocomplete="current-password"
            on:keydown={onKeydown}
        />
    </label>
    <div class="buttons">
        <button type="button" on:click={() => dispatch("cancel")}>
            {tr.actionsCancel()}
        </button>
        <button type="submit" class="primary">{tr.syncLogInButton()}</button>
    </div>
</form>

<style>
    .login {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .intro :global(h1) {
        font-size: 1.2rem;
        margin: 0 0 8px;
    }
    .intro :global(a) {
        color: var(--fg-link);
    }
    label {
        display: grid;
        grid-template-columns: 90px 1fr;
        align-items: center;
        gap: 8px;
    }
    input {
        font: inherit;
        color: var(--fg);
        background: var(--canvas-inset);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 5px 8px;
    }
    .buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 8px;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 5px 14px;
        cursor: pointer;
    }
    button:hover {
        border-color: var(--button-hover-border);
    }
    button.primary {
        background: var(--button-primary-bg);
        color: white;
        border-color: transparent;
    }
</style>
