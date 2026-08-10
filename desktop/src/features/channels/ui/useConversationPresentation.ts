import * as React from "react";
import { useChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import { useChannelWorkingAgentPubkeys } from "@/features/agents/agentWorkingSignal";
import {
  type ManagedPresentationRow,
  useManagedPresentations,
} from "@/features/messages/managedPresentationStore";
import { cancelManagedAgentTurn } from "@/shared/api/agentControl";

/**
 * Joins durable turn activity with process-memory presentation streams for one
 * conversation. A provisional stream wins over the observer fallback so a
 * resident is represented by exactly one working row.
 */
export function useConversationPresentation(channelId: string | null) {
  const composerWorkingBotPubkeys = useChannelWorkingAgentPubkeys(channelId);
  const agentActivityRows = useChannelAgentActivity(channelId);
  const provisionalRows = useManagedPresentations(channelId);
  const provisionalPubkeys = React.useMemo(
    () => new Set(provisionalRows.map((row) => row.residentPubkey)),
    [provisionalRows],
  );
  const pendingReplyRows = React.useMemo(
    () =>
      agentActivityRows.filter(
        (row) => !provisionalPubkeys.has(row.agentPubkey.toLowerCase()),
      ),
    [agentActivityRows, provisionalPubkeys],
  );
  const pendingActivityByPubkey = React.useMemo(
    () =>
      new Map(agentActivityRows.map((row) => [row.agentPubkey, row.activity])),
    [agentActivityRows],
  );
  const handleCancelPendingReply = React.useCallback(
    (agentPubkey: string) => {
      if (!channelId) return;
      void cancelManagedAgentTurn(agentPubkey, channelId);
    },
    [channelId],
  );
  const handleCancelProvisionalResponse = React.useCallback(
    (row: ManagedPresentationRow) => {
      if (!channelId) return;
      void cancelManagedAgentTurn(
        row.residentPubkey,
        channelId,
        row.sessionEpoch > 0
          ? {
              dispatchReceiptId: row.dispatchReceiptId,
              sessionEpoch: row.sessionEpoch,
            }
          : undefined,
      );
    },
    [channelId],
  );

  return {
    agentActivityRows,
    composerWorkingBotPubkeys,
    handleCancelPendingReply,
    handleCancelProvisionalResponse,
    hasComposerBotActivity: composerWorkingBotPubkeys.length > 0,
    pendingActivityByPubkey,
    pendingReplyRows,
    provisionalRows,
  };
}
