import { ArrowLeft } from "lucide-react";
import * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * Header for the focused view — the state where the timeline is showing one
 * exchange instead of the whole room.
 *
 * This exists because a filtered list that does not announce itself is worse
 * than no filter at all: the reader assumes the room went quiet. It has to say
 * what is being shown, and it has to offer one obvious way out.
 *
 * Escape also leaves, because a filtered view is a mode, and every mode needs a
 * keyboard exit.
 */
export function FocusedThreadBar({
  authorName,
  replyCount,
  onExit,
  className,
}: {
  authorName: string;
  replyCount: number;
  onExit: () => void;
  className?: string;
}) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onExit]);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2",
        className,
      )}
      data-testid="focused-thread-bar"
    >
      <button
        aria-label="Show all messages"
        className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onExit}
        type="button"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All messages
      </button>
      <span aria-hidden className="text-muted-foreground/30">
        ·
      </span>
      <span className="min-w-0 truncate text-xs text-muted-foreground/80">
        {replyCount === 0
          ? `${authorName}'s message`
          : `${replyCount} ${replyCount === 1 ? "reply" : "replies"} to ${authorName}`}
      </span>
      <span className="ml-auto hidden shrink-0 text-2xs text-muted-foreground/40 sm:inline">
        esc
      </span>
    </div>
  );
}
