import { invoke } from "@tauri-apps/api/core";

export type ManagedTurnContextReceiptInput = {
  conversationId: string;
  residentPubkey: string;
  dispatchReceiptId: string;
};

export type ManagedTurnContextLayerStatus =
  | "ready"
  | "empty"
  | "denied"
  | "stale"
  | "locked"
  | "unavailable"
  | "timeout"
  | "invalid";

/**
 * Body-free, exact-turn delivery evidence. `deliveredToAcp` proves that the
 * local desktop bridge wrote the prepared context packet to managed ACP. It
 * does not prove a model consumed a packet, read an attached file, or used a
 * source in its response.
 */
export type ManagedTurnContextReceipt = {
  availability: "available" | "unavailable";
  unavailableReason:
    | "missing_dispatch"
    | "wrong_scope"
    | "not_attached"
    | "not_delivered"
    | null;
  attachment: {
    snapshotRef: string;
    revision: number;
    sourceIds: string[];
  } | null;
  sessionContext: {
    status: "ready" | "degraded";
    deliveredToAcp: true;
    attachedSessionReferenceDelivered: boolean;
  } | null;
  continuity: {
    status: ManagedTurnContextLayerStatus;
    layerStatuses: ManagedTurnContextLayerStatus[];
    deliveredToAcp: true;
  } | null;
};

export function getManagedTurnContextReceipt(
  input: ManagedTurnContextReceiptInput,
): Promise<ManagedTurnContextReceipt> {
  return invoke("get_managed_turn_context_receipt", { input });
}
