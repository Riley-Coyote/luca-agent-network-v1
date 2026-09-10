import { managedDispatchReceiptIdFromTags } from "./managedPresentationProtocol";
import { completeManagedPresentationForConversation } from "./managedPresentationStore";
import type { RelayEvent } from "@/shared/api/types";
import { CHANNEL_TIMELINE_CONTENT_KINDS } from "@/shared/constants/kinds";

/** Settle retained turns from authenticated history after leaving a conversation. */
export function reconcileManagedHistoryFinals(
  conversationId: string,
  events: readonly RelayEvent[],
): void {
  for (const event of events) {
    if (
      !CHANNEL_TIMELINE_CONTENT_KINDS.some((kind) => kind === event.kind) ||
      !event.tags.some((tag) => tag[0] === "h" && tag[1] === conversationId)
    )
      continue;
    const receiptId = managedDispatchReceiptIdFromTags(event.tags);
    if (!receiptId) continue;
    completeManagedPresentationForConversation(
      event.pubkey,
      receiptId,
      conversationId,
      event.id,
      event.content,
    );
  }
}
