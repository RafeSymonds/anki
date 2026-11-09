<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<script lang="ts">
    import type { Writable } from "svelte/store";

    import "$lib/sveltelib/export-runtime";

    import Container from "$lib/components/Container.svelte";
    import Row from "$lib/components/Row.svelte";
    import type { DynamicSvelteComponent } from "$lib/sveltelib/dynamicComponent";

    import Addons from "./Addons.svelte";
    import { setContext } from "svelte";

    import { writable } from "svelte/store";

    import AdvancedOptions from "./AdvancedOptions.svelte";
    import { ESSENTIALS_CONTEXT } from "./consequences-context";
    import AudioOptions from "./AudioOptions.svelte";
    import AutoAdvance from "./AutoAdvance.svelte";
    import BuryOptions from "./BuryOptions.svelte";
    import ConfigSelector from "./ConfigSelector.svelte";
    import DisplayOrder from "./DisplayOrder.svelte";
    import FsrsOptionsOuter from "./FsrsOptionsOuter.svelte";
    import HtmlAddon from "./HtmlAddon.svelte";
    import LapseOptions from "./LapseOptions.svelte";
    import type { DeckOptionsState } from "./lib";
    import NewOptions from "./NewOptions.svelte";
    import TimerOptions from "./TimerOptions.svelte";
    import EasyDays from "./EasyDays.svelte";

    export let state: DeckOptionsState;
    const addons = state.addonComponents;

    export function auxData(): Writable<Record<string, unknown>> {
        return state.currentAuxData;
    }

    export function addSvelteAddon(component: DynamicSvelteComponent): void {
        $addons = [...$addons, component];
    }

    export function addHtmlAddon(html: string, mounted: () => void): void {
        $addons = [
            ...$addons,
            {
                component: HtmlAddon,
                html,
                mounted,
            },
        ];
    }

    export const options = {};
    export const newOptions = {};
    export const lapseOptions = {};
    export const buryOptions = {};
    export const displayOrder = {};
    export const timerOptions = {};
    export const audioOptions = {};
    export const advancedOptions = {};
    export const easyDays = {};

    let fsrsOptionsOuterComponent: FsrsOptionsOuter | undefined;

    // Essentials shows the settings most people change (retention); Advanced
    // shows everything. The choice sticks.
    type View = "essentials" | "advanced";
    const viewKey = "deckOptionsView";
    let view: View = "essentials";
    try {
        const stored = localStorage.getItem(viewKey);
        if (stored === "advanced" || stored === "essentials") {
            view = stored;
        }
    } catch {
        // storage unavailable
    }
    function setView(next: View): void {
        view = next;
        try {
            localStorage.setItem(viewKey, next);
        } catch {
            // storage unavailable
        }
    }
    $: advanced = view === "advanced";
    // Sections show one-line consequences and inline help in the Essentials view.
    const essentials = writable(true);
    setContext(ESSENTIALS_CONTEXT, essentials);
    $: essentials.set(!advanced);

    function onPresetChange() {
        if (fsrsOptionsOuterComponent) {
            fsrsOptionsOuterComponent.onPresetChange();
        }
    }
</script>

<ConfigSelector {state} on:presetchange={onPresetChange} />

<div class="view-toggle" role="tablist">
    <button
        role="tab"
        class:active={!advanced}
        aria-selected={!advanced}
        on:click={() => setView("essentials")}
    >
        Essentials
    </button>
    <button
        role="tab"
        class:active={advanced}
        aria-selected={advanced}
        on:click={() => setView("advanced")}
    >
        Advanced
    </button>
</div>

<div class="deck-options-page" class:essentials={!advanced}>
    <Container
        breakpoint="sm"
        --gutter-inline="0.25rem"
        --gutter-block="0.75rem"
        class="container-columns"
    >
        <div>
            {#if advanced}
                <Row class="row-columns">
                    <NewOptions {state} api={newOptions} />
                </Row>

                <Row class="row-columns">
                    <LapseOptions {state} api={lapseOptions} />
                </Row>

                <Row class="row-columns">
                    <DisplayOrder {state} api={displayOrder} />
                </Row>
            {/if}

            <Row class="row-columns">
                <FsrsOptionsOuter
                    {state}
                    api={{}}
                    bind:this={fsrsOptionsOuterComponent}
                />
            </Row>
        </div>

        <div>
            {#if advanced}
                <Row class="row-columns">
                    <BuryOptions {state} api={buryOptions} />
                </Row>

                <Row class="row-columns">
                    <AudioOptions {state} api={audioOptions} />
                </Row>

                <Row class="row-columns">
                    <TimerOptions {state} api={timerOptions} />
                </Row>

                <Row class="row-columns">
                    <AutoAdvance {state} api={timerOptions} />
                </Row>

                {#if $addons.length}
                    <Row class="row-columns">
                        <Addons {state} />
                    </Row>
                {/if}

                <Row class="row-columns">
                    <EasyDays {state} api={easyDays} />
                </Row>

                <Row class="row-columns">
                    <AdvancedOptions {state} api={advancedOptions} />
                </Row>
            {/if}
        </div>
    </Container>
</div>

<style lang="scss">
    @use "$lib/sass/breakpoints" as bp;

    .view-toggle {
        display: flex;
        justify-content: center;
        gap: 4px;
        margin: 0.5rem auto 0.25rem;
        button {
            font: inherit;
            color: var(--fg-subtle);
            background: transparent;
            border: 1px solid transparent;
            border-radius: var(--border-radius);
            padding: 4px 14px;
            cursor: pointer;
            &.active {
                color: var(--fg);
                background: var(--canvas-elevated);
                border-color: var(--border);
            }
        }
    }

    .deck-options-page {
        overflow-x: hidden;
        word-break: break-word;

        :global(.container-columns) {
            display: grid;
            gap: 0px;
        }

        @include bp.with-breakpoint("lg") {
            :global(.container-columns) {
                grid-template-columns: repeat(2, 1fr);
                gap: 20px;
            }
        }
    }
</style>
