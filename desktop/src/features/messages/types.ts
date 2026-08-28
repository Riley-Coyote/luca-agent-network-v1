export type TimelineReaction = {
  emoji: string;
  /** Custom (image) emoji URL from the reaction's NIP-30 `emoji` tag, if any. */
  emojiUrl?: string;
  count: number;
  reactedByCurrentUser?: boolean;
  users: Array<{
    pubkey: string;
    displayName: string;
    avatarUrl: string | null;
  }>;
};

export type TimelineMessage = {
  id: string;
  /** Stable local key used to avoid remounting optimistic rows on send ack. */
  renderKey?: string;
  createdAt: number;
  pubkey?: string;
  /**
   * Raw signer pubkey (`event.pubkey`), normalized to lowercase hex.
   * Distinct from `pubkey`, which may be a delegated author on an event signed
   * by the active relay. Use this field for checks that require the process or
   * user that cryptographically signed the event.
   */
  signerPubkey?: string;
  author: string;
  /** True when the displayed author is known to be an agent. */
  isAgent?: boolean;
  /** Verified owner pubkey for an agent author, when available. */
  ownerPubkey?: string | null;
  /** Viewer-relative owner label (for example, "you" or "baxen"). */
  ownerLabel?: string | null;
  avatarUrl?: string | null;
  role?: string;
  /** For bot messages, the display name of the persona this bot was created from. */
  personaDisplayName?: string;
  /** Trusted managed persona identifier used only to resolve resident identity marks. */
  residentPersonaId?: string | null;
  /** For bot messages, the respond-to mode (who can interact with this bot). */
  respondTo?: "owner-only" | "allowlist" | "anyone";
  time: string;
  body: string;
  parentId?: string | null;
  rootId?: string | null;
  depth: number;
  accent?: boolean;
  pending?: boolean;
  /** The optimistic owner message was rejected and can be retried in place. */
  sendFailed?: boolean;
  edited?: boolean;
  highlighted?: boolean;
  kind?: number;
  tags?: string[][];
  reactions?: TimelineReaction[];
  /** Process-memory presentation state for a managed response row. */
  managedPresentation?: {
    canonicalPresent: boolean;
    failure: "runtime" | "publication" | "unavailable" | null;
    finalReconciliation:
      | "equal"
      | "signed_extends_stream"
      | "stream_extends_signed"
      | "divergent"
      | null;
    finalMessageId: string | null;
    phase:
      | "waking"
      | "thinking"
      | "working"
      | "writing"
      | "finalizing"
      | "stopping"
      | "stopped"
      | "needs_attention"
      | "failed";
    /** True while public graphemes are still being revealed in this row. */
    streaming: boolean;
    uiKey: string;
    /** Plain phrase for what the resident is doing while no text has arrived
     *  yet — "thinking", "reading files" — shown beside the name. */
    activityLabel?: string;
  };
};
