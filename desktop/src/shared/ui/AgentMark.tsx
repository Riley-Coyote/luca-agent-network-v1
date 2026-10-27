import type * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * The agent mark: one face for every agent (Riley, 2026-10-27: "our own icon
 * that represents agents used for all of them … based on our truchet design
 * work"). A cousin of the robot face in Prompt Ghost's lattice study
 * (lab/life/studies/01-lattice): a head of joined cells, its corners turned,
 * its two tall eyes the cells it keeps empty. Its antenna is a cell that has
 * let go, as the Fleet mark's fifth specialist is "on its way". Drawn on a
 * 20 grid in the row's ink; the first of the rail's own icons.
 */
export function AgentMark({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("luca-agent-mark", className)}
      data-agent-mark=""
      fill="currentColor"
      viewBox="0 0 20 20"
      {...props}
    >
      <circle cx="10" cy="2.6" r="2" />
      <path
        clipRule="evenodd"
        d="M7 6h6a5 5 0 0 1 5 5v2.5a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5ZM7.5 9.3a1.4 1.4 0 0 0-1.4 1.4v3a1.4 1.4 0 0 0 2.8 0v-3a1.4 1.4 0 0 0-1.4-1.4Zm5 0a1.4 1.4 0 0 0-1.4 1.4v3a1.4 1.4 0 0 0 2.8 0v-3a1.4 1.4 0 0 0-1.4-1.4Z"
        fillRule="evenodd"
      />
    </svg>
  );
}
