// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Search text handling for the browser (history, id searches, how sidebar
 * clicks combine with the current search) and the sidebar tree itself: the
 * sections of qt/aqt/browser/sidebar/tree.py with the SearchNode each item
 * stands for.
 */

import type { DeckTreeNode } from "@generated/anki/decks_pb";
import type { NotetypeNameId } from "@generated/anki/notetypes_pb";
import {
    SearchNode,
    SearchNode_CardState,
    SearchNode_Flag,
    SearchNode_Group,
    SearchNode_Group_Joiner,
    SearchNode_Rated,
    SearchNode_Rating,
} from "@generated/anki/search_pb";
import type { TagTreeNode } from "@generated/anki/tags_pb";
import * as tr from "@generated/ftl";

/** Profile setting holding the recent searches, as in the Qt profile. */
export const SEARCH_HISTORY_KEY = "searchHistory";
export const SEARCH_HISTORY_LIMIT = 30;

/** `Browser.update_history`: most recent first, no duplicates, capped. */
export function pushSearchHistory(history: readonly string[], search: string): string[] {
    const rest = history.filter((s) => s !== search);
    return [search, ...rest].slice(0, SEARCH_HISTORY_LIMIT);
}

/** `Browser.current_search`: newlines and tabs become spaces. */
export function normaliseSearchText(text: string): string {
    return text.replace(/\s/g, " ");
}

/** "nid:1,2,3" / "cid:1,2,3"; an empty list matches nothing. */
export function idSearch(kind: "nid" | "cid", ids: Iterable<bigint>): string {
    const list = [...ids];
    if (list.length === 0) {
        return `${kind}:0`;
    }
    return `${kind}:${list.map((id) => id.toString()).join(",")}`;
}

export type SidebarJoin = "replace" | "and" | "or" | "replaceNode";

export interface SidebarModifiers {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
}

/** How a sidebar click combines with the current search (`SidebarTreeView.update_search`). */
export function sidebarJoin(mods: SidebarModifiers): SidebarJoin {
    if (mods.ctrl && mods.shift) {
        return "replaceNode";
    }
    if (mods.ctrl) {
        return "and";
    }
    if (mods.shift) {
        return "or";
    }
    return "replace";
}

export function negated(node: SearchNode): SearchNode {
    return new SearchNode({ filter: { case: "negated", value: node } });
}

export function groupNodes(nodes: SearchNode[], joiner = SearchNode_Group_Joiner.AND): SearchNode {
    if (nodes.length === 1) {
        return nodes[0];
    }
    return new SearchNode({ filter: { case: "group", value: new SearchNode_Group({ nodes, joiner }) } });
}

export function deckNode(name: string): SearchNode {
    return new SearchNode({ filter: { case: "deck", value: name } });
}

export function tagNode(name: string): SearchNode {
    return new SearchNode({ filter: { case: "tag", value: name } });
}

export function notetypeNode(name: string): SearchNode {
    return new SearchNode({ filter: { case: "note", value: name } });
}

export function flagNode(flag: SearchNode_Flag): SearchNode {
    return new SearchNode({ filter: { case: "flag", value: flag } });
}

export function cardStateNode(state: SearchNode_CardState): SearchNode {
    return new SearchNode({ filter: { case: "cardState", value: state } });
}

export function textNode(text: string): SearchNode {
    return new SearchNode({ filter: { case: "parsableText", value: text } });
}

export function noteIdsNode(ids: bigint[]): SearchNode {
    return new SearchNode({ filter: { case: "nids", value: { ids } } });
}

export type SidebarKind =
    | "section"
    | "today"
    | "state"
    | "flag"
    | "deck"
    | "tag"
    | "notetype";

export interface SidebarItem {
    /** Unique within the tree, e.g. "deck:12", "tag:a::b", "today:due". */
    id: string;
    name: string;
    kind: SidebarKind;
    /** The search the item stands for; null for headers without one. */
    node: SearchNode | null;
    children: SidebarItem[];
    /** A theme variable for the coloured dot beside card states and flags. */
    color?: string;
    /** Deck id for deck items, notetype id for notetypes. */
    refId?: bigint;
}

