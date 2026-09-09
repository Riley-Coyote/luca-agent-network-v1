import * as React from "react";
import { Plus } from "lucide-react";

import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import {
  RAIL_CONTROL_CLASS,
  RAIL_ROW_CLASS,
  UNREAD_DOT_CLASS,
} from "@/features/sidebar/ui/ChatList";
import { cn } from "@/shared/lib/cn";

/**
 * The AGENTS section of the rail: one row per resident, not one per chat.
 * A resident is someone you have a relationship with; the chats are where it
 * happened. Choosing a row opens the agent column beside the rail, which
 * lists every conversation that resident is part of.
 */
export type AgentRailAgent = {
  name: string;
  personaId?: string | null;
  pubkey: string;
};

export type AgentRailActivity = {
  /** Newest message in any chat with this resident, as a rail label. */
  recent: string;
  unread: boolean;
};

// Memoised so a column toggle (which changes only `selectedAgentPubkey`)
// re-renders these few rows and nothing beside them.
export const AgentRail = React.memo(function AgentRail({
  activityByPubkey,
  agents,
  onCreateAgent,
  onSelectAgent,
  selectedAgentPubkey,
}: {
  activityByPubkey: ReadonlyMap<string, AgentRailActivity>;
  agents: readonly AgentRailAgent[];
  onCreateAgent: () => void;
  onSelectAgent: (pubkey: string) => void;
  selectedAgentPubkey: string | null;
}) {
  return (
    <div className="mt-3 flex flex-col" data-testid="chat-direct-messages">
      <div className="flex items-center justify-between px-2 pb-1 text-2xs font-medium uppercase tracking-caps-wide text-ink-faint">
        <span>Agents</span>
        <button
          aria-label="New agent"
          className={cn(RAIL_CONTROL_CLASS, "-mr-1 size-6")}
          data-testid="create-direct-message"
          onClick={onCreateAgent}
          title="New agent"
          type="button"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {agents.map((agent) => {
        const key = agent.pubkey.toLowerCase();
        const isActive = selectedAgentPubkey?.toLowerCase() === key;
        const activity = activityByPubkey.get(key);
        const isUnread = Boolean(activity?.unread) && !isActive;
        return (
          <button
            aria-label={isUnread ? `${agent.name}, unread` : agent.name}
            aria-pressed={isActive}
            className={RAIL_ROW_CLASS}
            data-active={isActive ? "true" : undefined}
            data-sidebar="menu-button"
            data-testid={`agent-rail-${agent.name.toLowerCase()}`}
            key={agent.pubkey}
            onClick={() => onSelectAgent(agent.pubkey)}
            type="button"
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-muted group-data-[active=true]:text-foreground">
              <ResidentIdentityMark
                accessibleName={agent.name}
                decorative
                personaId={agent.personaId}
                presentation="glyph"
                publicKey={agent.pubkey}
                size={12}
              />
            </span>
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm",
                isUnread && "font-medium text-sidebar-foreground",
              )}
            >
              <span className="truncate">{agent.name}</span>
            </span>
            <span className="flex shrink-0 justify-end">
              {isUnread ? (
                <span aria-hidden className={UNREAD_DOT_CLASS} />
              ) : (
                <span className="text-2xs tabular-nums text-ink-faint">
                  {activity?.recent ?? ""}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
});
