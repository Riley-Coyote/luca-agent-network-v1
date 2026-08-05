import * as React from "react";

import { cn } from "@/shared/lib/cn";
import {
  applySceneColour,
  type DotPanelOptions,
  type DotScene,
  registerPanel,
  settle,
  unregisterPanel,
} from "./engine";

export interface DotSigilProps {
  /** Stable identity seed — the resident's public key. Same key, same mark. */
  seed: string;
  /** Which scene to run. `sigil` is the resting identity mark. */
  scene?: DotScene;
  /** Rendered box, px. 28 is the avatar scale the system is tuned for. */
  size?: number;
  /** Dot pitch in CSS px. 2 at avatar scale, larger on big surfaces. */
  cell?: number;
  /** Lift the resting sigil on a slow sine so an idle resident reads as present. */
  breath?: boolean;
  /** 0..1, only meaningful for the `fill` scene. */
  level?: number;
  /** Neighbour bleed. Off by default — it is the expensive pass. */
  bloom?: number;
  className?: string;
  /** Accessible name; omit only when a parent already labels this. */
  accessibleName?: string;
}

/**
 * A single dot-matrix panel.
 *
 * The canvas is driven by the shared engine host: one requestAnimationFrame for
 * every panel on the page, panels paused while off-screen, and a settled first
 * frame so a panel never paints as blank glass. Under
 * `prefers-reduced-motion: reduce` the loop never starts and the settled frame
 * is all you get — the mark stays legible, the motion stops.
 */
export function DotSigil({
  seed,
  scene = "sigil",
  size = 28,
  cell = 2,
  breath = false,
  level = 0.5,
  bloom = 0,
  className,
  accessibleName,
}: DotSigilProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Mount/unmount with the host. Seed and cell define the lattice, so a change
  // to either rebuilds the panel; scene and the cheap options are patched in
  // place by the effect below.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const options: Partial<DotPanelOptions> = {
      seed,
      cell,
      breath,
      level,
      bloom,
    };
    registerPanel(canvas, options);
    return () => {
      unregisterPanel(canvas);
    };
  }, [seed, cell, breath, level, bloom]);

  // Scene changes must not remount: the charge buffer is the animation's memory,
  // and tearing it down would make every state change flash.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.scene = scene;
    const panel = registerPanel(canvas, { seed, cell, breath, level, bloom });
    if (panel.scene !== scene) {
      panel.scene = scene;
      // Colour follows the scene: only scenes that write magnitude get the ramp.
      applySceneColour(panel);
      // Re-settle so a switch into a static scene (sigil, fill) paints at once
      // rather than waiting for the next frame, and so the same happens under
      // reduced motion where there is no next frame.
      settle(panel);
    }
  }, [scene, seed, cell, breath, level, bloom]);

  return (
    <canvas
      aria-hidden={accessibleName ? undefined : true}
      className={cn("block shrink-0", className)}
      data-scene={scene}
      data-seed={seed}
      height={size}
      ref={canvasRef}
      role={accessibleName ? "img" : undefined}
      aria-label={accessibleName}
      style={{ height: `${size}px`, width: `${size}px` }}
      width={size}
    />
  );
}
