// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { DeckTreeNode } from "@generated/anki/decks_pb";
import { NotetypeNameId } from "@generated/anki/notetypes_pb";
import { SearchNode_CardState, SearchNode_Flag, SearchNode_Group_Joiner } from "@generated/anki/search_pb";
import { TagTreeNode } from "@generated/anki/tags_pb";
import { describe, expect, it } from "vitest";

import {
    buildSidebar,
    cardStateSection,
    decksSection,
    filterSidebar,
    flagsSection,
    flattenSidebar,
    idSearch,
    normaliseSearchText,
    notetypesSection,
    pushSearchHistory,
    SEARCH_HISTORY_LIMIT,
    sidebarJoin,
    tagsSection,
    todaySection,
} from "./search";

describe("search history", () => {
    it("moves the newest search to the front without duplicates", () => {
        expect(pushSearchHistory(["a", "b"], "c")).toEqual(["c", "a", "b"]);
        expect(pushSearchHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    });

    it("keeps at most the limit", () => {
        const history = Array.from({ length: SEARCH_HISTORY_LIMIT }, (_, i) => `s${i}`);
        const next = pushSearchHistory(history, "new");
        expect(next).toHaveLength(SEARCH_HISTORY_LIMIT);
        expect(next[0]).toBe("new");
        expect(next.at(-1)).toBe(`s${SEARCH_HISTORY_LIMIT - 2}`);
    });

    it("normalises whitespace like the Qt search box", () => {
        expect(normaliseSearchText("deck:a\n\ttag:b")).toBe("deck:a  tag:b");
    });
});

describe("idSearch", () => {
    it("joins ids and never matches for an empty list", () => {
        expect(idSearch("nid", [1n, 22n])).toBe("nid:1,22");
        expect(idSearch("cid", [])).toBe("cid:0");
    });
});

describe("sidebarJoin", () => {
    it("follows the Qt modifier rules", () => {
        expect(sidebarJoin({})).toBe("replace");
        expect(sidebarJoin({ ctrl: true })).toBe("and");
        expect(sidebarJoin({ shift: true })).toBe("or");
        expect(sidebarJoin({ ctrl: true, shift: true })).toBe("replaceNode");
        expect(sidebarJoin({ alt: true })).toBe("replace");
    });
});

describe("sidebar sections", () => {
    it("today lists the same searches as the Qt sidebar", () => {
        const today = todaySection();
        expect(today.children.map((c) => c.id)).toEqual([
            "today:due",
            "today:added",
            "today:edited",
            "today:studied",
            "today:introduced",
            "today:rescheduled",
            "today:again",
            "today:overdue",
        ]);
        expect(today.children[0].node?.filter).toEqual({ case: "dueOnDay", value: 0 });
        expect(today.children[1].node?.filter).toEqual({ case: "addedInDays", value: 1 });
        const overdue = today.children[7].node!.filter;
        expect(overdue.case).toBe("group");
        if (overdue.case === "group") {
            expect(overdue.value.joiner).toBe(SearchNode_Group_Joiner.AND);
            expect(overdue.value.nodes[0].filter).toEqual({ case: "cardState", value: SearchNode_CardState.DUE });
            expect(overdue.value.nodes[1].filter.case).toBe("negated");
        }
    });

    it("card states carry their theme colour", () => {
        const states = cardStateSection();
        expect(states.children.map((c) => c.color)).toEqual([
            "--state-new",
            "--state-learn",
            "--state-review",
            "--state-suspended",
            "--state-buried",
        ]);
        expect(states.children[3].node?.filter).toEqual({
            case: "cardState",
            value: SearchNode_CardState.SUSPENDED,
        });
    });

    it("flags include no-flag and the seven colours", () => {
        const flags = flagsSection();
        expect(flags.node?.filter).toEqual({ case: "flag", value: SearchNode_Flag.ANY });
        expect(flags.children).toHaveLength(8);
        expect(flags.children[0].node?.filter).toEqual({ case: "flag", value: SearchNode_Flag.NONE });
        expect(flags.children[3]).toMatchObject({ id: "flag:3", color: "--flag-3", refId: 3n });
        expect(flags.children[3].node?.filter).toEqual({ case: "flag", value: SearchNode_Flag.GREEN });
    });

    it("decks build full names from the leaf names in the tree", () => {
        const tree = new DeckTreeNode({
            children: [
                new DeckTreeNode({
                    deckId: 10n,
                    name: "Japanese",
                    children: [new DeckTreeNode({ deckId: 11n, name: "Vocab" })],
                }),
            ],
        });
        const decks = decksSection(tree);
        expect(decks.children[0].id).toBe("deck:current");
        expect(decks.children[0].node?.filter).toEqual({ case: "deck", value: "current" });
        const japanese = decks.children[1];
        expect(japanese).toMatchObject({ id: "deck:10", name: "Japanese", refId: 10n });
        expect(japanese.node?.filter).toEqual({ case: "deck", value: "Japanese" });
        expect(japanese.children[0].node?.filter).toEqual({ case: "deck", value: "Japanese::Vocab" });
    });

    it("tags nest with :: and start with untagged", () => {
        const tree = new TagTreeNode({
            children: [new TagTreeNode({ name: "a", children: [new TagTreeNode({ name: "b" })] })],
        });
        const tags = tagsSection(tree);
        expect(tags.children[0].id).toBe("tag:");
        expect(tags.children[0].node?.filter.case).toBe("negated");
        expect(tags.children[1].node?.filter).toEqual({ case: "tag", value: "a" });
        expect(tags.children[1].children[0].node?.filter).toEqual({ case: "tag", value: "a::b" });
    });

    it("notetypes are sorted case-insensitively", () => {
        const section = notetypesSection([
            new NotetypeNameId({ id: 2n, name: "cloze" }),
            new NotetypeNameId({ id: 1n, name: "Basic" }),
        ]);
        expect(section.children.map((c) => c.name)).toEqual(["Basic", "cloze"]);
        expect(section.children[0].node?.filter).toEqual({ case: "note", value: "Basic" });
        expect(section.children[0].refId).toBe(1n);
    });

    it("buildSidebar orders the sections like Qt", () => {
        const sections = buildSidebar({
            deckTree: new DeckTreeNode(),
            tagTree: new TagTreeNode(),
            notetypes: [],
        });
        expect(sections.map((s) => s.id)).toEqual(["today", "state", "flags", "decks", "notetypes", "tags"]);
    });
});

describe("flattenSidebar and filterSidebar", () => {
    it("omits the children of collapsed items", () => {
        const rows = flattenSidebar([flagsSection(), cardStateSection()], new Set(["flags"]));
        expect(rows[0]).toMatchObject({ level: 0, expanded: false });
        expect(rows[1].item.id).toBe("state");
        expect(rows[2]).toMatchObject({ level: 1, expanded: true });
        expect(rows).toHaveLength(2 + 5);
    });

    it("keeps matching items with their ancestors", () => {
        const tree = new TagTreeNode({
            children: [
                new TagTreeNode({ name: "lang", children: [new TagTreeNode({ name: "jp" })] }),
                new TagTreeNode({ name: "other" }),
            ],
        });
        const filtered = filterSidebar([tagsSection(tree)], "JP");
        expect(filtered).toHaveLength(1);
        expect(filtered[0].children.map((c) => c.name)).toEqual(["lang"]);
        expect(filtered[0].children[0].children.map((c) => c.name)).toEqual(["jp"]);
        expect(filterSidebar([tagsSection(tree)], "zzz")).toEqual([]);
        expect(filterSidebar([tagsSection(tree)], " ")).toHaveLength(1);
    });
});
