/**
 * A harness's own settings, as Settings › Advanced › {Harness} settings
 * shows them (BETA14_RELEASE.md WP-43, Decided 12): read-only, searchable,
 * and grouped so thirty-odd rows read as five short lists. Every value is
 * the harness's own; nothing here is written. Pure, so it is tested without
 * React.
 */

export type ConfigRow = {
  /** The setting's key, as the harness's file names it. */
  key: string;
  /** The key as the row shows it (a plugin's name without its prefix). */
  label: string;
  value: string;
};

export type ConfigGroupId =
  | "model"
  | "plugins"
  | "sources"
  | "look"
  | "everything";

export type ConfigGroup = {
  id: ConfigGroupId;
  title: string;
  rows: ConfigRow[];
};

const TITLES: Record<ConfigGroupId, string> = {
  model: "Model and thinking",
  plugins: "Plugins",
  sources: "Plugin sources",
  look: "Look and feel",
  everything: "Everything else",
};

const ORDER: ConfigGroupId[] = [
  "model",
  "plugins",
  "sources",
  "look",
  "everything",
];

const MODEL =
  /^(model|provider|mode|thinking|effort|alwaysThinking|modelSettings|switchModels|maxOutputTokens|contextLimit|fallbackModel|smallFastModel)/i;
const PLUGINS = /^enabledPlugins(\.|$)/;
const SOURCES =
  /^(extraKnownMarketplaces|pluginMarketplaces|marketplaces)(\.|$)/;
const LOOK =
  /^(theme|statusLine|outputStyle|spinner|editorMode|vim|preferredNotifChannel|notif|showTurnDuration|verbose|includeCoAuthoredBy|tui|colors?)(\.|$|[A-Z])/i;

export function configGroupOf(key: string): ConfigGroupId {
  if (PLUGINS.test(key)) return "plugins";
  if (SOURCES.test(key)) return "sources";
  if (MODEL.test(key)) return "model";
  if (LOOK.test(key)) return "look";
  return "everything";
}

/** A row's words: a plugin is its own name, on or off. */
export function configRowOf(key: string, value: string): ConfigRow {
  if (PLUGINS.test(key) && key.includes(".")) {
    const label = key.slice(key.indexOf(".") + 1);
    const word = value === "true" ? "On" : value === "false" ? "Off" : value;
    return { key, label, value: word };
  }
  return { key, label: key, value };
}

/** Whether a row answers a search: its key, its label or its value. */
export function configRowMatches(row: ConfigRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [row.key, row.label, row.value].some((each) =>
    each.toLowerCase().includes(needle),
  );
}

/** The rows, grouped in order; a group with nothing in it is left out. */
export function groupConfigRows(
  rows: readonly ConfigRow[],
  query = "",
): ConfigGroup[] {
  const groups = new Map<ConfigGroupId, ConfigRow[]>();
  for (const row of rows) {
    if (!configRowMatches(row, query)) continue;
    const id = configGroupOf(row.key);
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  return ORDER.filter((id) => groups.has(id)).map((id) => ({
    id,
    rows: groups.get(id) ?? [],
    title: TITLES[id],
  }));
}
