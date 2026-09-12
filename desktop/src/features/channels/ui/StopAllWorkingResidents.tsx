import type * as React from "react";

import { cn } from "@/shared/lib/cn";

/** Stop every currently working resident without competing with the reply rows. */
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
          "border-transparent bg-transparent text-white/[0.45]",
          "hover:text-white/[0.78]",
          "active:text-white/50",
          "focus-visible:border-white/50 focus-visible:!outline-none",
          "disabled:cursor-default disabled:text-white/[0.45]",
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
