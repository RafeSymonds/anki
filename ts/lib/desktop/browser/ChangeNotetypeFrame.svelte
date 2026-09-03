<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The change-notetype page (ts/routes/change-notetype) for the selected
notes. The page posts its ChangeNotetypeRequest to /_anki/changeNotetype
without note ids; the Qt media server intercepted that call and filled them
in (mediasrv.py::change_notetype). Here the frame's fetch is wrapped to do
the same, and the shell runs the change and reports back.
-->
<script lang="ts">
    import { ChangeNotetypeRequest } from "@generated/anki/notetypes_pb";
    import { changeNotetype } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    export let notetypeId: bigint;
    export let noteIds: bigint[];
    export let nightMode = false;

    const dispatch = createEventDispatcher<{ close: void; done: number }>();

    let frame: HTMLIFrameElement;
    const src = `/change-notetype/${notetypeId}${nightMode ? "#night" : ""}`;

    function onLoad(): void {
        const win = frame?.contentWindow;
        if (!win) {
            return;
        }
        const original = win.fetch.bind(win);
        type FetchInput = Parameters<typeof fetch>[0];
        type FetchInit = Parameters<typeof fetch>[1];
        const urlOf = (input: FetchInput): string => {
            if (typeof input === "string") {
                return input;
            }
            return "href" in input ? input.href : input.url;
        };
        win.fetch = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
            const url = urlOf(input);
            const method = (init?.method ?? "GET").toUpperCase();
            if (method !== "POST" || !/\/_anki\/changeNotetype$/.test(url)) {
                return original(input, init);
            }
            const body = init?.body;
            const bytes =
                body instanceof Uint8Array
                    ? body
                    : new Uint8Array(
                          await new Response(body ?? new Uint8Array()).arrayBuffer(),
                      );
            const request = ChangeNotetypeRequest.fromBinary(new Uint8Array(bytes));
            request.noteIds = noteIds;
            try {
                const changes = await changeNotetype(request, { alertOnError: false });
                dispatch("done", noteIds.length);
                return new Response(changes.toBinary(), {
                    status: 200,
                    headers: { "Content-Type": "application/binary" },
                });
            } catch (err) {
                return new Response(String((err as Error).message ?? err), {
                    status: 500,
                });
            }
        };
    }
</script>

<div class="change-notetype">
    <div class="bar">
        <span class="title">{tr.browsingChangeNotetype()}</span>
        <button on:click={() => dispatch("close")}>{tr.actionsClose()}</button>
    </div>
    <iframe bind:this={frame} {src} title="change notetype" on:load={onLoad}></iframe>
</div>

<style>
    .change-notetype {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
    }
    .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-bottom: 1px solid var(--border);
        background: var(--canvas-elevated);
    }
    .title {
        flex: 1;
        font-weight: 600;
    }
    button {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 2px 10px;
        cursor: pointer;
    }
    iframe {
        flex: 1;
        width: 100%;
        border: 0;
        background: var(--canvas);
    }
</style>
