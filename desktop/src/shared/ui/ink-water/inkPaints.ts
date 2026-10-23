import { EXPRESSION_COLORS } from "@/shared/lib/remarkExpressionColors";
import type { InkColor } from "./inkWaterEngine";

/**
 * The paints the water carries: the app's own Living Ink colours, so what
 * drifts through an empty conversation is what Luca writes with. Warm and
 * cool alternate; the colours that carry a warning (red) or read as flat
 * (slate, gold) stay out of the water.
 */
export const WATER_PAINTS = [
  "violet",
  "rose",
  "cyan",
  "magenta",
  "blue",
  "amber",
] as const satisfies readonly (keyof typeof EXPRESSION_COLORS)[];

export function hexToInk(hex: string): InkColor {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

export function waterPalette(): InkColor[] {
  return WATER_PAINTS.map((name) => hexToInk(EXPRESSION_COLORS[name]));
}

/**
 * Each word you write lets go its own paint, and neighbouring words never
 * share one. The order steps by a stride coprime with the palette's length,
 * so a sentence walks the whole palette before any paint comes back.
 */
export function paintIndexForWord(
  wordIndex: number,
  paints: number = WATER_PAINTS.length,
) {
  const stride = 5;
  return (((wordIndex * stride) % paints) + paints) % paints;
}

/**
 * The beads of one word are the same paint, never the same colour: each
 * leans a little lighter or deeper, as real ink never lands even.
 */
export function varyInk(color: InkColor, seed: number): InkColor {
  const lean = Math.sin(seed * 12.9898) * 0.5 + 0.5;
  const depth = 0.88 + lean * 0.22;
  return [
    Math.min(1, color[0] * depth),
    Math.min(1, color[1] * depth),
    Math.min(1, color[2] * depth),
  ];
}
