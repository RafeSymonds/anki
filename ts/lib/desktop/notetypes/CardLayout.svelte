<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

The card templates screen (qt/aqt/clayout.py): the front, back and styling
editors of one card type, a live preview rendered with renderUncommittedCard
into a card frame, and the card type operations; saved with one
updateNotetype call.
-->
<script lang="ts">
    import type { AVTag } from "@generated/anki/card_rendering_pb";
    import type { Note } from "@generated/anki/notes_pb";
    import type { Notetype, Notetype_Template, StockNotetype_Kind } from "@generated/anki/notetypes_pb";
    import {
        Notetype_Config,
        Notetype_Template_Config,
        StockNotetype_OriginalStockKind,
    } from "@generated/anki/notetypes_pb";
    import {
        clozeNumbersInNote,
        getDeck,
        getDeckIdByName,
        getNote,
        getNotetype,
        getNotetypeNamesAndCounts,
        newNote,
        restoreNotetypeToStock,
        searchCards,
        updateNotetype,
    } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { withCollapsedWhitespace, withoutUnicodeIsolation } from "@tslib/i18n";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    import { avPlayer } from "../audio";
    import CardFrame from "../CardFrame.svelte";
    import { createDeck } from "../decks";
    import { ShortcutMap } from "../shortcuts";
    import ChooserDialog from "./ChooserDialog.svelte";
    import Modal from "./Modal.svelte";
    import {
        addTemplate,
        browserAppearance,
        fieldReplacementHtml,
        flipTemplate,
        isCloze,
        newTemplate,
        newTemplateName,
        removeTemplate,
        renameTemplate,
        repositionTemplate,
        setBrowserAppearance,
        stockNotetypes,
        templateMarkdown,
        templateSummary,
    } from "./notetypes";
    import type { PreviewSide } from "./preview";
    import { renderPreview } from "./preview";

    export let notetypeId: bigint;
    /** The note previewed: an existing one, or a new note with `fields`. */
    export let noteId: bigint | null = null;
    export let fields: string[] | null = null;
    export let ord = 0;
    export let fillEmpty = false;
    export let nightMode = false;

    const dispatch = createEventDispatcher<{ close: void; saved: void; notify: string }>();

    type Editor = "front" | "back" | "style";

    let notetype: Notetype | null = null;
    let note: Note | null = null;
    let useCount = 0;
    let changed = false;
    let editor: Editor = "front";
    let editorText = "";
    let side: PreviewSide = "question";
    let clozeNumbers: number[] = [];
    let frame: CardFrame;
    let avTags: AVTag[] = [];
    let previewTimer: ReturnType<typeof setTimeout> | undefined;
    let menuOpen = false;
    let addFieldOpen = false;
    let addFieldIndex = 0;
    let addFieldFont = "Arial";
    let addFieldSize = 20;
    let appearance: { qfmt: string; afmt: string; override: boolean; font: { name: string; size: number } } | null = null;
    let stockChooser = false;

    $: cloze = notetype ? isCloze(notetype) : false;
    $: templates = notetype?.templates ?? [];
    $: title = notetype ? withoutUnicodeIsolation(tr.cardTemplatesCardTypesFor({ val: notetype.name })) : "";

    function currentTemplate(): Notetype_Template {
        return cloze ? templates[0] : templates[ord];
    }

    function templateConfig(): Notetype_Template_Config {
        return currentTemplate().config!;
    }

    onMount(async () => {
        const loaded = await getNotetype({ ntid: notetypeId });
        loaded.config ??= new Notetype_Config();
        for (const template of loaded.templates) {
            template.config ??= new Notetype_Template_Config();
        }
        let previewed: Note;
        if (noteId) {
            previewed = await getNote({ nid: noteId });
        } else {
            previewed = await newNote({ ntid: notetypeId });
            if (fields) {
                previewed.fields = [...fields];
            }
        }
        const counts = await getNotetypeNamesAndCounts({});
        useCount = counts.entries.find((entry) => entry.id === notetypeId)?.useCount ?? 0;
        if (isCloze(loaded)) {
            const numbers = [...(await clozeNumbersInNote(previewed)).numbers];
            if (!numbers.includes(ord + 1)) {
                // The current card is empty.
                numbers.push(ord + 1);
            }
            clozeNumbers = numbers.sort((a, b) => a - b);
        }
        note = previewed;
        notetype = loaded;
        redrawEverything();
    });

    onDestroy(() => {
        clearTimeout(previewTimer);
        avPlayer.stop();
    });

    /** `redraw_everything`: refresh the card type list, the editor and the preview. */
    function redrawEverything(): void {
        notetype = notetype;
        fillEditor();
        schedulePreview();
    }

    /** `fill_fields_from_template`. */
    function fillEditor(): void {
        if (!notetype) {
            return;
        }
        const config = templateConfig();
        if (editor === "front") {
            editorText = config.qFormat;
        } else if (editor === "back") {
            editorText = config.aFormat;
        } else {
            editorText = notetype.config!.css;
        }
    }

    /** `write_edits_to_template_and_redraw`. */
    function onEditorInput(): void {
        if (!notetype) {
            return;
        }
        changed = true;
        if (editor === "front") {
            templateConfig().qFormat = editorText;
        } else if (editor === "back") {
            templateConfig().aFormat = editorText;
        } else {
            notetype.config!.css = editorText;
        }
        schedulePreview();
    }

    /** `on_editor_toggled`: the preview follows the side being edited. */
    function setEditor(next: Editor): void {
        editor = next;
        if (next === "front") {
            side = "question";
        } else if (next === "back") {
            side = "answer";
        }
        fillEditor();
        schedulePreview();
    }

    function setSide(next: PreviewSide): void {
        side = next;
        schedulePreview();
    }

    function selectTemplate(index: number): void {
        if (index < 0 || index >= templates.length) {
            return;
        }
        ord = index;
        fillEditor();
        schedulePreview();
    }

    function selectCloze(number: number): void {
        ord = number - 1;
        schedulePreview();
    }

    /** `renderPreview`: render once typing has paused. */
    function schedulePreview(): void {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => void doPreview(), 200);
    }

    $: (nightMode, fillEmpty, schedulePreview());

    async function doPreview(): Promise<void> {
        if (!notetype || !note || !frame) {
            return;
        }
        try {
            const rendered = await renderPreview({
                note,
                notetype,
                template: currentTemplate(),
                ord,
                side,
                fillEmpty,
                nightMode,
            });
            avTags = rendered.avTags;
            frame.view.showPreview?.(rendered.html, rendered.bodyClass);
        } catch (err) {
            console.warn("preview failed", err);
        }
    }

    function onCardCommand(command: string): void {
        if (command.startsWith("play:")) {
            const tag = avTags[Number(command.split(":")[2])];
            if (tag) {
                avPlayer.playTags([tag]);
            }
        }
    }

    // Card type operations (`onMore` in clayout.py).

    async function addCardType(): Promise<void> {
        menuOpen = false;
        if (!notetype) {
            return;
        }
        if (useCount && !confirm(tr.cardTemplatesThisWillCreateCardProceed({ count: useCount }))) {
            return;
        }
        const old = templateConfig();
        addTemplate(notetype, newTemplate(newTemplateName(notetype), old.qFormat, old.aFormat));
        ord = notetype.templates.length - 1;
        changed = true;
        redrawEverything();
    }

    /** `template_use_count`: cards of this notetype using the template's stored ordinal. */
    async function templateUseCount(template: Notetype_Template): Promise<number> {
        if (template.ord === undefined) {
            return 0;
        }
        const result = await searchCards({
            search: `mid:${notetypeId} card:${template.ord.val + 1}`,
            order: { value: { case: "none", value: {} } },
        });
        return result.ids.length;
    }

    async function removeCardType(): Promise<void> {
        menuOpen = false;
        if (!notetype) {
            return;
        }
        if (templates.length < 2) {
            alert(tr.cardTemplatesAtLeastOneCardTypeIs());
            return;
        }
        const template = currentTemplate();
        const cards = tr.cardTemplatesCardCount({ count: await templateUseCount(template) });
        // The message takes the card count as a string ("3 cards").
        const message = tr.cardTemplatesDeleteTheAsCardTypeAnd({
            template: template.name,
            cards: cards as unknown as number,
        });
        if (!confirm(message)) {
            return;
        }
        removeTemplate(notetype, templates.indexOf(template));
        if (ord >= notetype.templates.length) {
            ord = notetype.templates.length - 1;
        }
        changed = true;
        redrawEverything();
    }

    function renameCardType(): void {
        menuOpen = false;
        if (!notetype) {
            return;
        }
        const template = currentTemplate();
        const text = prompt(tr.actionsNewName(), template.name);
        if (text !== null && renameTemplate(notetype, templates.indexOf(template), text)) {
            changed = true;
            redrawEverything();
        }
    }

    function repositionCardType(): void {
        menuOpen = false;
        if (!notetype) {
            return;
        }
        const count = templates.length;
        const template = currentTemplate();
        const currentPos = templates.indexOf(template) + 1;
        const text = prompt(tr.cardTemplatesEnterNewCardPosition1({ val: count }), String(currentPos));
        if (!text) {
            return;
        }
        const position = Number(text);
        if (!Number.isInteger(position) || position < 1 || position > count || position === currentPos) {
            return;
        }
        repositionTemplate(notetype, currentPos - 1, position - 1);
        ord = position - 1;
        changed = true;
        redrawEverything();
    }

    /** `onTargetDeck`: the deck new cards of this card type go to. */
    async function deckOverride(): Promise<void> {
        menuOpen = false;
        if (!notetype) {
            return;
        }
        const config = templateConfig();
        let current = "";
        if (config.targetDeckId) {
            try {
                current = (await getDeck({ did: config.targetDeckId }, { alertOnError: false })).name;
            } catch {
                current = "";
            }
        }
        const text = prompt(
            withoutUnicodeIsolation(tr.cardTemplatesEnterDeckToPlaceNew({ val: currentTemplate().name })),
            current,
        );
        if (text === null) {
            return;
        }
        const name = text.trim();
        if (!name) {
            config.targetDeckId = 0n;
        } else {
            try {
                config.targetDeckId = (await getDeckIdByName({ val: name }, { alertOnError: false })).did;
            } catch {
                config.targetDeckId = await createDeck(name);
            }
        }
        changed = true;
        notetype = notetype;
    }

    async function copyInfo(): Promise<void> {
        menuOpen = false;
        if (!notetype) {
            return;
        }
        await navigator.clipboard.writeText(templateMarkdown(currentTemplate(), notetype.config!.css));
        dispatch("notify", "Copied to clipboard");
    }

    function openBrowserAppearance(): void {
        menuOpen = false;
        if (!notetype) {
            return;
        }
        const current = browserAppearance(currentTemplate());
        appearance = {
            qfmt: current.qfmt,
            afmt: current.afmt,
            override: current.font !== null,
            font: current.font ?? { name: "Arial", size: 12 },
        };
    }

    function saveBrowserAppearance(): void {
        if (!notetype || !appearance) {
            return;
        }
        setBrowserAppearance(currentTemplate(), {
            qfmt: appearance.qfmt,
            afmt: appearance.afmt,
            font: appearance.override ? appearance.font : null,
        });
        appearance = null;
        changed = true;
        notetype = notetype;
    }

    /** `on_restore_to_default`: notetypes from before 2.1.62 are asked which stock type they were. */
    async function restoreToDefault(forceKind?: StockNotetype_Kind): Promise<void> {
        menuOpen = false;
        if (!notetype) {
            return;
        }
        const unknown = (notetype.config?.originalStockKind ?? 0) === StockNotetype_OriginalStockKind.UNKNOWN;
        if (forceKind === undefined && unknown) {
            stockChooser = true;
            return;
        }
        if (!confirm(withCollapsedWhitespace(tr.cardTemplatesRestoreToDefaultConfirmation()))) {
            return;
        }
        try {
            await restoreNotetypeToStock({ notetypeId: { ntid: notetypeId }, forceKind });
        } catch {
            return;
        }
        changed = false;
        dispatch("saved");
        dispatch("close");
        alert(tr.cardTemplatesRestoredToDefault());
    }

    function onStockChosen(index: number): void {
        stockChooser = false;
        void restoreToDefault(stockNotetypes()[index].kind);
    }

    function flip(): void {
        if (!notetype) {
            return;
        }
        if (!flipTemplate(currentTemplate())) {
            alert(tr.cardTemplatesAnkiCouldntFindTheLineBetween());
            return;
        }
        changed = true;
        redrawEverything();
    }

    function openAddField(): void {
        addFieldIndex = 0;
        addFieldFont = "Arial";
        addFieldSize = 20;
        addFieldOpen = true;
    }

    /** `_addField`: append the field's markup to the template being edited. */
    function addFieldToTemplate(): void {
        addFieldOpen = false;
        const field = notetype?.fields[addFieldIndex];
        if (!field) {
            return;
        }
        editorText += fieldReplacementHtml(field.name, addFieldFont, addFieldSize);
        onEditorInput();
    }

    async function save(): Promise<void> {
        if (!notetype) {
            return;
        }
        try {
            await updateNotetype(notetype);
        } catch {
            return;
        }
        dispatch("saved");
        dispatch("close");
    }

    function cancel(): void {
        if (changed && !confirm(tr.cardTemplatesDiscardChanges())) {
            return;
        }
        dispatch("close");
    }

    const shortcuts = new ShortcutMap().addAll([
        ["Ctrl+1", () => setEditor("front")],
        ["Ctrl+2", () => setEditor("back")],
        ["Ctrl+3", () => setEditor("style")],
        ["F3", () => selectTemplate(ord - 1)],
        ["F4", () => selectTemplate(ord + 1)],
        ["Ctrl+Return", () => void save()],
        ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map(
            (n): [string, () => void] => [
                `Alt+${n}`,
                () => {
                    if (clozeNumbers[n - 1] !== undefined) {
                        selectCloze(clozeNumbers[n - 1]);
                    }
                },
            ],
        ),
    ]);

    function onKey(event: KeyboardEvent): boolean {
        if (addFieldOpen || appearance || stockChooser) {
            return false;
        }
        return shortcuts.handle(event);
    }
