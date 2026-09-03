// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { kindOfNotetype, notetypeKindOptions } from "./notetype-kinds";

const names = { basic: "Basic", reversed: "Basic (and reversed card)", cloze: "Cloze" };

describe("note type kinds", () => {
    it("maps the stock note types by name, in picker order", () => {
        const options = notetypeKindOptions(
            [
                { id: 3n, name: "Cloze" },
                { id: 1n, name: "Basic" },
                { id: 9n, name: "My type" },
                { id: 2n, name: "Basic (and reversed card)" },
            ],
            names,
        );
        expect(options.map((o) => [o.kind, o.id, o.label])).toEqual([
            ["basic", 1n, "Basic"],
            ["reversed", 2n, "Both directions"],
            ["cloze", 3n, "Fill in the blank"],
        ]);
    });

    it("leaves out a stock type that was renamed or removed", () => {
        const options = notetypeKindOptions([{ id: 1n, name: "Basic" }], names);
        expect(options.map((o) => o.kind)).toEqual(["basic"]);
    });

    it("tells which option the current note type is", () => {
        const options = notetypeKindOptions([{ id: 1n, name: "Basic" }, { id: 3n, name: "Cloze" }], names);
        expect(kindOfNotetype(options, 3n)).toBe("cloze");
        expect(kindOfNotetype(options, 7n)).toBeNull();
        expect(kindOfNotetype(options, null)).toBeNull();
    });
});
