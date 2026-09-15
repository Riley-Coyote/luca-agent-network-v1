import * as React from "react";

import type { TimelineMessage } from "@/features/messages/types";
import type {
  Channel,
  ChannelMember,
  ManagedAgent,
  RelayAgent,
} from "@/shared/api/types";
import { usePanelReturnTarget } from "@/shared/hooks/usePanelReturnTarget";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { resolveIdentityDisplayName } from "@/features/profile/lib/identity";
import {
  type AgentSessionReturnTarget,
  resolveAgentSessionReturnTarget,
} from "./agentSessionSelection";
import type { PanelStateSetter } from "./useChannelPanelHistoryState";

export type ChannelAgentSessionAgent = Pick<
  ManagedAgent,
  "pubkey" | "name" | "status"
> & {
  agentSource: "managed" | "member-bot" | "relay";
  canInterruptTurn: boolean;
  channelIds?: string[];
  channels?: string[];
};

type UseChannelAgentSessionsOptions = {
  activeChannel: Channel | null;
  activeChannelId: string | null;
  agentsLoaded: boolean;
  /** Moves several panels in one navigation; see `buildPanelStatePatch`. */
  applyPanelState: PanelStateSetter;
  channelMembers?: ChannelMember[];
  handleOpenThread: (message: TimelineMessage) => void;
  managedAgents: ChannelAgentSessionAgent[];
  /** The members query has answered and is not refetching. */
  membersSettled: boolean;
  openAgentSessionPubkey: string | null;
  openThreadHeadId: string | null;
  profilePanelPubkey?: string | null;
  setExpandedThreadReplyIds: (value: Set<string>) => void;
  setThreadReplyTargetId: (value: string | null) => void;
  setThreadScrollTargetId: (value: string | null) => void;
};

function relayStatusToManagedStatus(
  status: RelayAgent["status"],
): ManagedAgent["status"] {
  return status === "offline" ? "stopped" : "deployed";
}

export function buildChannelAgentSessionCandidates({
  channelMembers,
  managedAgents,
  relayAgents,
}: {
  channelMembers?: ChannelMember[];
  managedAgents: ManagedAgent[];
  relayAgents: RelayAgent[];
}): ChannelAgentSessionAgent[] {
  const byPubkey = new Map<string, ChannelAgentSessionAgent>();

  for (const agent of relayAgents) {
    byPubkey.set(normalizePubkey(agent.pubkey), {
      pubkey: agent.pubkey,
      name: agent.name,
      status: relayStatusToManagedStatus(agent.status),
      agentSource: "relay",
      canInterruptTurn: false,
      channelIds: agent.channelIds,
      channels: agent.channels,
    });
  }

  for (const agent of managedAgents) {
    const key = normalizePubkey(agent.pubkey);
    const existing = byPubkey.get(key);
    byPubkey.set(key, {
      pubkey: agent.pubkey,
      name: agent.name,
      status: agent.status,
      agentSource: "managed",
      canInterruptTurn: true,
      channelIds: existing?.channelIds,
      channels: existing?.channels,
    });
  }

  for (const member of channelMembers ?? []) {
    const key = normalizePubkey(member.pubkey);
    if (member.role !== "bot" || byPubkey.has(key)) {
      continue;
    }

    byPubkey.set(key, {
      pubkey: member.pubkey,
      name: resolveIdentityDisplayName({
        displayName: member.displayName,
        isAgent: true,
        pubkey: member.pubkey,
      }),
      status: "deployed",
      agentSource: "member-bot",
      canInterruptTurn: false,
    });
  }

  return [...byPubkey.values()];
}

export function getChannelAgentSessionAgents({
  activeChannel,
  activeChannelId,
  agents,
  channelMembers,
}: {
  activeChannel: Channel | null;
  activeChannelId: string | null;
  agents: ChannelAgentSessionAgent[];
  channelMembers?: ChannelMember[];
}): ChannelAgentSessionAgent[] {
  if (!activeChannelId || !activeChannel) {
    return [];
  }

  const memberPubkeys = channelMembers
    ? new Set(channelMembers.map((member) => normalizePubkey(member.pubkey)))
    : null;
  const botMemberPubkeys = channelMembers
    ? new Set(
        channelMembers
          .filter((member) => member.role === "bot")
          .map((member) => normalizePubkey(member.pubkey)),
      )
    : null;

  return agents.filter((agent) => {
    const normalizedPubkey = normalizePubkey(agent.pubkey);
    const channelIds = agent.channelIds ?? [];
    const channels = agent.channels ?? [];
    const hasDeclaredChannelScope =
      channelIds.length > 0 || channels.length > 0;
    const matchesDeclaredChannel =
      channelIds.includes(activeChannelId) ||
      channels.includes(activeChannel.name);

    if (agent.agentSource === "member-bot") {
      return botMemberPubkeys?.has(normalizedPubkey) ?? matchesDeclaredChannel;
    }

    if (agent.agentSource === "managed") {
      return memberPubkeys?.has(normalizedPubkey) ?? matchesDeclaredChannel;
    }

    if (matchesDeclaredChannel) {
      return true;
    }

    return (
      !hasDeclaredChannelScope && Boolean(memberPubkeys?.has(normalizedPubkey))
    );
  });
}

/**
 * Whether an open `agentSession` param no longer names anyone in the room.
 *
 * An empty agent list can mean the queries behind it have not answered yet —
 * a reload restoring the param, or a membership refetch in flight while a
 * resident is being brought in or let go. Closing on that transient emptiness
 * rewrites the URL mid-arrival, which is a navigation the shell then has to
 * absorb. So both the agent queries and the members query must have settled
 * first; once they have, a room that legitimately has zero agents still closes
 * a stale param. A profile panel showing the same resident is not stale — the
 * session is that panel's own view.
 */
