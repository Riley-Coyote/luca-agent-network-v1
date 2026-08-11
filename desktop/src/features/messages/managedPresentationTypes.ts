import type { ManagedResponseSurface } from "@/features/messages/lib/managedAudience";

export type ManagedPresentationKind =
  | "turn_started"
  | "phase"
  | "public_chunk"
  | "completed"
  | "cancelled"
  | "failed";

export type ManagedPresentationWirePhase =
  | "thinking"
  | "working"
  | "writing"
  | "finalizing";

export type ManagedPresentationDisplayPhase =
  | ManagedPresentationWirePhase
  | "stopping"
  | "stopped"
  | "needs_attention"
  | "failed";

export type ManagedPresentationFailure =
  | "runtime"
  | "publication"
  | "unavailable";

export type ManagedFinalReconciliation =
  | "equal"
  | "signed_extends_stream"
  | "stream_extends_signed"
  | "divergent";

/**
 * Renderer-only state for one managed response. Public bodies and local
 * placement data never leave process memory or become relay/outbox records.
 */
export type ManagedPresentationTurn = {
  anchorAt: number;
  conversationId: string;
  dispatchReceiptId: string;
  durableReceiptId: string | null;
  failure: ManagedPresentationFailure | null;
  finalMessageId: string | null;
  finalReconciliation: ManagedFinalReconciliation | null;
  lastFrameAt: number;
  phase: ManagedPresentationDisplayPhase;
  receivedText: string;
  residentPubkey: string;
  responseSurface: ManagedResponseSurface;
  sequence: number;
  sessionEpoch: number;
  slotOrdinal: number | null;
  turnId: string;
  uiKey: string;
  visibleText: string;
};

/** Stable virtualized timeline identity from first public text to signed final. */
export type ManagedResponseSlot = {
  anchorKey: string | null;
  conversationId: string;
  finalMessageId: string | null;
  residentPubkey: string;
  responseSurface: ManagedResponseSurface;
  slotOrdinal: number;
  uiKey: string;
};

export type RawManagedPresentationFrame = {
  protocol: "luca.managed.presentation.v1";
  kind: ManagedPresentationKind;
  resident_pubkey: string;
  conversation_id: string;
  turn_id: string;
  dispatch_receipt_id: string;
  session_epoch: number;
  sequence: number;
  phase?: ManagedPresentationWirePhase;
  public_chunk?: string;
  failure?: ManagedPresentationFailure;
};

export function managedPresentationUiKey(
  residentPubkey: string,
  dispatchReceiptId: string,
): string {
  return `managed:${residentPubkey.toLowerCase()}:${dispatchReceiptId}`;
}
