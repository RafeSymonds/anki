// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { getContext } from "svelte";
import { type Readable, readable } from "svelte/store";

/** A store that is true while the page shows the Essentials view. */
export const ESSENTIALS_CONTEXT = Symbol("deck-options-essentials");

export function essentialsContext(): Readable<boolean> {
    return getContext<Readable<boolean> | undefined>(ESSENTIALS_CONTEXT) ?? readable(false);
}
