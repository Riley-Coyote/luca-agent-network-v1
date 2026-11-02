import * as React from "react";

import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { cn } from "@/shared/lib/cn";
import { AgentMark } from "@/shared/ui/AgentMark";

import { originalRenderer } from "./original";
import { dendriteRenderer } from "./renderer";
import { dendriteSeed } from "./tree";

export type AgentDendriteProps = {
  residentKey: string;
  /** CSS pixels: 18 in a row, 72 at a page's head. */
  size?: number;
  working?: boolean;
  group?: string;
  className?: string;
};

/**
 * Small marks retain the fine engine; heads use the approved Aug 10 original.
 * Both hold still under Reduce Motion. Decorative: the row's name labels it.
 */
export const AgentDendrite = React.memo(function AgentDendrite({
  className,
  residentKey,
  size = 18,
  working = false,
  group,
}: AgentDendriteProps) {
  const lucaPubkey = useCanonicalLucaPubkey();
  const seed = dendriteSeed(residentKey, lucaPubkey);
  const [supported] = React.useState(() => dendriteRenderer() !== null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const handleRef = React.useRef<{
    dispose(): void;
    update?(options: { working: boolean }): void;
  } | null>(null);
  const live = React.useRef(working);
  live.current = working;

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (size >= 40) {
      const renderer = originalRenderer();
      if (!canvas || !renderer) return;
      const handle = renderer.register(canvas);
      handleRef.current = handle;
      return () => {
        handle.dispose();
        handleRef.current = null;
      };
    }
    const renderer = dendriteRenderer();
    if (!canvas || !renderer) return;
    const handle = renderer.register(canvas, {
      seed,
      size,
      group,
      working: live.current,
    });
    handleRef.current = handle;
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
  }, [seed, size, group]);

  React.useEffect(() => {
    handleRef.current?.update?.({ working });
  }, [working]);

  if (!supported) {
    return (
      <AgentMark className={className} style={{ height: size, width: size }} />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "luca-agent-dendrite",
        size >= 40 && "luca-agent-dendrite--original",
        className,
      )}
      style={{
        height: size >= 40 ? size : size + 2,
        width: size >= 40 ? size : size + 2,
      }}
    >
      <canvas
        tabIndex={-1}
        className="block"
        data-agent-dendrite=""
        data-working={working ? "" : undefined}
        ref={canvasRef}
        style={{
          height: size,
          width: size,
          ...(size >= 40
            ? ({
                boxSizing: "border-box",
                background: "rgb(10, 11, 12)",
                border: "1px solid rgb(40, 42, 44)",
                borderRadius: "50%",
              } as const)
            : {}),
        }}
      />
    </span>
  );
});
