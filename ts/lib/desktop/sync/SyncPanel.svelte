<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Renders what the sync flow (sync.ts) wants shown: the login sheet, sync
progress with an Abort button, the full-sync questions, server or error
messages, and a non-blocking line for the media sync. Everything but the
media line is modal, like the dialogs in qt/aqt/sync.py.
-->
<script lang="ts">
    import { renderMarkdown } from "@generated/backend";
    import * as tr from "@generated/ftl";

    import { isTypingTarget } from "../shortcuts";
    import LoginSheet from "./LoginSheet.svelte";
    import type { SyncController } from "./sync";
    import { SYNC_TITLE } from "./sync";

    export let controller: SyncController;

    const state = controller.state;

    let promptHtml = "";
    let promptSource = "";

    $: if ($state.phase === "prompt") {
        void renderPrompt($state.text, $state.markdown);
    }

    async function renderPrompt(text: string, markdown: boolean): Promise<void> {
        if (promptSource === text) {
            return;
        }
        promptSource = text;
        promptHtml = "";
        if (!markdown) {
            return;
        }
        try {
            promptHtml = (await renderMarkdown({ markdown: text, sanitize: true })).val;
        } catch {
            promptHtml = "";
        }
    }

    function focusDefault(node: HTMLElement): void {
        node.focus();
    }

    $: modal = ["login", "progress", "prompt", "message"].includes($state.phase);

    // Shell shortcuts stay off while a sheet is up; Escape cancels it.
    function onKeydown(event: KeyboardEvent): void {
        if (!modal) {
            return;
        }
        const current = $state;
        if (isTypingTarget(event.target)) {
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            if (current.phase === "login") {
                controller.cancelLogin();
            } else if (current.phase === "prompt") {
                controller.answerPrompt(current.buttons.length - 1);
            } else if (current.phase === "message") {
                controller.dismiss();
            }
        }
        event.stopPropagation();
    }
</script>

<svelte:window on:keydown|capture={onKeydown} />

{#if modal}
    <div class="backdrop">
        <div class="sync-sheet" role="dialog" aria-label={SYNC_TITLE}>
            {#if $state.phase === "login"}
                <LoginSheet
                    username={$state.username}
                    password={$state.password}
                    on:submit={(e) =>
                        controller.submitLogin(e.detail.username, e.detail.password)}
                    on:cancel={() => controller.cancelLogin()}
                />
            {:else if $state.phase === "progress"}
                <div class="title">{$state.title}</div>
                {#each $state.lines as line}
                    <div class="line">{line}</div>
                {/each}
                {#if $state.max !== undefined && $state.max > 0}
                    <progress value={$state.value ?? 0} max={$state.max}></progress>
                {:else}
                    <progress></progress>
                {/if}
                <div class="buttons">
                    <button on:click={() => void controller.abort()}>
                        {tr.syncAbortButton()}
                    </button>
                </div>
            {:else if $state.phase === "prompt"}
                {#if promptHtml}
                    <div class="text">{@html promptHtml}</div>
                {:else}
                    <div class="text plain">{$state.text}</div>
                {/if}
                <div class="buttons">
                    {#each $state.buttons as button, index}
                        {#if index === $state.defaultIndex}
                            <button
                                class:primary={button.primary}
                                use:focusDefault
                                on:click={() => controller.answerPrompt(index)}
                            >
                                {button.label}
                            </button>
                        {:else}
                            <button
                                class:primary={button.primary}
                                on:click={() => controller.answerPrompt(index)}
                            >
                                {button.label}
                            </button>
                        {/if}
                    {/each}
                </div>
            {:else if $state.phase === "message"}
                {#if $state.html}
                    <div class="text">{@html $state.text}</div>
                {:else}
                    <div class="text plain">{$state.text}</div>
                {/if}
                <div class="buttons">
                    <button
                        class="primary"
                        use:focusDefault
                        on:click={() => controller.dismiss()}
                    >
                        {tr.actionsClose()}
                    </button>
                </div>
            {/if}
        </div>
    </div>
{:else if $state.phase === "media"}
    <div class="media" role="status">
        <span>{$state.text}</span>
        {#if $state.active}
            <button on:click={() => void controller.abort()}>
                {tr.syncAbortButton()}
            </button>
        {:else}
            <button on:click={() => controller.dismiss()}>{tr.actionsClose()}</button>
        {/if}
    </div>
{/if}

<style>
    .backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 80px;
        z-index: 40;
    }
    .sync-sheet {
        width: min(520px, calc(100% - 48px));
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow);
        padding: 20px;
    }
    .title {
        font-weight: 600;
        margin-bottom: 8px;
    }
    .line {
        color: var(--fg-subtle);
        white-space: pre-wrap;
        min-height: 1.2em;
    }
    progress {
        display: block;
        width: 100%;
        margin: 12px 0 4px;
    }
    .text {
        line-height: 1.4;
    }
    .text.plain {
        white-space: pre-wrap;
    }
    .text :global(p) {
        margin: 0 0 8px;
    }
    .buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
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
    .media {
        position: absolute;
        bottom: 16px;
        right: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--canvas-overlay);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 6px 12px;
        box-shadow: var(--shadow);
        z-index: 30;
    }
    .media button {
        padding: 2px 10px;
    }
</style>
