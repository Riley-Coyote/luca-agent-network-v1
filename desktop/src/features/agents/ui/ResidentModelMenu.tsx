import { ChevronDown } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useResidentModelChoice } from "@/features/agents/ui/useResidentModelChoice";
import type { ManagedAgent } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/**
 * The one place a resident's model is chosen: a radio menu over the models
 * their runtime reports. Changing it while they run restarts them, so the
 * control waits out a reply in progress. Rendered as a full-width field (the
 * conversation drawer) or inline in a line of text (the agent page strip).
 */
export function ResidentModelMenu({
  agent,
  replying = false,
  variant = "field",
  testId = "resident-model-trigger",
}: {
  agent: ManagedAgent;
  /** A reply is in progress; changing the model would cut it off. */
  replying?: boolean;
  variant?: "field" | "inline";
  testId?: string;
}) {
  const model = useResidentModelChoice(agent);
  const [open, setOpen] = React.useState(false);
  const currentLabel =
    model.options.find((option) => option.value === model.currentModel)
      ?.label ??
    model.currentModel ??
    "Default";
  const disabled = model.busy || replying || model.options.length === 0;

  const choose = React.useCallback(
    (next: string) => {
      if (!next || next === model.currentModel) return;
      const label =
        model.options.find((option) => option.value === next)?.label ?? next;
      void model
        .setModel(next)
        .then(() => {
          toast.success(
            agent.status === "running"
              ? `${agent.name} now runs ${label}. Restarted to apply.`
              : `${agent.name} will run ${label}.`,
          );
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : `Couldn't change ${agent.name}'s model.`,
          );
        });
    },
    [agent.name, agent.status, model],
  );

  const helper = replying
    ? `Waiting for ${agent.name} to finish replying.`
    : model.status
      ? model.status
      : model.busy
        ? "Working…"
        : agent.status === "running"
          ? `Changing the model restarts ${agent.name}.`
          : "Applies the next time they run.";

  return (
    <div className={variant === "inline" ? "inline-flex min-w-0" : undefined}>
      <DropdownMenu modal={false} onOpenChange={setOpen} open={open}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Model: ${currentLabel}. Change model`}
            className={cn(
              variant === "field"
                ? "flex h-10 w-full items-center justify-between gap-3 rounded-md border border-border/70 bg-foreground/[0.03] px-3 text-left text-sm leading-5 text-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:border-foreground/50 focus-visible:outline-hidden active:bg-foreground/[0.06]"
                : "inline-flex max-w-full items-center gap-1 rounded-sm text-sm leading-5 text-foreground/85 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-hidden",
              "disabled:cursor-default disabled:opacity-60",
            )}
            data-testid={testId}
            disabled={disabled}
            title={variant === "inline" ? helper : undefined}
            type="button"
          >
            <span className="min-w-0 flex-1 truncate">{currentLabel}</span>
            <ChevronDown
              className={cn(
                "shrink-0 text-muted-foreground/60",
                variant === "field" ? "h-4 w-4" : "h-3.5 w-3.5",
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="overflow-hidden"
          onCloseAutoFocus={(event) => event.preventDefault()}
          sideOffset={5}
          style={
            variant === "field"
              ? {
                  minWidth: "var(--radix-dropdown-menu-trigger-width)",
                  width: "var(--radix-dropdown-menu-trigger-width)",
                }
              : { minWidth: "14rem" }
          }
        >
          <div className="max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain">
            <DropdownMenuRadioGroup
              onValueChange={(next) => {
                choose(next);
                setOpen(false);
              }}
              value={model.currentModel ?? ""}
            >
              {model.options.map((option) => (
                <DropdownMenuRadioItem
                  className="pr-3 text-sm"
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {variant === "field" ? (
        <p className="mt-2 text-2xs leading-4 text-muted-foreground/70">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
