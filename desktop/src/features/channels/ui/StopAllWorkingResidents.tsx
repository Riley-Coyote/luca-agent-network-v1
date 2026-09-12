import type * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * WP-STRIP1 · decision 3.
 *
 * Every working row carries its own Stop, revealed under the pointer or under
 * focus. "Stop all" exists ONLY when there is an "all" — two or more residents
 * working at once — and it sits at the bottom edge of that group, under the
 * last row of the last one still going.
 *
 * It is the quietest object in the view on purpose: the most destructive
 * control should take the most deliberate aim. `quiet` drops the resting fill
 * and border, but the border is TRANSPARENT rather than absent, so focus
 * brightens it in place without moving a pixel.
 *
 * `!outline-none` is deliberate: `conversation-shell.css` sets an unlayered
 * global `:focus-visible` outline that beats any component's own treatment, so
 * without the override this object would show the house ring on top of its own
 * brightened border — two edges. WP-BASE1 removes that rule; until it lands
 * this is the only way to express the baseline.
 */
export function StopAllWorkingResidents({
  onStop,
  stopping,
}: {
  onStop: () => void;
  stopping: boolean;
}): React.ReactElement {
  return (
    <div
      className="flex justify-end border-t border-white/[0.055] pt-1.5"
      data-testid="stop-all-working-residents"
    >
      <button
        className={cn(
          "inline-flex select-none items-center rounded-[5px] border px-2 py-[3px]",
          "text-xs leading-[1.45]",
          "transition-[color,background-color,border-color] duration-150",
          "border-transparent bg-transparent text-white/[0.28]",
          "hover:border-white/[0.09] hover:bg-white/[0.03] hover:text-white/[0.62]",
          "active:bg-white/[0.015] active:text-white/50",
          "focus-visible:border-white/50 focus-visible:!outline-none",
          "disabled:cursor-default disabled:text-white/[0.16]",
          "disabled:hover:border-transparent disabled:hover:bg-transparent",
        )}
        disabled={stopping}
        onClick={onStop}
        type="button"
      >
        {stopping ? "Stopping all" : "Stop all"}
      </button>
    </div>
  );
}
