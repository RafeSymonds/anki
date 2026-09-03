// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { UInt32 } from "@generated/anki/generic_pb";
import {
    Notetype,
    Notetype_Config,
    Notetype_Config_Kind,
    Notetype_Field,
    Notetype_Field_Config,
    Notetype_Template,
    Notetype_Template_Config,
} from "@generated/anki/notetypes_pb";
import { FluentBundle, FluentResource, setBundles } from "@generated/ftl";
import { beforeAll, describe, expect, it } from "vitest";

import {
    addField,
    addTemplate,
    browserAppearance,
    cloneNotetypeJson,
    ensureNameUnique,
    fieldReplacementHtml,
    fieldsOnTemplate,
    flipTemplate,
    isSortField,
    newField,
    newTemplate,
    newTemplateName,
    previewTypeAnswer,
    removeField,
    removeFieldError,
    removeTemplate,
    renameField,
    renameTemplate,
    repositionField,
    repositionTemplate,
    setBrowserAppearance,
    setSortField,
    templateMarkdown,
    templateSummary,
    validateFieldName,
} from "./notetypes";

beforeAll(() => {
    const bundle = new FluentBundle("en");
    bundle.addResource(
        new FluentResource(
            [
                "card-templates-card = Card { $val }",
                "card-templates-type-boxes-warning = Only one typing box per card is supported.",
                "notetypes-copy = { $val } copy",
            ].join("\n"),
        ),
    );
    setBundles([bundle]);
});

function field(name: string, ord: number | null, extra: Partial<Notetype_Field_Config> = {}): Notetype_Field {
    return new Notetype_Field({
        name,
        ord: ord === null ? undefined : new UInt32({ val: ord }),
        config: new Notetype_Field_Config({ fontName: "Arial", fontSize: 20, ...extra }),
    });
}

function template(
    name: string,
    ord: number | null,
    qfmt = "{{Front}}",
    afmt = "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
): Notetype_Template {
    return new Notetype_Template({
        name,
        ord: ord === null ? undefined : new UInt32({ val: ord }),
        config: new Notetype_Template_Config({ qFormat: qfmt, aFormat: afmt }),
    });
}

/** A stored Basic notetype: every field and template carries its ordinal. */
function basic(): Notetype {
    return new Notetype({
        id: 1n,
        name: "Basic",
        config: new Notetype_Config({ kind: Notetype_Config_Kind.NORMAL, sortFieldIdx: 0, css: ".card {}" }),
        fields: [field("Front", 0), field("Back", 1)],
        templates: [template("Card 1", 0)],
    });
}

function ords(items: { ord?: UInt32 }[]): (number | null)[] {
    return items.map((i) => i.ord?.val ?? null);
}

describe("validateFieldName", () => {
    it("strips quotes and surrounding space", () => {
        expect(validateFieldName(basic(), " \"Extra\" ")).toEqual({ name: "Extra" });
    });

    it("rejects the names fields.py rejects", () => {
        expect(validateFieldName(basic(), "   ")).toEqual({ error: "empty" });
        expect(validateFieldName(basic(), "#tag")).toEqual({ error: "first-letter" });
        expect(validateFieldName(basic(), "^x")).toEqual({ error: "first-letter" });
        expect(validateFieldName(basic(), "/x")).toEqual({ error: "first-letter" });
        expect(validateFieldName(basic(), "a:b")).toEqual({ error: "invalid-letter" });
        expect(validateFieldName(basic(), "a{b}")).toEqual({ error: "invalid-letter" });
        expect(validateFieldName(basic(), "front")).toEqual({ error: "duplicate" });
    });

    it("treats a case-only change of the current name as unchanged", () => {
        expect(validateFieldName(basic(), "FRONT", "Front")).toEqual({ error: "unchanged" });
        expect(validateFieldName(basic(), "Question", "Front")).toEqual({ name: "Question" });
    });
});

