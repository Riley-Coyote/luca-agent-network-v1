import type { ConversationEffortSelection } from "@/features/thinking/useConversationEffort";

export type MessageComposerSendContext = {
  parentEventId: string | null;
  threadHeadId: string | null;
  replyAuthorPubkey?: string | null;
  /** Local-only draft cleanup that follows the send through an in-place retry. */
  onAccepted?: () => void;
  /** Local settings captured before asynchronous recipient preparation. */
  conversationEfforts?: ConversationEffortSelection[];
  onEffortSent?: (eventId: string, residentPubkeys: string[]) => void;
};
