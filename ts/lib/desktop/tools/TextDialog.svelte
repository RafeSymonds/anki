<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

A report the user reads and dismisses (showText in aqt/utils.py).
-->
<script lang="ts">
    import * as tr from "@generated/ftl";
    import { createEventDispatcher } from "svelte";

    import Modal from "./Modal.svelte";

    export let title: string;
    export let text: string;

    const dispatch = createEventDispatcher<{ close: void }>();
</script>

<Modal {title} width="600px" on:close>
    <pre class="report">{text}</pre>
    <svelte:fragment slot="footer">
        <button class="primary" on:click={() => dispatch("close")}>
            {tr.actionsClose()}
        </button>
    </svelte:fragment>
</Modal>

<style>
    .report {
        margin: 0;
        max-height: 60vh;
        overflow: auto;
        white-space: pre-wrap;
        font: inherit;
    }
</style>