describe("fields", () => {
    it("adds a field without an ordinal and with the stock defaults", () => {
        const nt = basic();
        const added = newField("Extra");
        addField(nt, added);
        expect(nt.fields.map((f) => f.name)).toEqual(["Front", "Back", "Extra"]);
        expect(ords(nt.fields)).toEqual([0, 1, null]);
        expect(added.config?.fontName).toBe("Arial");
        expect(added.config?.fontSize).toBe(20);
        expect(added.config?.sticky).toBe(false);
        expect(typeof added.config?.id).toBe("bigint");
    });

    it("keeps ordinals when reordering so rslib can move the note contents", () => {
        const nt = basic();
        addField(nt, newField("Extra"));
        repositionField(nt, 2, 0);
        expect(nt.fields.map((f) => f.name)).toEqual(["Extra", "Front", "Back"]);
        expect(ords(nt.fields)).toEqual([null, 0, 1]);
        repositionField(nt, 1, 1);
        expect(nt.fields.map((f) => f.name)).toEqual(["Extra", "Front", "Back"]);
        repositionField(nt, 0, 5);
        expect(nt.fields.map((f) => f.name)).toEqual(["Extra", "Front", "Back"]);
    });

    it("renames in place, leaving the ordinal for the template rename on save", () => {
        const nt = basic();
        renameField(nt, 0, "Question");
        expect(nt.fields[0].name).toBe("Question");
        expect(nt.fields[0].ord?.val).toBe(0);
        expect(() => renameField(nt, 7, "x")).toThrow();
    });

    it("refuses to remove the last field or a required one", () => {
        const nt = basic();
        nt.fields[1].config!.preventDeletion = true;
        expect(removeFieldError(nt, 1)).toBe("required");
        expect(removeFieldError(nt, 0)).toBeNull();
        removeField(nt, 0);
        expect(nt.fields.map((f) => f.name)).toEqual(["Back"]);
        expect(removeFieldError(nt, 0)).toBe("last-field");
        expect(() => removeField(nt, 0)).toThrow();
    });

    it("tracks the sort field by ordinal", () => {
        const nt = basic();
        expect(isSortField(nt, 0)).toBe(true);
        expect(isSortField(nt, 1)).toBe(false);
        setSortField(nt, 1);
        expect(nt.config?.sortFieldIdx).toBe(1);
        repositionField(nt, 1, 0);
        // Back moved to the top but is still the sort field.
        expect(isSortField(nt, 0)).toBe(true);
        expect(isSortField(nt, 1)).toBe(false);
        expect(() => setSortField(nt, 2)).toThrow();
    });
});

