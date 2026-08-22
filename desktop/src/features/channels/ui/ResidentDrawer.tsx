import { ArrowUpRight } from "lucide-react";
import * as React from "react";

import { ResidentModelMenu } from "@/features/agents/ui/ResidentModelMenu";
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
  onOpenAgent: (section: "documents" | "notebook" | "settings") => void;
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
  return (
    <div className="space-y-6 pt-3" data-testid="resident-drawer">
      <section className="flex items-start gap-4">
        {/* The identity glyph, not the harness logo: this is the one place
            that is about who they are rather than what runs them. */}
        <AgentIdentitySpecimen
          accessibleName={agent.name}
          publicKey={agent.pubkey}
          size={48}
          state={state.tone === "present" ? "present" : "idle"}
        />
        {/* The panel header already carries the name; the card leads with the
            mark, then who they are and how they are. */}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-base leading-6 text-ink">
            {role ?? "Resident"}
          </p>
          <p
            className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground"
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
            <span className="text-ink-muted">{state.label}</span>
            {model.runtimeLabel ? (
              <>
                <span aria-hidden className="text-ink-ghost">
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
        <ResidentModelMenu
          agent={agent}
          replying={replying}
          testId="resident-drawer-model-trigger"
          variant="field"
        />
      </section>

      <section aria-labelledby="resident-drawer-instructions">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow id="resident-drawer-instructions">Instructions</Eyebrow>
          <OpenLink onClick={() => onOpenAgent("documents")}>
            {instructions ? "Open" : "Write"}
          </OpenLink>
        </div>
        <div className="rounded-2xl bg-plate px-3 py-2.5">
          {instructions ? (
            <p
              className="whitespace-pre-line text-sm leading-6 text-ink-muted"
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
        </div>
      </section>

      <section aria-labelledby="resident-drawer-handoff">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow id="resident-drawer-handoff">Last handoff</Eyebrow>
          <OpenLink onClick={() => onOpenAgent("notebook")}>Notebook</OpenLink>
        </div>
        <div className="rounded-2xl bg-plate px-3 py-2.5">
          <p
            className="text-sm leading-6 text-ink-muted"
            data-testid="resident-drawer-handoff"
          >
            {continuity?.handoff
              ? continuity.handoff.summary || "No summary recorded."
              : continuity?.enabled === false
                ? "Continuity is off for this resident."
                : "No handoff has been recorded yet."}
          </p>
        </div>
      </section>

      <section>
        <button
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-plate px-3 py-2.5 text-left text-sm text-ink-muted transition-colors hover:bg-plate-hover hover:text-foreground focus-visible:bg-plate-hover focus-visible:text-foreground focus-visible:outline-hidden"
          data-testid="resident-drawer-open-agent"
          onClick={() => onOpenAgent("documents")}
          type="button"
        >
          <span>Open {agent.name}</span>
          <ArrowUpRight className="h-4 w-4 text-ink-faint" />
        </button>
      </section>
    </div>
  );
}

// Matches the conversation drawer's section titles: the UI face at small size
// and low ink. Hierarchy by size and opacity, never by a second typeface.
function Eyebrow({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h3
      className="mb-2 text-2xs font-medium uppercase tracking-caps text-ink-faint"
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
      className="mb-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-hidden"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
