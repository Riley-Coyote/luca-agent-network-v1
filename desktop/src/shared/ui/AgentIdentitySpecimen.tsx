import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { sigilPattern, type DotScene } from "@/shared/ui/dot-display/engine";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import {
  residentGlyphSeed,
  useCanonicalLucaPubkey,
} from "@/features/luca/canonicalLucaResident";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";

export type AgentVisualState =
  | "present"
  | "idle"
  | "thinking"
  | "working"
  | "responding"
  | "unavailable"
  | "fault";

export type AgentIdentityCustody = "managed" | "guest" | "owner";

/**
 * The doctrine: a resident's identity mark is REPLACED by its state, and comes
 * back when the state ends. No corner lamp, no "typing…", no badge sitting
 * beside the avatar — at rest you see who, and while they are busy you see what.
 *
 * `present` is therefore the identity glyph (breathing, but never re-lighting
 * individual cells: a mark that twinkles is a mark you cannot recognise), and
 * every other state is a live dot-matrix scene. `present` is handled by
 * `IdentityMark`, so it is excluded from this table rather than sitting in it
 * as an entry nothing reads.
 *
 * The two are rendered differently on purpose. Identity is a *joined* glyph —
 * continuous strokes with rounded terminals — and activity is a *dotted* field.
 * Joined means who; dotted means what they are doing, readable at a glance
 * across a column where some residents are resting and some are working.
 */
const SCENE_FOR_STATE: Record<
  Exclude<AgentVisualState, "present">,
  DotScene
> = {
  idle: "listen",
  thinking: "think",
  working: "work",
  responding: "pulse",
  unavailable: "sleep",
  fault: "fault",
};

/**
 * Compatibility projection for callers and fixtures that need the canonical
 * static 7×7 identity matrix without mounting a canvas.
 */
export function agentIdentityMatrix(publicKey: string): boolean[][] {
  const { grid } = sigilPattern(normalizePubkey(publicKey));
  return grid.map((row) =>
    [...row, ...row.slice(0, row.length - 1).reverse()].map(Boolean),
  );
}

export function shortAgentFingerprint(publicKey: string): string {
  return truncatePubkey(normalizePubkey(publicKey));
}

/**
 * A resident's identity mark: a live dot-matrix panel seeded by their public
 * key. The canvas is intentionally frame-free. The mirrored lattice supplies
 * the square silhouette; callers should not crop it into an avatar shape.
 *
 * The panel is driven by the shared engine host — one animation frame for every
 * mark on screen, panels paused while off-screen, and a settled first frame so
 * one never paints as blank glass. Under `prefers-reduced-motion: reduce` the
 * loop never starts and the settled frame is all you get: the mark stays
 * legible, the motion stops.
 */
export function AgentIdentitySpecimen({
  accessibleName,
  className,
  custody = "managed",
  publicKey,
  size = 32,
  state = "present",
}: {
  accessibleName: string;
  className?: string;
  custody?: AgentIdentityCustody;
  publicKey: string;
  size?: number;
  state?: AgentVisualState;
}) {
  const { isDark } = useTheme();
  const lucaPubkey = useCanonicalLucaPubkey();
  const seed = React.useMemo(
    () => residentGlyphSeed(publicKey, lucaPubkey),
    [lucaPubkey, publicKey],
  );
  const cell = Math.max(2, Math.floor(size / 8));

  return (
    <span
      aria-label={`${accessibleName} identity, ${state}`}
      className={cn("agent-identity-specimen", className)}
      data-agent-state={state}
      data-custody={custody}
      role="img"
      style={{ "--agent-specimen-size": `${size}px` } as React.CSSProperties}
      title={`${accessibleName} · ${shortAgentFingerprint(publicKey)}`}
    >
      {state === "present" ? (
        // Identity is a joined glyph — continuous strokes with rounded
        // terminals — and it fills its slot: the mark spans all seven cells by
        // construction and the app's commonest placement is 20px. Frame-free,
        // like the live scenes, so the silhouette is the mark's own.
        <IdentityMark breath seed={seed} size={size} />
      ) : (
        <DotSigil
          // Roughly eight cells across gives the seven-cell field a narrow
          // quiet zone without making it feel like a small icon inside an
          // avatar box. Integer pitch keeps every edge crisp at every app
          // scale.
          cell={cell}
          dot={isDark ? "239,239,237" : "22,23,22"}
          scene={SCENE_FOR_STATE[state]}
          seed={seed}
          size={size}
        />
      )}
    </span>
  );
}
