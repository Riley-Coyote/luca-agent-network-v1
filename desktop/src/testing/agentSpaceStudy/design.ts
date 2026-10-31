/** Design choices only. No agent, permission, or message state is persisted. */
export const AGENT_SPACE_KEY = "ui-design-lab.polyphonic.agent-space.v1";
export type Design = { width: number; compact: boolean; descriptions: boolean };
export const PRESETS: Record<string, Design> = {
  Balanced: { width: 840, compact: false, descriptions: true },
  Focused: { width: 700, compact: false, descriptions: true },
  Compact: { width: 960, compact: true, descriptions: false },
};
export type Saved = {
  id: string;
  name: string;
  created: string;
  schema: 1;
  design: Design;
};
export function normalize(value: unknown): Design {
  const v =
    value && typeof value === "object" ? (value as Partial<Design>) : {};
  return {
    width:
      typeof v.width === "number" && Number.isFinite(v.width)
        ? Math.max(640, Math.min(960, v.width))
        : 840,
    compact: typeof v.compact === "boolean" ? v.compact : false,
    descriptions: typeof v.descriptions === "boolean" ? v.descriptions : true,
  };
}
export function readDesign(): {
  design: Design;
  saved: Saved[];
  error: string;
} {
  try {
    const raw = localStorage.getItem(AGENT_SPACE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    if (
      !data ||
      typeof data !== "object" ||
      (data.schema !== undefined && data.schema !== 1)
    )
      throw new Error("Unsupported saved study");
    const saved = Array.isArray(data.saved) ? data.saved : [];
    if (
      saved.some(
        (v: Saved) =>
          !v ||
          v.schema !== 1 ||
          typeof v.name !== "string" ||
          typeof v.id !== "string",
      )
    )
      throw new Error("Saved variations need recovery");
    return {
      design: normalize(data.design),
      saved: saved.map((v: Saved) => ({ ...v, design: normalize(v.design) })),
      error: "",
    };
  } catch {
    return {
      design: PRESETS.Balanced,
      saved: [],
      error:
        "Saved choices could not be read. They have not been overwritten. You can still explore and export this study.",
    };
  }
}
export function presetName(design: Design) {
  return (
    Object.entries(PRESETS).find(
      ([, v]) => JSON.stringify(v) === JSON.stringify(design),
    )?.[0] ?? "Custom"
  );
}
export function brief(design: Design) {
  return `Polyphonic · Agent spaces · ${presetName(design)}\n\nDesign study, not approved production implementation. Keep the current shell and agent list. Give every agent a consistent header and five destinations: Overview, Companion, Notebook, Identity, Settings. Companion is directly accessible, never buried in Settings.\n\nUse a single reading column with a maximum width of ${design.width}px, ${design.compact ? "compact" : "comfortable"} row spacing, and ${design.descriptions ? "visible supporting descriptions" : "concise rows; explanations inside each editor"}. The width fits the available pane on smaller windows. No permanent metadata aside.\n\nOverview summarizes; controls have one authoritative home. Companion owns observation sources, note keeping, and background initiative, with independent pause controls. Notebook owns notes, journal, and activity. Identity owns authored instructions and identity documents, with ownership labeled. Settings opens focused in-page editors for Model & runtime, Access & tools, Working location, and Advanced. Keep technical controls available behind disclosure, and separate app-wide appearance from agent settings.\n\nPreserve keyboard access, readable focus states, back navigation, and explicit unsaved edits. Actual catalogs and permissions must use existing production authority and consent flows. This preview uses sample data only; changes never reach real agents. Browser glass is a simulation, not native material verification.`;
}
