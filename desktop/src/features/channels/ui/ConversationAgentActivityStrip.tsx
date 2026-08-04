import * as React from "react";
import { Square } from "lucide-react";
import { toast } from "sonner";

import type { BotActivityAgent } from "@/features/channels/ui/BotActivityBar";
import type { ChannelAgentSessionAgent } from "@/features/channels/ui/useChannelAgentSessions";
import { cancelManagedAgentTurn } from "@/shared/api/agentControl";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  AgentIdentitySpecimen,
  type AgentVisualState,
  shortAgentFingerprint,
} from "@/shared/ui/AgentIdentitySpecimen";

type ConversationAgentActivityStripProps = {
  agents: BotActivityAgent[];
  channelId: string | null;
  onOpenAgentSession: (pubkey: string, channelId?: string | null) => void;
  sessionAgents: ChannelAgentSessionAgent[];
  workingPubkeys: string[];
};

function resolveVisualState(
  agent: ChannelAgentSessionAgent | undefined,
  working: boolean,
): AgentVisualState {
  if (working) return "working";
  if (!agent || agent.status === "running" || agent.status === "deployed") {
    return "present";
  }
  return "unavailable";
}

export function ConversationAgentActivityStrip({
  agents,
  channelId,
  onOpenAgentSession,
  sessionAgents,
  workingPubkeys,
}: ConversationAgentActivityStripProps) {
  const [stopping, setStopping] = React.useState(false);
  const working = new Set(workingPubkeys.map(normalizePubkey));
  const sessions = new Map(
    sessionAgents.map((agent) => [normalizePubkey(agent.pubkey), agent]),
  );
  const cancellablePubkeys = [...working].filter((pubkey) =>
    sessions.has(pubkey),
  );

  async function stopConversationWork() {
    if (!channelId || cancellablePubkeys.length === 0 || stopping) return;
    setStopping(true);
    const results = await Promise.allSettled(
      cancellablePubkeys.map((pubkey) =>
        cancelManagedAgentTurn(pubkey, channelId),
      ),
    );
    const completed = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof cancelManagedAgentTurn>>
      > => result.status === "fulfilled",
    );
    const ambiguous = completed.filter(
      (result) => result.value.status === "publication_ambiguous",
    ).length;
    const stopped = completed.length - ambiguous;
    const failed = results.length - completed.length;
    if (stopped > 0) {
      toast.success(
        stopped === 1
          ? "Stopped the active resident."
          : `Stopped ${stopped} active residents.`,
      );
    }
    if (ambiguous > 0) {
      toast.warning(
        ambiguous === 1
          ? "One resident was stopped, but an in-flight final response may still arrive."
          : `${ambiguous} residents were stopped with final responses already in flight.`,
      );
    }
    if (failed > 0) {
      toast.error(
        failed === 1
          ? "One resident could not be stopped."
          : `${failed} residents could not be stopped.`,
      );
    }
    setStopping(false);
  }

  if (agents.length <= 1 && working.size === 0) return null;

  return (
    <section aria-label="Resident agent state" data-luca-agent-strip>
      {agents.map((agent) => {
        const key = normalizePubkey(agent.pubkey);
        const state = resolveVisualState(sessions.get(key), working.has(key));
        return (
          <button
            className="group flex min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
            key={key}
            onClick={() => onOpenAgentSession(agent.pubkey, channelId)}
            type="button"
          >
            <AgentIdentitySpecimen
              accessibleName={agent.name}
              publicKey={agent.pubkey}
              size={20}
              state={state}
            />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-foreground/80 group-hover:text-foreground">
                {agent.name}
              </span>
              <span className="block" data-luca-agent-state>
                {state} · {shortAgentFingerprint(agent.pubkey)}
              </span>
            </span>
          </button>
        );
      })}
      {cancellablePubkeys.length > 0 ? (
        <button
          aria-label="Stop all active residents in this conversation"
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          disabled={stopping || !channelId}
          onClick={() => void stopConversationWork()}
          type="button"
        >
          <Square aria-hidden="true" className="h-3 w-3" />
          {stopping ? "Stopping" : "Stop"}
        </button>
      ) : null}
    </section>
  );
}
