export type MessageComposerSendContext = {
  parentEventId: string | null;
  threadHeadId: string | null;
  replyAuthorPubkey?: string | null;
};
