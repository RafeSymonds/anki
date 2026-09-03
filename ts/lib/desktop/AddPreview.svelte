<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The card the note being typed will make, beside the Add editor: question
above, answer below, re-rendered as the user types (plan item A11).
-->
<script lang="ts">
    import type { Notetype } from "@generated/anki/notetypes_pb";
    import { getNotetype } from "@generated/backend";

    import { previewPlan } from "./add-preview";
    import CardFrame from "./CardFrame.svelte";
    import type { EditorNoteInfo } from "./EditorPanel.svelte";
    import { renderPreview } from "./notetypes/preview";

    /** The editor's current note; null until it has loaded one. */
    export let info: EditorNoteInfo | null = null;
    export let nightMode = false;

    let question: CardFrame;
    let answer: CardFrame;
    let notetype: Notetype | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let empty = true;

    $: void ensureNotetype(info?.notetypeId ?? null);
    $: (info, nightMode, schedule());

    async function ensureNotetype(id: bigint | null): Promise<void> {
        if (id === null || notetype?.id === id) {
            return;
        }
        notetype = await getNotetype({ ntid: id });
        schedule();
    }

    function schedule(): void {
        clearTimeout(timer);
        timer = setTimeout(() => void render(), 250);
    }

    async function render(): Promise<void> {
        const plan = previewPlan(info, notetype);
        empty = plan === null;
        if (!plan || !question || !answer) {
            return;
        }
        try {
            const [q, a] = await Promise.all(
                (["question", "answer"] as const).map((side) =>
                    renderPreview({
                        note: plan.note,
                        notetype: notetype!,
                        template: plan.template,
                        ord: plan.ord,
                        side,
                        fillEmpty: false,
                        nightMode,
                    }),
                ),
            );
            question.view.showPreview?.(q.html, q.bodyClass);
            answer.view.showPreview?.(a.html, a.bodyClass);
        } catch (err) {
            console.warn("add preview failed", err);
        }
    }
</script>

<div class="add-preview" class:empty>
    <div class="side">
        <div class="label">Front</div>
        <div class="frame">
            <CardFrame
                bind:this={question}
                {nightMode}
                onCommand={() => {}}
                onKeydown={() => {}}
            />
        </div>
    </div>
    <div class="side">
        <div class="label">Back</div>
        <div class="frame">
            <CardFrame
                bind:this={answer}
                {nightMode}
                onCommand={() => {}}
                onKeydown={() => {}}
            />
        </div>
    </div>
    {#if empty}
        <p class="hint">Type in a field to see the card it makes.</p>
    {/if}
</div>

<style>
    .add-preview {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 8px;
        height: 100%;
        min-height: 0;
        padding: 8px;
        background: var(--canvas-inset);
        border-inline-start: 1px solid var(--border);
    }
    .side {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    .label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--fg-subtle);
        margin: 0 0 4px 2px;
    }
    .frame {
        flex: 1;
        min-height: 0;
        border: 1px solid var(--border);
        border-radius: var(--border-radius-medium);
        overflow: hidden;
        background: var(--canvas);
    }
    .empty .frame {
        opacity: 0.4;
    }
    .hint {
        position: absolute;
        inset: 50% 16px auto;
        transform: translateY(-50%);
        margin: 0;
        text-align: center;
        color: var(--fg-subtle);
        font-size: 13px;
    }
</style>