describe("templates", () => {
    it("names new card types after the first free number", () => {
        const nt = basic();
        expect(newTemplateName(nt)).toBe("Card 2");
        // Counting starts at the template count + 1, as in clayout.py.
        addTemplate(nt, newTemplate("Card 2"));
        addTemplate(nt, newTemplate("Card 4"));
        expect(newTemplateName(nt)).toBe("Card 5");
        addTemplate(nt, newTemplate("Card 5"));
        expect(newTemplateName(nt)).toBe("Card 6");
    });

    it("adds, reorders and removes without touching ordinals", () => {
        const nt = basic();
        const added = newTemplate("Card 2", "{{Back}}", "{{FrontSide}}<hr id=answer>{{Front}}");
        addTemplate(nt, added);
        expect(ords(nt.templates)).toEqual([0, null]);
        expect(added.config?.qFormat).toBe("{{Back}}");
        repositionTemplate(nt, 1, 0);
        expect(nt.templates.map((t) => t.name)).toEqual(["Card 2", "Card 1"]);
        expect(ords(nt.templates)).toEqual([null, 0]);
        removeTemplate(nt, 0);
        expect(nt.templates.map((t) => t.name)).toEqual(["Card 1"]);
        expect(() => removeTemplate(nt, 0)).toThrow();
    });

    it("renames after stripping quotes and ignores blank names", () => {
        const nt = basic();
        expect(renameTemplate(nt, 0, " \"Recall\" ")).toBe(true);
        expect(nt.templates[0].name).toBe(" Recall ");
        expect(renameTemplate(nt, 0, "\"\"")).toBe(false);
        expect(nt.templates[0].name).toBe(" Recall ");
    });

    it("flips a template around the answer separator", () => {
        const t = template("Card 1", 0, "{{Front}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}");
        expect(flipTemplate(t)).toBe(true);
        expect(t.config?.qFormat).toBe("{{Back}}");
        expect(t.config?.aFormat).toBe("{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}");
        const noHr = template("Card 1", 0, "{{Front}}", "{{Back}}");
        expect(flipTemplate(noHr)).toBe(false);
        expect(noHr.config?.qFormat).toBe("{{Front}}");
    });

    it("summarises the fields on a template", () => {
        expect(fieldsOnTemplate("{{Front}} <!-- {{Hidden}} --> {{#Back}}{{text:Back}}{{/Back}} {{FrontSide}}")).toBe(
            "Front+Back",
        );
        expect(fieldsOnTemplate("{{AVeryLongFieldNameNumberOne}} {{AnotherLongFieldName}} {{Third}}")).toBe(
            "AVeryLongFieldNameNumberOne+AnotherLongFieldName+...",
        );
        expect(templateSummary(0, template("Card 1", 0))).toBe("1: Card 1: Front -> Back");
    });

    it("builds the field markup and the markdown copy", () => {
        expect(fieldReplacementHtml("Back", "Arial", 20)).toBe(
            "\n<div style='font-family: \"Arial\"; font-size: 20px;'>{{Back}}</div>\n",
        );
        const md = templateMarkdown(template("Card 1", 0, "```{{Front}}", "{{Back}}"), ".card {}");
        expect(md).toBe(
            "## Front Template\n```html\n\\`\\`\\`{{Front}}\n```\n## Back Template\n```html\n{{Back}}\n```\n## Styling\n```css\n.card {}\n```\n",
        );
    });

    it("round-trips the browser appearance", () => {
        const t = template("Card 1", 0);
        expect(browserAppearance(t)).toEqual({ qfmt: "", afmt: "", font: null });
        setBrowserAppearance(t, { qfmt: " {{Front}} ", afmt: "{{Back}}", font: { name: "Times", size: 14 } });
        expect(t.config).toMatchObject({
            qFormatBrowser: "{{Front}}",
            aFormatBrowser: "{{Back}}",
            browserFontName: "Times",
            browserFontSize: 14,
        });
        expect(browserAppearance(t).font).toEqual({ name: "Times", size: 14 });
        setBrowserAppearance(t, { qfmt: "", afmt: "", font: null });
        expect(t.config).toMatchObject({ browserFontName: "", browserFontSize: 0 });
    });
});

describe("notetype names", () => {
    it("suffixes a name another notetype already uses", () => {
        const existing = [
            { id: 1n, name: "Basic" },
            { id: 2n, name: "Cloze" },
        ];
        expect(ensureNameUnique("Basic", existing, 1n)).toBe("Basic");
        expect(ensureNameUnique("Other", existing, 0n)).toBe("Other");
        expect(ensureNameUnique("Basic", existing, 0n)).toMatch(/^Basic-[0-9a-f]{5}$/);
    });

    it("clones the legacy form under a new name without ids", () => {
        const cloned = cloneNotetypeJson({ id: 1234, name: "Basic", originalId: 77, flds: [{ name: "Front" }] });
        expect(cloned).toMatchObject({ id: 0, name: "Basic copy", originalId: null });
        expect(cloned.flds).toEqual([{ name: "Front" }]);
    });
});

describe("previewTypeAnswer", () => {
    it("leaves cards without a type box alone", () => {
        expect(previewTypeAnswer("{{Front}}", "question", "cmp")).toBe("{{Front}}");
    });

    it("shows a read-only sample box on the front and the comparison on the back", () => {
        expect(previewTypeAnswer("Q [[type:Back]]", "question", "cmp")).toBe(
            "Q <center><input id='typeans' type=text value='example' readonly='readonly'></center>",
        );
        expect(previewTypeAnswer("Q<hr id=answer>[[type:Back]]", "answer", "<cmp>")).toBe("Q<hr id=answer><cmp>");
        expect(previewTypeAnswer("Q [[type:Back]]", "answer", "<cmp>")).toBe("Q <cmp>");
    });

    it("warns about additional type boxes", () => {
        expect(previewTypeAnswer("[[type:A]] [[type:B]]", "answer", "c")).toBe(
            "c <center><b>Only one typing box per card is supported.</b></center>",
        );
    });
});
