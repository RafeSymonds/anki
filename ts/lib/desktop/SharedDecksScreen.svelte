<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

Getting a deck someone else made. The three steps are spelled out, the
subjects link straight into the AnkiWeb list, and any deck file already in
Downloads is offered for import with one click.
-->
<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";

    import { downloadedDecks, openLink } from "./desktop-api";
    import type { DownloadedDeck } from "./shared-decks";
    import {
        categoryUrl,
        displayName,
        fileSubtitle,
        SHARED_CATEGORIES,
        SHARED_DECKS_URL,
    } from "./shared-decks";

    const dispatch = createEventDispatcher<{
        importPath: string;
        importFile: void;
    }>();

    let files: DownloadedDeck[] = [];
    let loaded = false;
    let now = Date.now();

    async function refresh(): Promise<void> {
        try {
            files = await downloadedDecks();
        } catch {
            files = [];
        }
        now = Date.now();
        loaded = true;
    }

    onMount(() => {
        void refresh();
        // Coming back from the browser with a fresh download is the common
        // case, so re-check whenever the window regains focus.
        const onFocus = (): void => void refresh();
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    });

    function browse(url: string): void {
        void openLink(url);
    }
</script>

<div class="shared">
    <header>
        <h1>Get shared decks</h1>
        <p class="lede">
            Thousands of decks are shared on AnkiWeb, from language vocabulary to
            medical revision. Pick one there, download it, and it lands back here.
        </p>
    </header>

    <ol class="steps">
        <li>
            <span class="step">1</span>
            <div>
                <span class="what">Find a deck on AnkiWeb</span>
                <span class="detail">Opens in your web browser.</span>
            </div>
            <button class="primary" on:click={() => browse(SHARED_DECKS_URL)}>
                Open AnkiWeb
            </button>
        </li>
        <li>
            <span class="step">2</span>
            <div>
                <span class="what">Press Download on the deck's page</span>
                <span class="detail">The file is saved to your Downloads folder.</span>
            </div>
        </li>
        <li>
            <span class="step">3</span>
            <div>
                <span class="what">Come back here and import it</span>
                <span class="detail">Downloaded decks show up below on their own.</span>
            </div>
        </li>
    </ol>

    <section class="subjects">
        <h2>Popular subjects</h2>
        <div class="grid">
            {#each SHARED_CATEGORIES as category (category.search)}
                <button
                    class="subject"
                    on:click={() => browse(categoryUrl(category.search))}
                >
                    <span class="label">{category.label}</span>
                    <span class="hint">{category.hint}</span>
                </button>
            {/each}
        </div>
    </section>

    <section class="downloads">
        <div class="downloads-head">
            <h2>In your Downloads</h2>
            <button class="link" on:click={refresh}>Refresh</button>
        </div>
        {#if !loaded}
            <p class="empty">Looking…</p>
        {:else if files.length === 0}
            <p class="empty">
                No deck files yet. Once you download one from AnkiWeb it appears here.
                <button class="link" on:click={() => dispatch("importFile")}>
                    Pick a file yourself instead
                </button>
            </p>
        {:else}
            <ul class="files">
                {#each files as file (file.path)}
                    <li>
                        <div class="file-text">
                            <span class="name">{displayName(file.name)}</span>
                            <span class="meta">{fileSubtitle(file, now)}</span>
                        </div>
                        <button
                            class="import"
                            on:click={() => dispatch("importPath", file.path)}
                        >
                            Import
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </section>
</div>

<style>
    .shared {
        max-width: 720px;
        margin: 0 auto;
        padding: 8px 32px 56px;
    }
    header {
        margin-bottom: 28px;
    }
    h1 {
        font-family: var(--app-font-display);
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 0 0 8px;
        text-wrap: balance;
    }
    .lede {
        margin: 0;
        max-width: 56ch;
        color: var(--fg-subtle);
        line-height: 1.5;
    }
    h2 {
        font-family: var(--app-font-display);
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--fg-subtle);
        margin: 0 0 12px;
    }
    .steps {
        list-style: none;
        margin: 0 0 32px;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        background: var(--app-line);
        border-radius: var(--app-radius-large);
        overflow: hidden;
        box-shadow: var(--app-shadow-card);
    }
    .steps li {
        display: grid;
        grid-template-columns: 26px minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        padding: 16px 20px;
        background: var(--app-surface);
    }
    .step {
        width: 26px;
        height: 26px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: var(--app-accent-soft);
        color: var(--app-accent);
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .what {
        display: block;
        font-weight: 600;
    }
    .detail {
        display: block;
        font-size: 13px;
        color: var(--fg-subtle);
        margin-top: 2px;
    }
    .subjects {
        margin-bottom: 32px;
    }
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 10px;
    }
    .subject {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        text-align: start;
        font: inherit;
        color: var(--fg);
        background: var(--app-surface);
        border: 1px solid transparent;
        border-radius: var(--app-radius);
        padding: 12px 14px;
        cursor: pointer;
        box-shadow: var(--app-shadow-card);
        transition:
            border-color var(--transition),
            transform var(--transition);
    }
    .subject:hover {
        border-color: var(--app-accent);
        transform: translateY(-1px);
    }
    .subject .label {
        font-family: var(--app-font-display);
        font-weight: 600;
    }
    .subject .hint {
        font-size: 12px;
        color: var(--fg-subtle);
    }
    .downloads-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
    }
    .files {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        background: var(--app-line);
        border-radius: var(--app-radius-large);
        overflow: hidden;
        box-shadow: var(--app-shadow-card);
    }
    .files li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 20px;
        background: var(--app-surface);
    }
    .file-text {
        min-width: 0;
    }
    .name {
        display: block;
        font-family: var(--app-font-display);
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .meta {
        display: block;
        font-size: 12px;
        color: var(--fg-subtle);
        margin-top: 2px;
    }
    .empty {
        color: var(--fg-subtle);
        margin: 0;
    }
    button.primary {
        font: inherit;
        font-weight: 600;
        color: var(--app-accent-fg);
        background: var(--app-accent);
        border: 0;
        border-radius: var(--app-radius);
        padding: 9px 18px;
        cursor: pointer;
    }
    button.primary:hover {
        background: var(--app-accent-hover);
    }
    button.import {
        font: inherit;
        color: var(--fg);
        background: var(--app-surface-sunken);
        border: 1px solid var(--app-line);
        border-radius: var(--app-radius);
        padding: 7px 16px;
        cursor: pointer;
    }
    button.import:hover {
        border-color: var(--app-accent);
        color: var(--app-accent);
    }
    button.link {
        font: inherit;
        font-size: inherit;
        color: var(--fg-link);
        background: transparent;
        border: 0;
        padding: 0;
        cursor: pointer;
        text-decoration: underline;
    }
</style>
