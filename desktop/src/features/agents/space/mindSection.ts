/**
 * Where you are with a mind (BETA14_RELEASE.md WP-43, Decided 1–3): their
 * page, or a page that slid in over it, in the agents route's `page` word.
 * Pure, so the address's words are tested without React.
 *
 *   (none)                  their page
 *   notebook/pages          their page, its Notebook open on Pages
 *   settings                Settings
 *   settings/<pane>         one of Settings' panes
 *   settings/files/<path>   a file in their folder, from Files
 *   made                    everything they made
 *   made/<artifactId>       a piece, from Made
 *   piece/<artifactId>      a piece, from their page
 *   page/<kind>             a page they write, from Notebook
 */

/** Settings' panes, each a page of its own (Decided 11, 12). */
export const MIND_PANES = [
  "soul",
  "convictions",
  "instructions",
  "words",
  "keeps",
  "permissions",
  "harness",
  "works",
  "read",
  "config",
  "files",
  "identity",
] as const;

export type MindPane = (typeof MIND_PANES)[number];

/** The pages they write, read from Notebook › Pages. */
export const MIND_READING_KINDS = [
  "selfModel",
  "userModel",
  "lessons",
] as const;

export type MindReadingKind = (typeof MIND_READING_KINDS)[number];

export type MindPage =
  | { kind: "place"; notebook?: "pages" }
  | { kind: "settings" }
  | { kind: "pane"; pane: MindPane }
  | { kind: "file"; relPath: string }
  | { kind: "made" }
  | { kind: "piece"; artifactId: string; from: "made" | "place" }
  | { kind: "reading"; doc: MindReadingKind };

const isPane = (value: string): value is MindPane =>
  (MIND_PANES as readonly string[]).includes(value);

const isReading = (value: string): value is MindReadingKind =>
  (MIND_READING_KINDS as readonly string[]).includes(value);

/** The address's `page` word, read; anything it can't name is their page. */
export function parseMindPage(value: unknown): MindPage {
  if (typeof value !== "string" || value.length === 0) return { kind: "place" };
  if (value === "notebook/pages") return { kind: "place", notebook: "pages" };
  if (value === "settings") return { kind: "settings" };
  if (value === "made") return { kind: "made" };
  const slash = value.indexOf("/");
  if (slash < 0) return { kind: "place" };
  const head = value.slice(0, slash);
  const rest = value.slice(slash + 1);
  if (head === "settings") {
    if (rest.startsWith("files/") && rest.length > "files/".length)
      return { kind: "file", relPath: rest.slice("files/".length) };
    return isPane(rest) ? { kind: "pane", pane: rest } : { kind: "settings" };
  }
  if ((head === "made" || head === "piece") && rest)
    return {
      kind: "piece",
      artifactId: rest,
      from: head === "made" ? "made" : "place",
    };
  if (head === "page" && isReading(rest)) return { kind: "reading", doc: rest };
  return { kind: "place" };
}

/** A page as the address writes it; their page is no word at all. */
export function mindPageWord(page: MindPage): string | null {
  switch (page.kind) {
    case "place":
      return page.notebook === "pages" ? "notebook/pages" : null;
    case "settings":
      return "settings";
    case "pane":
      return `settings/${page.pane}`;
    case "file":
      return `settings/files/${page.relPath}`;
    case "made":
      return "made";
    case "piece":
      return `${page.from === "made" ? "made" : "piece"}/${page.artifactId}`;
    case "reading":
      return `page/${page.doc}`;
  }
}

/** Where a page's back link goes: the page it slid in over. */
export function mindPageParent(page: MindPage): MindPage | null {
  switch (page.kind) {
    case "place":
      return null;
    case "settings":
    case "made":
    case "reading":
      return { kind: "place" };
    case "pane":
      return { kind: "settings" };
    case "file":
      return { kind: "pane", pane: "files" };
    case "piece":
      return page.from === "made" ? { kind: "made" } : { kind: "place" };
  }
}

/** The back link's words: where you came from ("‹ Luca", "‹ Settings"). */
export function mindBackLabel(page: MindPage, name: string): string | null {
  const parent = mindPageParent(page);
  if (!parent) return null;
  if (parent.kind === "settings") return "Settings";
  if (parent.kind === "made") return "Made";
  if (parent.kind === "pane") return "Files";
  return name;
}

/** How deep a page sits: their page 0, Settings 1, a pane 2, a file 3. */
export function mindPageDepth(page: MindPage): number {
  let depth = 0;
  let at = mindPageParent(page);
  while (at) {
    depth += 1;
    at = mindPageParent(at);
  }
  return depth;
}

/** The rows of a mind's Settings a way in may name (WP-26, Decided 4). */
export type MindSettingsAt = "read" | "runtime" | "permissions";

export function parseMindSettingsAt(
  value: unknown,
): MindSettingsAt | undefined {
  return value === "read" || value === "runtime" || value === "permissions"
    ? value
    : undefined;
}

/** Settings > Agents' old detail tabs, still sent by ways in (an agent asking
 *  to show its runtime or its access), read onto the row that now holds them. */
export function mindSettingsAtOfTab(
  tab: string | null | undefined,
): MindSettingsAt | undefined {
  if (tab === "runtime") return "runtime";
  if (tab === "capabilities") return "permissions";
  return undefined;
}

const PANE_OF_AT: Record<MindSettingsAt, MindPane> = {
  permissions: "permissions",
  read: "read",
  runtime: "harness",
};

/**
 * Every old way in, landed on its new home (Decided 3): `at` names a pane;
 * the old `section` and `profileTab` words name Settings, Notebook's Pages
 * or their page. Null when the address holds none of them.
 */
export function mindPageOfLegacy(search: {
  at?: string | null;
  profileTab?: string | null;
  section?: string | null;
}): MindPage | null {
  const at =
    parseMindSettingsAt(search.at) ?? mindSettingsAtOfTab(search.profileTab);
  if (at) return { kind: "pane", pane: PANE_OF_AT[at] };
  const section = search.section;
  if (section === "settings") return { kind: "settings" };
  if (section === "self" || section === "documents" || section === "overview")
    return { kind: "place", notebook: "pages" };
  if (section === "notebook" || section === "place") return { kind: "place" };
  const tab = search.profileTab;
  if (tab === "continuity" || tab === "memories" || tab === "info")
    return { kind: "place" };
  return null;
}