function item(
    id: string,
    name: string,
    kind: SidebarKind,
    node: SearchNode | null,
    extra: Partial<SidebarItem> = {},
): SidebarItem {
    return { id, name, kind, node, children: [], ...extra };
}

/** `_today_tree` */
export function todaySection(): SidebarItem {
    const rated = (rating: SearchNode_Rating): SearchNode =>
        new SearchNode({ filter: { case: "rated", value: new SearchNode_Rated({ days: 1, rating }) } });
    return item("today", tr.browsingToday(), "section", null, {
        children: [
            item(
                "today:due",
                tr.browsingSidebarDueToday(),
                "today",
                new SearchNode({ filter: { case: "dueOnDay", value: 0 } }),
            ),
            item(
                "today:added",
                tr.browsingAddedToday(),
                "today",
                new SearchNode({ filter: { case: "addedInDays", value: 1 } }),
            ),
            item(
                "today:edited",
                tr.browsingEditedToday(),
                "today",
                new SearchNode({ filter: { case: "editedInDays", value: 1 } }),
            ),
            item("today:studied", tr.browsingStudiedToday(), "today", rated(SearchNode_Rating.ANY)),
            item(
                "today:introduced",
                tr.browsingSidebarFirstReview(),
                "today",
                new SearchNode({ filter: { case: "introducedInDays", value: 1 } }),
            ),
            item(
                "today:rescheduled",
                tr.browsingSidebarRescheduled(),
                "today",
                rated(SearchNode_Rating.BY_RESCHEDULE),
            ),
            item("today:again", tr.browsingAgainToday(), "today", rated(SearchNode_Rating.AGAIN)),
            item(
                "today:overdue",
                tr.browsingSidebarOverdue(),
                "today",
                groupNodes([
                    cardStateNode(SearchNode_CardState.DUE),
                    negated(new SearchNode({ filter: { case: "dueOnDay", value: 0 } })),
                ]),
            ),
        ],
    });
}

/** `_card_state_tree` */
export function cardStateSection(): SidebarItem {
    return item("state", tr.browsingSidebarCardState(), "section", null, {
        children: [
            item("state:new", tr.actionsNew(), "state", cardStateNode(SearchNode_CardState.NEW), {
                color: "--state-new",
            }),
            item("state:learn", tr.schedulingLearning(), "state", cardStateNode(SearchNode_CardState.LEARN), {
                color: "--state-learn",
            }),
            item(
                "state:review",
                tr.browsingSidebarCardStateReview(),
                "state",
                cardStateNode(SearchNode_CardState.REVIEW),
                { color: "--state-review" },
            ),
            item(
                "state:suspended",
                tr.browsingSuspended(),
                "state",
                cardStateNode(SearchNode_CardState.SUSPENDED),
                { color: "--state-suspended" },
            ),
            item("state:buried", tr.browsingBuried(), "state", cardStateNode(SearchNode_CardState.BURIED), {
                color: "--state-buried",
            }),
        ],
    });
}

export const FLAG_LABELS: (() => string)[] = [
    tr.actionsFlagRed,
    tr.actionsFlagOrange,
    tr.actionsFlagGreen,
    tr.actionsFlagBlue,
    tr.actionsFlagPink,
    tr.actionsFlagTurquoise,
    tr.actionsFlagPurple,
];

const FLAG_NODES = [
    SearchNode_Flag.RED,
    SearchNode_Flag.ORANGE,
    SearchNode_Flag.GREEN,
    SearchNode_Flag.BLUE,
    SearchNode_Flag.PINK,
    SearchNode_Flag.TURQUOISE,
    SearchNode_Flag.PURPLE,
];

