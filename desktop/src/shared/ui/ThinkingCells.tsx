import * as React from "react";

import { cn } from "@/shared/lib/cn";

import "./thinkingCells.css";

/**
 * Thinking, in the house's little language: three cells breathing on their
 * own rhythms, so they never tick together — in place of three bouncing dots.
 *
 * The cells are the black fluid's, drawn as one liquid. When two neighbours
 * swell at the same moment they join at a neck, and they part as one of them
 * draws back, so the joins come and go. Decorative: the word beside them
 * carries the meaning. Under reduced motion they rest, apart.
 */
export function ThinkingCells({ className }: { className?: string }) {
  // A filter is found by id, so every instance needs its own, and React's ids
  // carry characters a `url(#…)` reference should not have to escape.
  const filterId = `luca-thinking-${React.useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      aria-hidden="true"
      className={cn("luca-thinking-cells", className)}
      data-testid="thinking-cells"
      focusable="false"
      viewBox="0 0 16 8"
    >
      <filter
        colorInterpolationFilters="sRGB"
        height="260%"
        id={filterId}
        width="140%"
        x="-20%"
        y="-80%"
      >
        {/* The liquid: blur the cells into one another, then cut the blur back
            to a hard edge. Two edges closer than about a pixel bridge, as two
            drops do; farther apart, each keeps its own round. */}
        <feGaussianBlur stdDeviation="0.8" />
        <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" />
      </filter>
      <g fill="currentColor" filter={`url(#${filterId})`}>
        <circle cx="3" cy="4" r="2.2" />
        <circle cx="8" cy="4" r="2.2" />
        <circle cx="13" cy="4" r="2.2" />
      </g>
    </svg>
  );
}
