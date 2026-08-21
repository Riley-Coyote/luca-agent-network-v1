import { Square } from "lucide-react";
import * as React from "react";

import { activityLabel } from "@/features/agents/lib/activityPhase";
import type { ChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

/**
 * "A reply is coming, here."
 *
 * Sits at the tail of the timeline while residents are working, and is replaced
 * by the real message when it lands. Tail placement is correct BY CONSTRUCTION:
 * replies are chronological under the quote-reply model, so a pending reply
 * always arrives at the bottom. Nothing needs anchoring to a thread.
 *
 * Activity is presented as conversation status, not as identity decoration.
 * The words stay plain and never carry raw arguments; a shared room is the
 * wrong place for command lines.
 */

/** Below this, an elapsed counter is just noise. Above it, silence starts to
 *  read as a hang, and a number is reassurance. */
const SHOW_ELAPSED_AFTER_MS = 10_000;
/** More than this many working at once folds into a single line — a column of
 *  five identical rows is worse than one sentence. */
const MAX_INDIVIDUAL_ROWS = 2;

function useElapsedTick(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function nameFor(pubkey: string, profiles?: UserProfileLookup): string {
  return resolveUserLabel({ pubkey, profiles });
}

export function PendingReplyRow({
  rows,
  profiles,
  onCancel,
  onOpenAgentSession,
  className,
}: {
  rows: readonly ChannelAgentActivity[];
  profiles?: UserProfileLookup;
  onCancel?: (agentPubkey: string) => void;
  /** Opens the resident's session. This row replaced a pill whose popover was
   *  the only route to that detail, so the route has to survive somewhere. */
  onOpenAgentSession?: (agentPubkey: string) => void;
  className?: string;
}) {
  const now = useElapsedTick(rows.length > 0);

  if (rows.length === 0) return null;

  const folded = rows.length > MAX_INDIVIDUAL_ROWS;

  return (
    <div
      aria-live="polite"
      className={cn("flex flex-col gap-1.5 pb-2 pt-1", className)}
      data-testid="pending-reply-row"
    >
      {folded ? (
        <div className="flex items-center gap-2 pl-1">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-foreground/55 motion-safe:animate-pulse"
          />
          <span className="text-sm text-muted-foreground">
            {rows.length} residents are working
          </span>
        </div>
      ) : (
        rows.map((row) => {
          const name = nameFor(row.agentPubkey, profiles);
          const elapsedMs = Math.max(0, now - row.anchorAt);
          const label = activityLabel(row.activity);
          return (
            <div
              className="group/pending flex items-center gap-2 pl-1"
              key={row.turnId}
            >
              <button
                aria-label={`${name} is ${label || "working"}. Open session.`}
                className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={
                  onOpenAgentSession
                    ? () => onOpenAgentSession(row.agentPubkey)
                    : undefined
                }
                type="button"
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-foreground/55 motion-safe:animate-pulse"
                />
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  <span className="font-medium text-ink-muted">{name}</span>
                  {label ? ` is ${label}` : " is working"}
                  <span aria-hidden>…</span>
                </span>
              </button>

              {elapsedMs >= SHOW_ELAPSED_AFTER_MS ? (
                <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
                  {formatElapsed(elapsedMs)}
                </span>
              ) : null}

              {onCancel ? (
                <Button
                  aria-label={`Stop ${name}`}
                  className="h-6 w-6 shrink-0 px-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/pending:opacity-100"
                  onClick={() => onCancel(row.agentPubkey)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Square className="h-3 w-3" />
                </Button>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
