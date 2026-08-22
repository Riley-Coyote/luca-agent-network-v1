import type { LucideIcon } from "lucide-react";
import { ChevronRight, LoaderCircle } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

export type BrainConnectionState =
  | "Found"
  | "Connecting"
  | "Connected"
  | "Current"
  | "Needs attention"
  | "Not found";

const stateTone: Record<BrainConnectionState, string> = {
  Found: "bg-sky-400",
  Connecting: "bg-sky-400",
  Connected: "bg-emerald-400",
  Current: "bg-emerald-400",
  "Needs attention": "bg-amber-400",
  "Not found": "bg-muted-foreground/50",
};

export function BrainConnectionCard({
  actionLabel,
  description,
  detail,
  disabled,
  icon: Icon,
  onAction,
  onSecondaryAction,
  secondaryActionLabel,
  state,
  testId,
  title,
}: {
  actionLabel: string;
  description: string;
  detail: string;
  disabled?: boolean;
  icon: LucideIcon;
  onAction: () => void;
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
  state: BrainConnectionState;
  testId: string;
  title: string;
}) {
  const connecting = state === "Connecting";
  return (
    <article
      className="flex min-h-56 flex-col rounded-2xl border border-border/55 bg-card/25 p-5 transition-colors hover:border-border/80"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/45 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              stateTone[state],
              connecting && "animate-pulse",
            )}
          />
          <span>{state}</span>
        </div>
      </div>
      <div className="mt-5">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <p className="mt-4 text-xs text-ink-faint">{detail}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        <Button
          disabled={disabled}
          onClick={onAction}
          size="sm"
          type="button"
          variant={state === "Found" ? "default" : "outline"}
        >
          {connecting ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <ChevronRight />
          )}
          {actionLabel}
        </Button>
        {onSecondaryAction && secondaryActionLabel ? (
          <Button
            disabled={disabled}
            onClick={onSecondaryAction}
            size="sm"
            type="button"
            variant="ghost"
          >
            {secondaryActionLabel}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
