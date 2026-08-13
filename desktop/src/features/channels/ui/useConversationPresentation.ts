import * as React from "react";
import { useChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import { useChannelWorkingAgentPubkeys } from "@/features/agents/agentWorkingSignal";
import type { ConversationActivityState } from "@/features/channels/ui/conversationAgentActivityShelf";
import { useManagedPresentationActivity } from "@/features/messages/managedPresentationHooks";
import { hydrateManagedOperationalStatuses } from "@/features/messages/managedPresentationStore";
import { listManagedConversationOperationalStatus } from "@/shared/api/agentControl";

/**
 * Joins durable turn activity with process-memory presentation streams for one
 * conversation. Public response bodies subscribe inside their own timeline
 * rows, so this hook deliberately never observes per-chunk presentation text.
 */
export function useConversationPresentation(channelId: string | null) {
  const [restartReceipts, setRestartReceipts] = React.useState<Set<string>>(
    () => new Set(),
  );
  const composerWorkingBotPubkeys = useChannelWorkingAgentPubkeys(channelId);
  const agentActivityRows = useChannelAgentActivity(channelId);
  const managedActivity = useManagedPresentationActivity(channelId);
  React.useEffect(() => {
    setRestartReceipts(new Set());
    if (!channelId) return;
    let current = true;
    void listManagedConversationOperationalStatus(channelId)
      .then((statuses) => {
        if (!current) return;
        hydrateManagedOperationalStatuses(channelId, statuses);
        setRestartReceipts(
          new Set(statuses.map((status) => status.dispatchReceiptId)),
        );
      })
      .catch(() => {
        // This body-free history is additive presentation context. Live
        // messaging and ordinary text sending stay available if it cannot load.
      });
    return () => {
      current = false;
    };
  }, [channelId]);
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
        activity.phase === "needs_attention" &&
          [...restartReceipts].some((receipt) =>
            activity.uiKey.endsWith(`:${receipt}`),
          )
          ? "interrupted"
          : activity.phase === "failed" || activity.phase === "needs_attention"
            ? "needs-attention"
            : activity.phase,
      );
    }
    return states;
  }, [managedActivity, restartReceipts]);
  return {
    agentActivityRows,
    composerWorkingBotPubkeys,
    managedActivity,
    pendingActivityByPubkey,
    presentationStateByPubkey,
  };
}
