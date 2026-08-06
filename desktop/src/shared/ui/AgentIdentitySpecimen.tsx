import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import type { DotScene } from "@/shared/ui/dot-display/engine";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";

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

export function shortAgentFingerprint(publicKey: string): string {
  return truncatePubkey(normalizePubkey(publicKey));
}

/**
 * A resident's avatar: a live dot-matrix panel seeded by their public key.
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
  const seed = React.useMemo(() => normalizePubkey(publicKey), [publicKey]);

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
        // A 2px pitch is what the system is tuned for at avatar scale. The chip
        // is border-box with a 1px border, so the panel is inset by 2 — which
        // still leaves a 9-cell lattice in the smallest (20px) placement, the
        // minimum the mirrored 7-wide emblem needs plus its quiet zone.
        breath={state === "present"}
        cell={2}
        scene={SCENE_FOR_STATE[state]}
        seed={seed}
        size={size - 2}
      />
    </span>
  );
}