</script>

<Modal {title} width="94vw" height="90vh" {onKey} on:close={cancel}>
    {#if notetype && note}
        <div class="card-layout">
            <div class="top">
                <span class="label">{tr.cardTemplatesCardType()}</span>
                <select
                    class="card-types"
                    disabled={cloze}
                    value={cloze ? 0 : ord}
                    on:change={(e) => selectTemplate(Number(e.currentTarget.value))}
                >
                    {#each templates as template, index (template)}
                        <option value={index}>{templateSummary(index, template)}</option>
                    {/each}
                </select>
                <div class="menu-anchor">
                    <button class="options-button" on:click={() => (menuOpen = !menuOpen)}>
                        {tr.actionsOptions()} ▾
                    </button>
                    {#if menuOpen}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div class="menu" on:mouseleave={() => (menuOpen = false)}>
                            <button on:click={() => restoreToDefault()}>
                                {tr.actionsWithEllipsis({ action: tr.cardTemplatesRestoreToDefault() })}
                            </button>
                            {#if !cloze}
                                <button on:click={addCardType}>{tr.cardTemplatesAddCardType()}</button>
                                <button on:click={removeCardType}>
                                    {tr.cardTemplatesRemoveCardType()}
                                </button>
                                <button on:click={renameCardType}>
                                    {tr.cardTemplatesRenameCardType()}
                                </button>
                                <button on:click={repositionCardType}>
                                    {tr.cardTemplatesRepositionCardType()}
                                </button>
                                <div class="divider"></div>
                                <button on:click={deckOverride}>
                                    {tr.cardTemplatesDeckOverride()}
                                    {templateConfig().targetDeckId
                                        ? tr.cardTemplatesOn()
                                        : tr.cardTemplatesOff()}
                                </button>
                            {/if}
                            <button on:click={copyInfo}>{tr.cardTemplatesCopyInfo()}</button>
                            <button on:click={openBrowserAppearance}>
                                {tr.cardTemplatesBrowserAppearance()}
                            </button>
                        </div>
                    {/if}
                </div>
            </div>

            <div class="main">
                <div class="editor-pane">
                    <div class="tabs" role="tablist">
                        <button
                            role="tab"
                            aria-selected={editor === "front"}
                            class:active={editor === "front"}
                            title={tr.actionsShortcutKey({ val: "⌘1" })}
                            on:click={() => setEditor("front")}
                        >
                            {tr.cardTemplatesFrontTemplate()}
                        </button>
                        <button
                            role="tab"
                            aria-selected={editor === "back"}
                            class:active={editor === "back"}
                            title={tr.actionsShortcutKey({ val: "⌘2" })}
                            on:click={() => setEditor("back")}
                        >
                            {tr.cardTemplatesBackTemplate()}
                        </button>
                        <button
                            role="tab"
                            aria-selected={editor === "style"}
                            class:active={editor === "style"}
                            title={tr.actionsShortcutKey({ val: "⌘3" })}
                            on:click={() => setEditor("style")}
                        >
                            {tr.cardTemplatesTemplateStyling()}
                        </button>
                    </div>
                    <textarea
                        class="template-editor"
                        spellcheck="false"
                        bind:value={editorText}
                        on:input={onEditorInput}
                    ></textarea>
                    <div class="editor-footer">
                        <span class="affects">
                            {tr.cardTemplatesChangesWillAffectNotes({ count: useCount })}
                        </span>
                        <span class="spacer"></span>
                        {#if editor !== "style"}
                            <button on:click={openAddField}>{tr.fieldsAddField()}</button>
                        {/if}
                        {#if !cloze}
                            <button on:click={flip}>{tr.cardTemplatesFlip()}</button>
                        {/if}
                    </div>
                </div>

                <div class="preview-pane">
                    <div class="preview-bar">
                        <label>
                            <input
                                type="radio"
                                name="preview-side"
                                checked={side === "question"}
                                on:change={() => setSide("question")}
                            />
                            {tr.cardTemplatesFrontPreview()}
                        </label>
                        <label>
                            <input
                                type="radio"
                                name="preview-side"
                                checked={side === "answer"}
                                on:change={() => setSide("answer")}
                            />
                            {tr.cardTemplatesBackPreview()}
                        </label>
                        {#if cloze}
                            <select
                                class="cloze-numbers"
                                value={ord + 1}
                                on:change={(e) => selectCloze(Number(e.currentTarget.value))}
                            >
                                {#each clozeNumbers as number}
                                    <option value={number}>{tr.cardTemplatesCard({ val: number })}</option>
                                {/each}
                            </select>
                        {/if}
                        <span class="spacer"></span>
                        <label>
                            <input type="checkbox" bind:checked={fillEmpty} />
                            {tr.cardTemplatesFillEmpty()}
                        </label>
                    </div>
                    <div class="preview-frame">
                        <CardFrame
                            bind:this={frame}
                            {nightMode}
                            onCommand={onCardCommand}
                            onKeydown={() => {}}
                        />
                    </div>
                </div>
            </div>
        </div>
    {/if}
    <svelte:fragment slot="buttons">
        <button on:click={cancel}>{tr.actionsCancel()}</button>
        <button class="primary" title={tr.actionsShortcutKey({ val: "⌘⏎" })} on:click={save}>
            {tr.actionsSave()}
        </button>
    </svelte:fragment>
</Modal>

{#if addFieldOpen && notetype}
    <Modal title={tr.fieldsAddField()} width="420px" on:close={() => (addFieldOpen = false)}>
        <div class="form">
            <label>
                <span>{tr.fieldsField()}</span>
                <select bind:value={addFieldIndex}>
                    {#each notetype.fields as field, index (field)}
                        <option value={index}>{field.name}</option>
                    {/each}
                </select>
            </label>
            <label>
                <span>{tr.fieldsFont()}</span>
                <input type="text" bind:value={addFieldFont} />
            </label>
            <label>
                <span>{tr.fieldsSize()}</span>
                <input type="number" min="5" max="300" bind:value={addFieldSize} />
            </label>
        </div>
        <svelte:fragment slot="buttons">
            <button on:click={() => (addFieldOpen = false)}>{tr.actionsCancel()}</button>
            <button class="primary" on:click={addFieldToTemplate}>{tr.actionsAdd()}</button>
        </svelte:fragment>
    </Modal>
{/if}

{#if appearance}
    <Modal title={tr.cardTemplatesBrowserAppearance()} width="480px" on:close={() => (appearance = null)}>
        <div class="form">
            <label>
                <span>{tr.browsingOverrideFrontTemplate()}</span>
                <input type="text" bind:value={appearance.qfmt} />
            </label>
            <label>
                <span>{tr.browsingOverrideBackTemplate()}</span>
                <input type="text" bind:value={appearance.afmt} />
            </label>
            <label class="check">
                <input type="checkbox" bind:checked={appearance.override} />
                {tr.browsingOverrideFont()}
            </label>
            <label>
                <span>{tr.browsingFont()}</span>
                <input type="text" disabled={!appearance.override} bind:value={appearance.font.name} />
            </label>
            <label>
                <span>{tr.browsingFontSize()}</span>
                <input
                    type="number"
                    min="5"
                    max="300"
                    disabled={!appearance.override}
                    bind:value={appearance.font.size}
                />
            </label>
        </div>
        <svelte:fragment slot="buttons">
            <button on:click={() => (appearance = null)}>{tr.actionsCancel()}</button>
            <button class="primary" on:click={saveBrowserAppearance}>{tr.actionsSave()}</button>
        </svelte:fragment>
    </Modal>
{/if}

{#if stockChooser}
    <ChooserDialog
        title={tr.cardTemplatesRestoreToDefault()}
        items={stockNotetypes().map((s) => s.name)}
        on:choose={(e) => onStockChosen(e.detail)}
        on:cancel={() => (stockChooser = false)}
    />
{/if}

<style>
    .card-layout {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .top {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .label {
        color: var(--fg-subtle);
    }
    .card-types {
        flex: 1;
        min-width: 0;
    }
    .main {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
    }
    .editor-pane,
    .preview-pane {
        display: flex;
        flex-direction: column;
        min-height: 0;
        gap: 8px;
    }
    .tabs {
        display: flex;
        gap: 4px;
    }
    .tabs button.active {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .template-editor {
        flex: 1;
        min-height: 0;
        resize: none;
        font-family: Consolas, Menlo, monospace;
        font-size: 13px;
        tab-size: 4;
        color: var(--fg);
        background: var(--canvas-code);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 8px;
    }
    .editor-footer,
    .preview-bar {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .affects {
        color: var(--fg-subtle);
        font-size: 12px;
    }
    .spacer {
        flex: 1;
    }
    .preview-frame {
        flex: 1;
        min-height: 0;
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        overflow: hidden;
    }
    button,
    select,
    input[type="text"],
    input[type="number"] {
        font: inherit;
        color: var(--fg);
        background: var(--button-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 4px 10px;
    }
    button {
        cursor: pointer;
    }
    button:hover {
        border-color: var(--button-hover-border);
    }
    input[type="text"],
    input[type="number"] {
        background: var(--canvas-inset);
        padding: 3px 6px;
    }
    label {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .menu-anchor {
        position: relative;
    }
    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        min-width: 260px;
        background: var(--canvas-elevated);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow);
        padding: 4px;
        display: flex;
        flex-direction: column;
        z-index: 10;
    }
    .menu button {
        text-align: start;
        border: 0;
        background: transparent;
        padding: 6px 10px;
    }
    .menu button:hover {
        background: var(--highlight-bg);
        color: var(--highlight-fg);
    }
    .divider {
        height: 1px;
        background: var(--border);
        margin: 4px 0;
    }
    .form {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .form label span {
        width: 130px;
        color: var(--fg-subtle);
    }
    .form input[type="text"],
    .form select {
        flex: 1;
        min-width: 0;
    }
</style>
