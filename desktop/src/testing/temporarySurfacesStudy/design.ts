/** Lab-only settings. Never stores approvals or production application state. */
export const TEMPORARY_SURFACES_KEY =
  "ui-design-lab.polyphonic.temporary-surfaces.v2";
/** What a card is made of: Graphite, a warm plate that catches the light; or
 *  Ink, black seen only where the light from above touches it. */
export type Material = "graphite" | "ink";
export const MATERIALS: { id: Material; name: string }[] = [
  { id: "ink", name: "Ink" },
  { id: "graphite", name: "Graphite" },
];
export type Design = {
  inset: number;
  shade: number;
  compact: boolean;
  opaque: boolean;
  motion: boolean;
  material: Material;
  /** The signal blue as light on asks: the one thing you can act on. */
  signal: boolean;
  /** The edge's thickness: a lit lip inside the top, a dark seam outside. */
  depth: boolean;
};
export const PRESETS: Record<string, Design> = {
  "Quiet card": {
    inset: 24,
    shade: 20,
    compact: false,
    opaque: false,
    motion: true,
    material: "ink",
    signal: false,
    depth: true,
  },
  "Inset card": {
    inset: 44,
    shade: 20,
    compact: false,
    opaque: false,
    motion: true,
    material: "ink",
    signal: false,
    depth: true,
  },
  "Compact card": {
    inset: 24,
    shade: 18,
    compact: true,
    opaque: false,
    motion: true,
    material: "ink",
    signal: false,
    depth: true,
  },
};
export type Saved = {
  id: string;
  name: string;
  created: string;
  schema: 2;
  design: Design;
};
export function normalize(value: unknown): Design {
  const v =
    value && typeof value === "object" ? (value as Partial<Design>) : {};
  const bounded = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(min, Math.min(max, n))
      : fallback;
  return {
    inset: bounded(v.inset, 12, 64, 24),
    shade: bounded(v.shade, 16, 40, 20),
    compact: v.compact === true,
    opaque: v.opaque === true,
    motion: v.motion !== false,
    material: v.material === "graphite" ? "graphite" : "ink",
    signal: v.signal === true,
    depth: v.depth !== false,
  };
}
export function readDesign(): {
  design: Design;
  saved: Saved[];
  error: string;
} {
  try {
    const raw = localStorage.getItem(TEMPORARY_SURFACES_KEY);
    const data = raw ? JSON.parse(raw) : {};
    if (
      !data ||
      typeof data !== "object" ||
      (data.schema !== undefined && data.schema !== 2)
    )
      throw new Error("Unknown schema");
    const saved = data.saved ?? [];
    if (
      !Array.isArray(saved) ||
      saved.some(
        (v) =>
          v?.schema !== 2 ||
          typeof v.id !== "string" ||
          typeof v.name !== "string",
      )
    )
      throw new Error("Unreadable variations");
    return {
      design: normalize(data.design),
      saved: saved.map((v) => ({ ...v, design: normalize(v.design) })),
      error: "",
    };
  } catch {
    return {
      design: PRESETS["Quiet card"],
      saved: [],
      error:
        "Saved choices could not be read. They have not been overwritten. You can still explore and export.",
    };
  }
}
export function presetName(design: Design) {
  return (
    Object.entries(PRESETS).find(
      ([, value]) => JSON.stringify(value) === JSON.stringify(design),
    )?.[0] ?? "Custom"
  );
}
export function brief(design: Design) {
  return `Polyphonic · Temporary surfaces · ${presetName(design)}

Experimental design study, not an approved production change. Reuse the current production MessageComposer and its styles without altering its shape, layout, fill, or controls. Only the temporary surfaces are being designed. Neutral, in the app's own ink over the app's own surface (so every theme carries it), no coloured gradients and no slab around the composer.

One idea: a temporary surface rises from behind the composer, asks one clear thing, and leaves a line in the conversation. Flat, like the rest of the conversation: light is only an edge, one fine line all round, a touch brighter along the top; no glow, shading or shine.${design.depth ? " The edge has a hairline of thickness, crisp and never blurred: a lit lip just inside the top that falls off over a second line, and a dark seam just outside, as a thin sheet of black glass shows its edge." : ""} Tone says what's in front: the composer is the lightest thing there, so a card tucked 18px behind it is always darker than it. Material: ${design.material === "ink" ? "Ink, black with only that edge" : "Graphite, a tone just above the page and below the composer"}.${design.signal ? " Asks have their edge, waiting dot and focus ring in the signal blue, because they are the one thing you can act on; notices stay neutral." : ""} Card ${design.inset}px inside the composer's edges, ${design.compact ? "compact" : "comfortable"} spacing, the app's grain finish. ${design.opaque ? "Solid fallback shown: one flat tone." : ""} ${design.motion ? "It rises on a spring that settles (0.44 s, slight bounce) and sinks without one (0.22 s). Reduced motion: it simply appears." : "No motion."} The conversation keeps its newest line in view as the card makes room.

An ask leads with the question, then why, then how far it reaches (plain words, no icons), then the choices: details as a quiet text button on the left; Deny, Always here (only when the runtime offers it), and Allow once on the right. Capsules like the composer; Allow once is the one light button. Hide (or Escape) sinks the ask until only its question shows above the composer, marked Waiting; the whole lip brings it back. Notices and problems are one compact row: what happened on the left, what to do on the right, and a quiet dismiss. A decision leaves one quiet centred line in the conversation where it happened; a dismissal leaves nothing. Changes to standing access use a focused dialog with Cancel focused first.

Use existing production authority and available runtime options without inventing summaries or capabilities. All buttons here affect local fixtures only. No real agent, permission, model, or profile is changed. Native integration must resolve the opaque card underneath web overlays. Preserve Ghost and the separate agent-space study.`;
}
