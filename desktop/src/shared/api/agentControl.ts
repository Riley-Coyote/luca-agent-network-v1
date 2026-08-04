import { invokeTauri } from "@/shared/api/tauri";
import { sendAgentObserverControl } from "@/shared/api/observerRelay";
import type {
  CancelManagedAgentTurnResult,
  CancellableManagedTurn,
} from "@/shared/api/types";

export async function listCancellableManagedTurns(
  channelId: string,
): Promise<CancellableManagedTurn[]> {
  return invokeTauri<CancellableManagedTurn[]>(
    "list_cancellable_managed_turns",
    { conversationId: channelId },
  );
}

export async function cancelManagedAgentTurn(
  pubkey: string,
  channelId: string,
  exact?: Pick<CancellableManagedTurn, "dispatchReceiptId" | "sessionEpoch">,
): Promise<CancelManagedAgentTurnResult> {
  return invokeTauri<CancelManagedAgentTurnResult>("cancel_managed_turn", {
    conversationId: channelId,
    residentPubkey: pubkey,
    dispatchReceiptId: exact?.dispatchReceiptId ?? null,
    sessionEpoch: exact?.sessionEpoch ?? null,
  });
}

/**
 * Send a live model-switch control frame to a running agent. The switch rides
 * the harness's cancel-switch-requeue path (busy turn) or invalidate-and-reapply
 * (idle); the outcome arrives asynchronously as a `control_result` observer
 * frame, not as the return value here. This is fire-and-forget on the send side.
 */
export async function switchManagedAgentModel(
  pubkey: string,
  channelId: string,
  modelId: string,
): Promise<void> {
  await sendAgentObserverControl(pubkey, {
    type: "switch_model",
    channelId,
    modelId,
  });
}
