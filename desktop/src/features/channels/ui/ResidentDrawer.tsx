import { ArrowUpRight, ChevronDown } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useResidentModelChoice } from "@/features/agents/ui/useResidentModelChoice";
import {
  CANONICAL_LUCA_PERSONA_ID,
  LUCA_INTRO_ROLE,
} from "@/features/luca/canonicalLucaResident";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import {
  getResidentContinuity,
  type ResidentContinuityInspector,
} from "@/shared/api/tauriContinuity";
import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/**
 * The right drawer of a direct conversation with a resident: the resident,
 * not the room. One screen, no scrolling to speak of — who they are, what
 * powers them (with the model changeable right here), the first lines of
 * their instructions, and their last handoff. Everything deeper lives on the
 * agent's own page: Documents · Notebook · Settings.
 */

const INSTRUCTIONS_PREVIEW_LINES = 5;

function firstLines(text: string, count: number): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.slice(0, count).join("\n");
}

function residentState(status: ManagedAgent["status"]) {
  switch (status) {
    case "running":
    case "deployed":
      return { label: "Ready", tone: "present" as const };
    default:
      return { label: "Idle", tone: "idle" as const };
  }
}

export function ResidentDrawer({
  agent,
  persona,
  onOpenAgent,
  replying = false,
}: {
  agent: ManagedAgent;
  persona: AgentPersona | null;
  onOpenAgent: (section: "overview" | "notebook" | "settings") => void;
  /** A reply is in progress in this conversation. Changing the model would
   *  restart the resident mid-turn, so the control waits. */
  replying?: boolean;
}) {
  const model = useResidentModelChoice(agent);
  const state = residentState(agent.status);
  const role =
    agent.personaId === CANONICAL_LUCA_PERSONA_ID
      ? LUCA_INTRO_ROLE
      : persona && persona.displayName !== agent.name
        ? persona.displayName
        : null;
  const instructions = (
    agent.systemPrompt ??
    persona?.systemPrompt ??
    ""
  ).trim();
  const [continuity, setContinuity] =
    React.useState<ResidentContinuityInspector | null>(null);
  React.useEffect(() => {
    let current = true;
    setContinuity(null);
    void getResidentContinuity(agent.pubkey)
      .then((next) => {
        if (current) setContinuity(next);
      })
      .catch(() => {
        // Body-free context. The drawer stays useful without it.
      });
    return () => {
      current = false;
    };
  }, [agent.pubkey]);
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const currentModelLabel =
    model.options.find((option) => option.value === model.currentModel)
      ?.label ??
    model.currentModel ??
    "Default";
  const handleModel = React.useCallback(
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

  return (
    <div className="space-y-7 pt-5" data-testid="resident-drawer">
      <section className="flex items-start gap-4 border-b border-border/55 pb-5">
        <AgentIdentitySpecimen
          accessibleName={agent.name}
          publicKey={agent.pubkey}
          size={56}
          state={state.tone === "present" ? "present" : "idle"}
        />
        {/* The panel header already carries the name; the card leads with the
            mark, then who they are and how they are. */}
        <div className="min-w-0 flex-1 pt-1">
          <p className="truncate text-base leading-6 text-foreground/90">
            {role ?? "Resident"}
          </p>
          <p
            className="mt-1.5 flex items-center gap-2 text-2xs text-muted-foreground"
            data-testid="resident-drawer-state"
          >
            <span
              aria-hidden
              className={cn(
                "inline-block size-1.5 rounded-full",
                state.tone === "present"
                  ? "bg-primary"
                  : "bg-muted-foreground/40",
              )}
            />
            <span className="text-foreground/80">{state.label}</span>
            {model.runtimeLabel ? (
              <>
                <span aria-hidden className="text-muted-foreground/40">
                  ·
                </span>
                <span>{model.runtimeLabel}</span>
              </>
            ) : null}
          </p>
        </div>
      </section>

      <section aria-labelledby="resident-drawer-model">
        <Eyebrow id="resident-drawer-model">Model</Eyebrow>
        <DropdownMenu
          modal={false}
          onOpenChange={setModelMenuOpen}
          open={modelMenuOpen}
        >
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Model: ${currentModelLabel}. Change model`}
              className={cn(
                "flex h-10 w-full items-center justify-between gap-3 rounded-md border border-border/70 bg-foreground/[0.03] px-3 text-left text-sm leading-5 text-foreground transition-colors",
                "hover:bg-foreground/[0.05] focus-visible:border-foreground/50 focus-visible:outline-hidden active:bg-foreground/[0.06]",
                "disabled:cursor-default disabled:opacity-60",
              )}
              data-testid="resident-drawer-model-trigger"
              disabled={model.busy || replying || model.options.length === 0}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">
                {currentModelLabel}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="overflow-hidden"
            onCloseAutoFocus={(event) => event.preventDefault()}
            sideOffset={5}
            style={{
              minWidth: "var(--radix-dropdown-menu-trigger-width)",
              width: "var(--radix-dropdown-menu-trigger-width)",
            }}
          >
            <div className="max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain">
              <DropdownMenuRadioGroup
                onValueChange={(next) => {
                  handleModel(next);
                  setModelMenuOpen(false);
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
        <p className="mt-2 text-2xs leading-4 text-muted-foreground/70">
          {replying
            ? `Waiting for ${agent.name} to finish replying.`
            : model.status
              ? model.status
              : model.busy
                ? "Working…"
                : agent.status === "running"
                  ? `Changing the model restarts ${agent.name}.`
                  : "Applies the next time they run."}
        </p>
      </section>

      <section aria-labelledby="resident-drawer-instructions">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow id="resident-drawer-instructions">Instructions</Eyebrow>
          <OpenLink onClick={() => onOpenAgent("settings")}>
            {instructions ? "Open" : "Write"}
          </OpenLink>
        </div>
        {instructions ? (
          <p
            className="whitespace-pre-line text-sm leading-6 text-foreground/80"
            data-testid="resident-drawer-instructions"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: INSTRUCTIONS_PREVIEW_LINES,
              overflow: "hidden",
            }}
          >
            {firstLines(instructions, INSTRUCTIONS_PREVIEW_LINES + 2)}
          </p>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            No instructions yet.
          </p>
        )}
      </section>

      <section aria-labelledby="resident-drawer-handoff">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow id="resident-drawer-handoff">Last handoff</Eyebrow>
          <OpenLink onClick={() => onOpenAgent("notebook")}>Notebook</OpenLink>
        </div>
        <p
          className="text-sm leading-6 text-foreground/80"
          data-testid="resident-drawer-handoff"
        >
          {continuity?.handoff
            ? continuity.handoff.summary || "No summary recorded."
            : continuity?.enabled === false
              ? "Continuity is off for this resident."
              : "No handoff has been recorded yet."}
        </p>
      </section>

      <section className="border-t border-border/55 pt-5">
        <button
          className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1.5 text-left text-sm text-foreground/80 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-hidden"
          data-testid="resident-drawer-open-agent"
          onClick={() => onOpenAgent("overview")}
          type="button"
        >
          <span>Open {agent.name}</span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground/60" />
        </button>
      </section>
    </div>
  );
}

function Eyebrow({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h3
      className="mb-2.5 font-mono text-2xs uppercase tracking-[0.14em] text-muted-foreground"
      id={id}
    >
      {children}
    </h3>
  );
}

function OpenLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="mb-2.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-hidden"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
