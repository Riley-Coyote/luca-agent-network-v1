/** Public work records only: never raw observer frames or thought chunks. */
export type ActivityTraceEntry = {
  id: string;
  sequence: number;
  /** `permission` records one owner decision about what the resident may do. */
  kind: "activity" | "narration" | "permission";
  /** Redacted owner-visible text. */
  text: string;
  /** Shared-room projection, with private command arguments and paths omitted. */
  roomText: string;
  status: "active" | "done" | "failed";
};

/** Exact dispatch identity and local durable history for a resident's work. */
export type ActivityTrace = {
  conversationId: string;
  residentPubkey: string;
  dispatchReceiptId: string;
  turnId: string;
  finalMessageId: string | null;
  anchorMessageId?: string | null;
  threadRootId?: string | null;
  responseSurface?: "timeline" | "thread";
  /** Desktop clock, Unix milliseconds. */
  startedAt: number;
  endedAt: number | null;
  status: "working" | "completed" | "cancelled" | "failed" | "interrupted";
  entries: readonly ActivityTraceEntry[];
  truncated: boolean;
};

/** Both live rows and signed finals resolve the same immutable dispatch. */
export type ActivityTraceLookup = {
  conversationId: string;
  residentPubkey: string;
  dispatchReceiptId?: string | null;
  finalMessageId?: string | null;
};
