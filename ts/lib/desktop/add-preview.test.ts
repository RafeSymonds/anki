// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { Notetype, Notetype_Config, Notetype_Config_Kind, Notetype_Template } from "@generated/anki/notetypes_pb";
import { describe, expect, it } from "vitest";

import { firstClozeNumber, isBlank, previewPlan } from "./add-preview";

function notetype(id: bigint, kind: Notetype_Config_Kind, templates = 1): Notetype {
    return new Notetype({
        id,
        config: new Notetype_Config({ kind }),
        templates: Array.from({ length: templates }, (_, i) => new Notetype_Template({ name: `Card ${i + 1}` })),
    });
}

describe("add preview", () => {
    it("finds the first cloze number, defaulting to 1", () => {
        expect(firstClozeNumber(["{{c3::a}} and {{c2::b}}", "{{c5::c}}"])).toBe(2);
        expect(firstClozeNumber(["plain"])).toBe(1);
    });

    it("treats markup-only fields as blank", () => {
        expect(isBlank(["<br>", " "])).toBe(true);
        expect(isBlank(["", "x"])).toBe(false);
    });

    it("plans the first card of a basic note and the first blank of a cloze note", () => {
        const basic = notetype(1n, Notetype_Config_Kind.NORMAL, 2);
        const plan = previewPlan({ id: null, notetypeId: 1n, fields: ["Q", "A"] }, basic);
        expect(plan?.ord).toBe(0);
        expect(plan?.template.name).toBe("Card 1");
        expect(plan?.note.fields).toEqual(["Q", "A"]);

        const cloze = notetype(2n, Notetype_Config_Kind.CLOZE);
        const clozePlan = previewPlan({ id: null, notetypeId: 2n, fields: ["{{c2::x}} {{c4::y}}", ""] }, cloze);
        expect(clozePlan?.ord).toBe(1);
    });

    it("has nothing to show for blank fields, a stale note type or no editor", () => {
        const basic = notetype(1n, Notetype_Config_Kind.NORMAL);
        expect(previewPlan({ id: null, notetypeId: 1n, fields: ["", ""] }, basic)).toBeNull();
        expect(previewPlan({ id: null, notetypeId: 9n, fields: ["Q", ""] }, basic)).toBeNull();
        expect(previewPlan(null, basic)).toBeNull();
        expect(previewPlan({ id: null, notetypeId: 1n, fields: ["Q"] }, null)).toBeNull();
    });
});
