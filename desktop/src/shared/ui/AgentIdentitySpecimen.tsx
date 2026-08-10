import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { sigilPattern, type DotScene } from "@/shared/ui/dot-display/engine";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import { useTheme } from "@/shared/theme/ThemeProvider";

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
 * `present` is therefore the static sigil (breathing, but never re-lighting
 * individual cells: a mark that twinkles is a mark you cannot recognise), and
 * every other state is a live scene.
 */
const SCENE_FOR_STATE: Record<AgentVisualState, DotScene> = {
  present: "sigil",
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
  const seed = React.useMemo(() => normalizePubkey(publicKey), [publicKey]);
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
      <DotSigil
        // Roughly eight cells across gives the mirrored seven-cell emblem a
        // narrow quiet zone without making it feel like a small icon inside an
        // avatar box. Integer pitch keeps every edge crisp at every app scale.
        breath={state === "present"}
        cell={cell}
        dot={isDark ? "239,239,237" : "22,23,22"}
        scene={SCENE_FOR_STATE[state]}
        seed={seed}
        size={size}
      />
    </span>
  );
}
