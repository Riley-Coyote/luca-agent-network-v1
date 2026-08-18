import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { identityGlyph } from "./glyph";
import { type GlyphRenderMode, paintGlyphCanvas } from "./render";

/**
 * Ink for the mark, per theme. Cool greys on both sides — a warm mark against
 * the charcoal scale reads as a different material from everything around it.
 */
const INK_DARK = "236,238,240";
const INK_LIGHT = "22,23,26";

export interface IdentityMarkProps {
  /** Stable identity seed — the resident's public key. Same key, same mark. */
  seed: string;
  /** Rendered box, CSS px. */
  size?: number;
  /**
   * Lift the mark on a slow cycle so an idle resident reads as present.
   *
   * Done with a CSS opacity animation rather than by repainting, because the
   * geometry never changes: there is nothing to redraw, only something to
   * dim. The phase is derived from the seed so a column of residents never
   * breathes in lockstep, and the swing is deliberately shallow — a deep one
   * would read as one resident being *more present* than another when both are
   * merely idle.
   */
  breath?: boolean;
  mode?: GlyphRenderMode;
  /** RGB triplet override. Defaults to the theme's ink; pass one where the
   *  surface is fixed regardless of theme (the onboarding doorway is dark). */
  ink?: string;
  className?: string;
  /** Accessible name; omit only when a parent already labels this. */
  accessibleName?: string;
}

/**
 * A resident's identity mark.
 *
 * A static canvas — the mark is who someone is, and a mark that twinkles is a
 * mark you cannot recognise. Live activity is the dot-matrix engine's job;
 * see `AgentIdentitySpecimen`, which swaps between the two.
 */
export function IdentityMark({
  seed,
  size = 28,
  breath = false,
  mode = "joined",
  ink: inkOverride,
  className,
  accessibleName,
}: IdentityMarkProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const { isDark } = useTheme();
  const glyph = React.useMemo(() => identityGlyph(seed), [seed]);
  const ink = inkOverride ?? (isDark ? INK_DARK : INK_LIGHT);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paintGlyphCanvas(canvas, glyph, { size, ink, mode });
  }, [glyph, size, ink, mode]);

  // A stable per-seed offset into the breath cycle, so neighbouring marks are
  // at different points in it at any instant.
  const phase = React.useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return (Math.abs(h) % 4200) / 1000;
  }, [seed]);

  return (
    <canvas
      aria-hidden={accessibleName ? undefined : true}
      aria-label={accessibleName}
      className={cn(
        "block shrink-0",
        breath && "luca-identity-breath",
        className,
      )}
      data-seed={seed}
      ref={canvasRef}
      role={accessibleName ? "img" : undefined}
      style={{
        height: `${size}px`,
        width: `${size}px`,
        animationDelay: breath ? `-${phase}s` : undefined,
      }}
    />
  );
}