/** `_flags_tree` */
export function flagsSection(): SidebarItem {
    return item("flags", tr.browsingSidebarFlags(), "section", flagNode(SearchNode_Flag.ANY), {
        children: [
            item("flag:0", tr.browsingNoFlag(), "flag", flagNode(SearchNode_Flag.NONE)),
            ...FLAG_LABELS.map((label, i) =>
                item(`flag:${i + 1}`, label(), "flag", flagNode(FLAG_NODES[i]), {
                    color: `--flag-${i + 1}`,
                    refId: BigInt(i + 1),
                })
            ),
        ],
    });
}

/** `_deck_tree`: names are built up from the leaf names the tree carries. */
export function decksSection(tree: DeckTreeNode): SidebarItem {
    const render = (nodes: DeckTreeNode[], head: string): SidebarItem[] =>
        nodes.map((node) => {
            const full = head + node.name;
            return item(`deck:${node.deckId}`, node.name, "deck", deckNode(full), {
                refId: node.deckId,
                children: render(node.children, `${full}::`),
            });
        });
    return item("decks", tr.browsingSidebarDecks(), "section", deckNode("_*"), {
        children: [
            item("deck:current", tr.browsingCurrentDeck(), "deck", deckNode("current")),
            ...render(tree.children, ""),
        ],
    });
}

/** `_tag_tree` */
export function tagsSection(tree: TagTreeNode): SidebarItem {
    const render = (nodes: TagTreeNode[], head: string): SidebarItem[] =>
        nodes.map((node) => {
            const full = head + node.name;
            return item(`tag:${full}`, node.name, "tag", tagNode(full), {
                children: render(node.children, `${full}::`),
            });
        });
    return item("tags", tr.browsingSidebarTags(), "section", tagNode("_*"), {
        children: [
            item("tag:", tr.browsingSidebarUntagged(), "tag", negated(tagNode("_*"))),
            ...render(tree.children, ""),
        ],
    });
}

/** `_notetype_tree`, without the per-template and per-field children. */
export function notetypesSection(names: readonly NotetypeNameId[]): SidebarItem {
    const sorted = [...names].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return item("notetypes", tr.browsingSidebarNotetypes(), "section", notetypeNode("_*"), {
        children: sorted.map((nt) =>
            item(`notetype:${nt.id}`, nt.name, "notetype", notetypeNode(nt.name), { refId: nt.id })
        ),
    });
}

export interface SidebarInput {
    deckTree: DeckTreeNode;
    tagTree: TagTreeNode;
    notetypes: readonly NotetypeNameId[];
}

/** The sections in the order the Qt sidebar shows them (minus saved searches). */
export function buildSidebar(input: SidebarInput): SidebarItem[] {
    return [
        todaySection(),
        cardStateSection(),
        flagsSection(),
        decksSection(input.deckTree),
        notetypesSection(input.notetypes),
        tagsSection(input.tagTree),
    ];
}

export interface SidebarRow {
    item: SidebarItem;
    level: number;
    expanded: boolean;
}

/** Rows in display order; children of collapsed items are left out. */
export function flattenSidebar(items: readonly SidebarItem[], collapsed: ReadonlySet<string>): SidebarRow[] {
    const rows: SidebarRow[] = [];
    const visit = (item: SidebarItem, level: number): void => {
        const expanded = !collapsed.has(item.id);
        rows.push({ item, level, expanded });
        if (expanded) {
            for (const child of item.children) {
                visit(child, level + 1);
            }
        }
    };
    for (const item of items) {
        visit(item, 0);
    }
    return rows;
}

/** Items whose name matches the sidebar filter, with their ancestors. */
export function filterSidebar(items: readonly SidebarItem[], filter: string): SidebarItem[] {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
        return [...items];
    }
    const prune = (item: SidebarItem): SidebarItem | null => {
        const children = item.children.map(prune).filter((c): c is SidebarItem => c !== null);
        if (children.length || item.name.toLowerCase().includes(needle)) {
            return { ...item, children };
        }
        return null;
    };
    return items.map(prune).filter((i): i is SidebarItem => i !== null);
}
