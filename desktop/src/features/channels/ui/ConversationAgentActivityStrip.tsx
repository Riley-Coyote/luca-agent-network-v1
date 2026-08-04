import type { BotActivityAgent } from "@/features/channels/ui/BotActivityBar";
import type { ChannelAgentSessionAgent } from "@/features/channels/ui/useChannelAgentSessions";
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
  const working = new Set(workingPubkeys.map(normalizePubkey));
  const sessions = new Map(
    sessionAgents.map((agent) => [normalizePubkey(agent.pubkey), agent]),
  );

  if (agents.length <= 1 && working.size === 0) return null;

  return (
    <div aria-label="Resident agent state" data-luca-agent-strip>
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
    </div>
  );
}
