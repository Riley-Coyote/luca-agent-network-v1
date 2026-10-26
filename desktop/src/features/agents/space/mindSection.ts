/** The three tabs of a mind's space (Decided 2). */
export type MindSection = "notebook" | "self" | "settings";

/** Today's four values read onto the three tabs: place and notebook are the
 *  Notebook; documents is Self; settings is Settings. */
export function mindSectionOf(section: string | null | undefined): MindSection {
  if (section === "settings") return "settings";
  if (section === "self" || section === "documents" || section === "overview")
    return "self";
  return "notebook";
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
