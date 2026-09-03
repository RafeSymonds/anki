<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Records from the microphone until the user saves or cancels, then hands the
file's path to whoever asked (the editor's Record Audio button). Replaces the
Qt recorder window.
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import { saveRecording } from "./desktop-api";
    import { chooseMimeType, formatElapsed, recordingName } from "./recording";

    /** Resolves with the saved file's path, or "" when cancelled or failed. */
    export let resolve: (path: string) => void;

    const dispatch = createEventDispatcher<{ close: void }>();

    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let startedAt = 0;
    let elapsed = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let state: "starting" | "recording" | "saving" | "error" = "starting";
    let error = "";
    let saveWhenStopped = false;

    onMount(async () => {
        try {
            if (typeof MediaRecorder === "undefined") {
                throw new Error("This system cannot record audio.");
            }
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = chooseMimeType((t) => MediaRecorder.isTypeSupported(t));
            recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };
            recorder.onstop = () => void onStopped();
            recorder.start(250);
            startedAt = Date.now();
            timer = setInterval(() => (elapsed = Date.now() - startedAt), 200);
            state = "recording";
        } catch (err) {
            fail(err);
        }
    });

    onDestroy(() => {
        if (timer) {
            clearInterval(timer);
        }
        stream?.getTracks().forEach((track) => track.stop());
    });

    function fail(err: unknown): void {
        error = err instanceof Error ? err.message : String(err);
        state = "error";
    }

    function finish(path: string): void {
        resolve(path);
        dispatch("close");
    }

    function save(): void {
        if (state !== "recording" || !recorder) {
            return;
        }
        state = "saving";
        saveWhenStopped = true;
        recorder.stop();
    }

    function cancel(): void {
        saveWhenStopped = false;
        if (recorder && recorder.state !== "inactive") {
            recorder.stop();
        }
        finish("");
    }

    async function onStopped(): Promise<void> {
        stream?.getTracks().forEach((track) => track.stop());
        if (!saveWhenStopped) {
            return;
        }
        try {
            const type = recorder?.mimeType || chunks[0]?.type || "audio/webm";
            const blob = new Blob(chunks, { type });
            if (blob.size === 0) {
                throw new Error("Nothing was recorded.");
            }
            const path = await saveRecording(recordingName(Date.now(), type), blob);
            finish(path);
        } catch (err) {
            fail(err);
        }
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            cancel();
        } else if (event.key === "Enter") {
            save();
        }
    }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="backdrop">
    <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr.editingRecordAudio()}
    >
        <h2>{tr.editingRecordAudio()}</h2>
        {#if state === "error"}
            <p class="error">{error}</p>
        {:else}
            <div class="meter" class:live={state === "recording"}>
                <span class="dot"></span>
                <span class="time">{formatElapsed(elapsed)}</span>
            </div>
            <p class="hint">
                {#if state === "starting"}
                    Waiting for the microphone…
                {:else if state === "saving"}
                    Saving…
                {:else}
                    Recording. Press Save when you are done.
                {/if}
            </p>
        {/if}
        <div class="buttons">
            <button on:click={cancel} disabled={state === "saving"}>
                {tr.actionsCancel()}
            </button>
            <button class="primary" on:click={save} disabled={state !== "recording"}>
                {tr.actionsSave()}
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
        width: 320px;
        max-width: 90vw;
        background: var(--canvas-elevated);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius-medium);
        box-shadow: var(--shadow);
        padding: 16px;
        text-align: center;
    }
    h2 {
        margin: 0 0 12px;
        font-size: 1.1rem;
    }
    .meter {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 1.8rem;
        font-variant-numeric: tabular-nums;
    }
    .dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--fg-subtle);
    }
    .live .dot {
        background: var(--accent-danger);
        animation: pulse 1s ease-in-out infinite;
    }
    @keyframes pulse {
        50% {
            opacity: 0.3;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .live .dot {
            animation: none;
        }
    }
    .hint {
        margin: 8px 0 0;
        color: var(--fg-subtle);
        font-size: 13px;
    }
    .error {
        color: var(--accent-danger);
        font-size: 13px;
    }
    .buttons {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin-top: 16px;
    }
    .buttons button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 5px 14px;
        cursor: pointer;
    }
    .buttons button.primary {
        background: var(--button-primary-bg);
        color: white;
        border-color: transparent;
    }
    .buttons button:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
