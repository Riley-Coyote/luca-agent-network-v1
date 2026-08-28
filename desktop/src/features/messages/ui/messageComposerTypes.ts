export type MessageComposerSendContext = {
  parentEventId: string | null;
  threadHeadId: string | null;
  replyAuthorPubkey?: string | null;
  /** Local-only draft cleanup that follows the send through an in-place retry. */
  onAccepted?: () => void;
};
