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
  /** Seeded locally when the resident's process was not running at send
   *  time and the desktop is starting it; the first wire frame replaces it. */
  | "waking"
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
 * What a resident is doing for its owner, in the owner's words.
 *
 * Full owner-visibility: anything an agent does for its owner may be shown to
 * that owner. What may never travel is the *body* of the work — a bare domain,
 * a path, a command, a count are the whole vocabulary. No prompts, no file
 * contents, no response payloads, no credentials.
 */
export type ManagedActivityKind =
  | "web"
  | "file"
  | "command"
  | "search"
  | "thinking"
  | "other";

export type ManagedActivityStatus = "active" | "done" | "failed";

export type ManagedTurnActivityStep = {
  /** 1-based ordinal within the turn. Lines sort by it and, once placed,
   *  never reorder — a late frame updates its line where it already sits. */
  step: number;
  kind: ManagedActivityKind;
  /** Human sentence, present tense while active: "Searching the web". */
  label: string;
  /** web → bare domain · file → path · command → the command string. */
  detail: string | null;
  status: ManagedActivityStatus;
  count: number | null;
};

/**
 * Renderer-only state for one managed response. Public bodies and local
 * placement data never leave process memory or become relay/outbox records.
 */
export type ManagedPresentationTurn = {
  /** Work narration accumulated across this turn's frames, in step order. */
  activitySteps: readonly ManagedTurnActivityStep[];
  anchorKey: string | null;
  anchorAt: number;
  bufferedText: string;
  conversationId: string;
  deadlineAt: number | null;
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
  signedText: string | null;
  sequence: number;
  sessionEpoch: number;
  slotOrdinal: number | null;
  /** Desktop-clock anchor for elapsed displays. Set once when the turn is
   *  seeded and never advanced by a later frame, so "how long have I waited"
   *  measures the owner's wait rather than the gap since the last frame. */
  startedAt: number;
  turnId: string;
  uiKey: string;
  visibleText: string;
};

/** Stable virtualized timeline identity from first public text to signed final. */
export type ManagedResponseSlot = {
  anchorAt: number;
  anchorKey: string | null;
  conversationId: string;
  finalMessageId: string | null;
  residentPubkey: string;
  responseSurface: ManagedResponseSurface;
  slotOrdinal: number;
  uiKey: string;
};

/** Stable activity-shelf projection; public response bodies are excluded. */
export type ManagedResidentActivity = {
  failure: ManagedPresentationFailure | null;
  handoffTargetName: string | null;
  phase: ManagedPresentationDisplayPhase;
  residentPubkey: string;
  /** A run whose answer already landed, kept only for its work summary. */
  settled: boolean;
  startedAt: number;
  steps: readonly ManagedTurnActivityStep[];
  uiKey: string;
};

export type ManagedConversationActivity = ReadonlyMap<
  string,
  ManagedResidentActivity
>;

/** Compatibility projection retained until every caller uses scoped turns. */
export type ManagedPresentationRow = {
  anchorAt: number;
  conversationId: string;
  dispatchReceiptId: string;
  failure: ManagedPresentationFailure | null;
  finalMessageId: string | null;
  phase:
    | "waking"
    | "thinking"
    | "working"
    | "writing"
    | "finalizing"
    | "cancelled"
    | "failed";
  publicText: string;
  residentPubkey: string;
  sequence: number;
  sessionEpoch: number;
  turnId: string;
};

/**
 * The activity object exactly as it arrives — every field unknown until it is
 * parsed. The desktop reads this defensively: an unknown kind becomes "other",
 * a missing label falls back to the phase word, and anything malformed is
 * dropped without disturbing the turn it rode in on.
 */
export type RawManagedPresentationActivity = {
  label?: unknown;
  kind?: unknown;
  detail?: unknown;
  status?: unknown;
  count?: unknown;
  step?: unknown;
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
  /** Optional everywhere. A frame without it behaves exactly as before. */
  activity?: RawManagedPresentationActivity;
};

export function managedPresentationUiKey(
  residentPubkey: string,
  dispatchReceiptId: string,
): string {
  return `managed:${residentPubkey.toLowerCase()}:${dispatchReceiptId}`;
}
