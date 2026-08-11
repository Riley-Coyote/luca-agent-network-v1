import * as React from "react";
import { useChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import { useChannelWorkingAgentPubkeys } from "@/features/agents/agentWorkingSignal";
import type { ConversationActivityState } from "@/features/channels/ui/conversationAgentActivityShelf";
import { useManagedPresentationActivity } from "@/features/messages/managedPresentationHooks";

/**
 * Joins durable turn activity with process-memory presentation streams for one
 * conversation. Public response bodies subscribe inside their own timeline
 * rows, so this hook deliberately never observes per-chunk presentation text.
 */
export function useConversationPresentation(channelId: string | null) {
  const composerWorkingBotPubkeys = useChannelWorkingAgentPubkeys(channelId);
  const agentActivityRows = useChannelAgentActivity(channelId);
  const managedActivity = useManagedPresentationActivity(channelId);
  const pendingActivityByPubkey = React.useMemo(
    () =>
      new Map(agentActivityRows.map((row) => [row.agentPubkey, row.activity])),
    [agentActivityRows],
  );
  const presentationStateByPubkey = React.useMemo(() => {
    const states = new Map<string, ConversationActivityState>();
    for (const [pubkey, activity] of managedActivity) {
      states.set(
        pubkey,
        activity.phase === "failed" || activity.phase === "needs_attention"
          ? "needs-attention"
          : activity.phase,
      );
    }
    return states;
  }, [managedActivity]);
  return {
    agentActivityRows,
    composerWorkingBotPubkeys,
    managedActivity,
    pendingActivityByPubkey,
    presentationStateByPubkey,
  };
}
