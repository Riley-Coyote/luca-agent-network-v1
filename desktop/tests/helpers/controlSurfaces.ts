/**
 * The surfaces a control sits on, for the checks that copy a real control
 * onto each one and read back what was drawn: the surfaces the app's
 * switches really sit on (traced through the 27 files that use the shared
 * switch, 2026-11-24), then the rest of the ladder, where the next control
 * may land. All in the theme's own tokens.
 */
export const over = (top: string, under: string) =>
  `linear-gradient(${top}, ${top}), ${under}`;
const S = "hsl(var(--mn-surface))";
const POPOVER =
  "color-mix(in srgb, hsl(var(--background)) 80%, hsl(var(--muted)) 20%)";
export const SURFACES: { name: string; background: string }[] = [
  { name: "page, dialog, new settings", background: S },
  {
    name: "settings group (classic)",
    background: over("hsl(var(--mn-raised) / 0.2)", S),
  },
  {
    name: "import box (muted 30%)",
    background: over("hsl(var(--mn-raised) / 0.3)", S),
  },
  { name: "popover, menu", background: POPOVER },
  {
    name: "menu row, focused",
    background: over("hsl(var(--mn-raised) / 0.5)", POPOVER),
  },
  { name: "agent page panel (plate)", background: over("var(--mn-plate)", S) },
  {
    name: "Mnemos plate",
    background: over("hsl(var(--mn-ink) / 0.014)", S),
  },
  {
    name: "row hover (plate hover)",
    background: over("var(--mn-plate-hover)", S),
  },
  { name: "ladder: floor (rail)", background: "hsl(var(--mn-floor))" },
  { name: "ladder: raised", background: "hsl(var(--mn-raised))" },
  { name: "ladder: hover", background: "hsl(var(--mn-hover))" },
  { name: "ladder: recess", background: "hsl(var(--mn-recess))" },
];
