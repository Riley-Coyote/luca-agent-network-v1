import * as React from "react";
import { ArrowUpRight } from "lucide-react";

import { agentStateWord } from "@/app/shell/placeRails/placePicks";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import {
  managedAgentSummary,
  residentSourceLabel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { getResidentPlace } from "@/shared/api/tauriResidentPlace";
import type { ManagedAgent } from "@/shared/api/types";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";

/**
 * An agent's profile card under the shell (SHELL_BUILD.md WP-13, Decided 8):
 * a short summary (their mark, name and state, the first line of their
 * introduction, their runtime) with Open their space. Their notebook and
 * memories live in their space now, so the card doesn't repeat them.
 */
export function UserProfilePanelAgentSummary({
  displayName,
  managedAgent,
  onOpenSpace,
}: {
  displayName: string;
  managedAgent: ManagedAgent;
  onOpenSpace: () => void;
}) {
  const resident = managedAgentSummary(managedAgent);
  // The state word the Agents rail and their space say (agentStateWord).
  const working = useAgentWorking(managedAgent.pubkey).working;
  const word = agentStateWord({
    availability: resident.availability,
    lastError: managedAgent.lastError,
    waking: Boolean(managedAgent.waking),
    working,
  });
  const intro = useIntroductionFirstLine(
    managedAgent.backend.type === "local" ? managedAgent.pubkey : null,
  );
  return (
    <section
      className="space-y-4 border-b border-border/55 pb-5"
      data-testid="profile-agent-summary"
    >
      <div className="flex items-center gap-3">
        <AgentIdentitySpecimen
          accessibleName={displayName}
          avatarUrl={managedAgent.avatarUrl}
          motion="ambient"
          publicKey={managedAgent.pubkey}
          size={44}
          state={
            managedAgent.lastError
              ? "fault"
              : managedAgent.status === "running" ||
                  managedAgent.status === "deployed"
                ? "present"
                : "idle"
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="truncate text-base font-medium">{displayName}</h2>
            <span
              className="shrink-0 text-2xs text-muted-foreground"
              data-testid="profile-agent-summary-state"
            >
              {word.charAt(0).toUpperCase() + word.slice(1)}
            </span>
          </div>
          <p
            className="mt-1 truncate text-xs text-muted-foreground"
            data-testid="profile-agent-summary-runtime"
          >
            {[residentSourceLabel(resident), resident.modelLabel]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      {intro ? (
        <p
          className="text-sm leading-6 text-foreground"
          data-testid="profile-agent-summary-intro"
        >
          {intro}
        </p>
      ) : null}
      <Button
        className="w-full justify-between"
        data-testid="profile-open-their-space"
        onClick={onOpenSpace}
        variant="outline"
      >
        Open their space <ArrowUpRight />
      </Button>
    </section>
  );
}

/** The first line of their introduction, for a mind on this Mac. */
function useIntroductionFirstLine(pubkey: string | null): string | null {
  const [line, setLine] = React.useState<string | null>(null);
  React.useEffect(() => {
    setLine(null);
    if (!pubkey) return;
    let cancelled = false;
    void getResidentPlace(pubkey)
      .then((place) => {
        if (cancelled) return;
        const first =
          place.content.introduction
            .split("\n")
            .map((each) => each.trim())
            .find(Boolean) ?? null;
        setLine(first);
      })
      .catch(() => {
        // No place for this mind here: the line hides.
      });
    return () => {
      cancelled = true;
    };
  }, [pubkey]);
  return line;
}
