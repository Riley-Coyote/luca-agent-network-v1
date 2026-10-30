import * as React from "react";

import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { cn } from "@/shared/lib/cn";
import { AgentMark } from "@/shared/ui/AgentMark";

import { type DendriteMarkHandle, dendriteRenderer } from "./renderer";
import { dendriteSeed } from "./tree";

export type AgentDendriteProps = {
  residentKey: string;
  /** CSS pixels: 18 in a row, 72 at a page's head. */
  size?: number;
  working?: boolean;
  className?: string;
};

/**
 * An agent's mark (WP-42): its own dendrite, grown once from its key and kept,
 * with light running out to its tips, often while it works, and exactly still
 * under Reduce Motion. It's light, and light needs the dark: by day it sits in
 * a small black well (shell-rail.css). Decorative: the row's name labels it.
 */
export const AgentDendrite = React.memo(function AgentDendrite({
  className,
  residentKey,
  size = 18,
  working = false,
}: AgentDendriteProps) {
  const lucaPubkey = useCanonicalLucaPubkey();
  const seed = dendriteSeed(residentKey, lucaPubkey);
  const [supported] = React.useState(() => dendriteRenderer() !== null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const handleRef = React.useRef<DendriteMarkHandle | null>(null);
  const live = React.useRef(working);
  live.current = working;

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const renderer = dendriteRenderer();
    if (!canvas || !renderer) return;
    const handle = renderer.register(canvas, {
      seed,
      size,
      working: live.current,
    });
    handleRef.current = handle;
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
  }, [seed, size]);

  React.useEffect(() => {
    handleRef.current?.update({ working });
  }, [working]);

  if (!supported) {
    return (
      <AgentMark className={className} style={{ height: size, width: size }} />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("luca-agent-dendrite relative inline-block", className)}
      style={{ height: size, width: size }}
    >
      <canvas
        tabIndex={-1}
        className="block"
        data-agent-dendrite=""
        data-working={working ? "" : undefined}
        ref={canvasRef}
        style={{ height: size, width: size }}
      />
    </span>
  );
});