export function shouldCloseStaleAgentSession({
  agents,
  agentsLoaded,
  membersSettled,
  openAgentSessionPubkey,
  profilePanelPubkey,
}: {
  agents: readonly { pubkey: string }[];
  agentsLoaded: boolean;
  membersSettled: boolean;
  openAgentSessionPubkey: string | null;
  profilePanelPubkey?: string | null;
}): boolean {
  if (!openAgentSessionPubkey) return false;
  if (!agentsLoaded || !membersSettled) return false;
  const open = normalizePubkey(openAgentSessionPubkey);
  if (normalizePubkey(profilePanelPubkey ?? "") === open) return false;
  return !agents.some((agent) => normalizePubkey(agent.pubkey) === open);
}

export function useChannelAgentSessions({
  activeChannel,
  activeChannelId,
  agentsLoaded,
  applyPanelState,
  channelMembers,
  handleOpenThread,
  managedAgents,
  membersSettled,
  openAgentSessionPubkey,
  openThreadHeadId,
  profilePanelPubkey = null,
  setExpandedThreadReplyIds,
  setThreadReplyTargetId,
  setThreadScrollTargetId,
}: UseChannelAgentSessionsOptions) {
  const channelAgentSessionAgents = React.useMemo(
    () =>
      getChannelAgentSessionAgents({
        activeChannel,
        activeChannelId,
        agents: managedAgents,
        channelMembers,
      }),
    [activeChannel, activeChannelId, channelMembers, managedAgents],
  );
  const agentSessionAgents = managedAgents;

  // Breadcrumb for the Activity panel back arrow: captured on the
  // closed→open transition, consumed exactly once on back, cleared on any
  // other close so a stale target can't resurface later. Channel switches
  // drop it via the reset key.
  const { hasTarget: hasAgentSessionReturnTarget, store: returnTarget } =
    usePanelReturnTarget<AgentSessionReturnTarget>(activeChannelId);
  const isAgentSessionOpen = openAgentSessionPubkey != null;

  const closeAgentSession = React.useCallback(() => {
    returnTarget.clear();
    applyPanelState({ agentSession: null });
  }, [applyPanelState, returnTarget]);

  const openAgentSession = React.useCallback(
    (pubkey: string, channelId?: string | null) => {
      if (!isAgentSessionOpen) {
        returnTarget.capture(
          resolveAgentSessionReturnTarget({
            openThreadHeadId,
            profilePanelPubkey,
          }),
        );
      }
      setExpandedThreadReplyIds(new Set());
      setThreadScrollTargetId(null);
      setThreadReplyTargetId(null);
      // One arrangement, one navigation. `agentSessionChannel` falls back to
      // activeChannelId so opening from within a channel always scopes the
      // panel to that channel — even when no explicit channelId is supplied
      // (e.g. activity-list click). Without this, a null channelId bypasses
      // scopeByChannel and lets all channels' live frames through.
      applyPanelState({
        agentSession: pubkey,
        agentSessionChannel: channelId ?? activeChannelId ?? null,
        channelManagement: false,
        thread: null,
      });
    },
    [
      activeChannelId,
      applyPanelState,
      isAgentSessionOpen,
      openThreadHeadId,
      profilePanelPubkey,
      returnTarget,
      setExpandedThreadReplyIds,
      setThreadReplyTargetId,
      setThreadScrollTargetId,
    ],
  );

  // Back restores the pane the Activity panel replaced; with no recorded
  // target (opened from the composer with no pane, or a direct/restored
  // `agentSession` URL) it simply closes — never a blind history pop.
  const backFromAgentSession = React.useCallback(() => {
    const target = returnTarget.consume();
    applyPanelState({
      agentSession: null,
      ...(target?.kind === "thread" ? { thread: target.threadHeadId } : {}),
      ...(target?.kind === "profile" ? { profile: target.pubkey } : {}),
    });
  }, [applyPanelState, returnTarget]);

  const selectAgentSession = React.useCallback(
    (pubkey: string, channelId?: string | null) => {
      // Same fallback as openAgentSession: use activeChannelId when the caller
      // omits channelId, so the panel is always scoped to the current channel.
      applyPanelState({
        agentSession: pubkey,
        agentSessionChannel: channelId ?? activeChannelId ?? null,
      });
    },
    [activeChannelId, applyPanelState],
  );

  const openThreadAndCloseAgentSession = React.useCallback(
    (message: TimelineMessage) => {
      returnTarget.clear();
      applyPanelState({
        agentSession: null,
        channelManagement: false,
        profile: null,
      });
      handleOpenThread(message);
    },
    [applyPanelState, handleOpenThread, returnTarget],
  );

  React.useEffect(() => {
    if (
      !shouldCloseStaleAgentSession({
        agents: agentSessionAgents,
        agentsLoaded,
        membersSettled,
        openAgentSessionPubkey,
        profilePanelPubkey,
      })
    ) {
      return;
    }
    returnTarget.clear();
    applyPanelState({ agentSession: null }, { replace: true });
  }, [
    agentSessionAgents,
    agentsLoaded,
    applyPanelState,
    membersSettled,
    openAgentSessionPubkey,
    profilePanelPubkey,
    returnTarget,
  ]);

  return {
    agentSessionAgents,
    backFromAgentSession,
    channelAgentSessionAgents,
    /** Drop the Activity back-arrow breadcrumb without touching the URL, so a
     *  caller closing several panels can do it in one combined patch. */
    clearAgentSessionReturnTarget: returnTarget.clear,
    closeAgentSession,
    hasAgentSessionReturnTarget,
    openAgentSession,
    openAgentSessionPubkey,
    openThreadAndCloseAgentSession,
    selectAgentSession,
  };
}
