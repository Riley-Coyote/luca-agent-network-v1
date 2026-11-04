import { exchangeIdFromTags } from "@/features/exchange/exchangeTags";
import { getChannelIdFromTags } from "@/features/messages/lib/threading";
import type { AgentInboxPage } from "@/shared/api/agentInbox";
import type { RelayEvent, SearchHit } from "@/shared/api/types";

/** Resolve an existing search hit through canonical event and native task ACL. */
export async function resolveInboxSearchTask(
  hit: SearchHit,
  getEvent: (id: string) => Promise<RelayEvent>,
  queryInbox: (query: {
    exchangeId: string;
    limit: number;
  }) => Promise<AgentInboxPage>,
): Promise<string | null> {
  if (!hit.channelId) return null;
  try {
    const event = await getEvent(hit.eventId);
    if (
      event.id !== hit.eventId ||
      getChannelIdFromTags(event.tags) !== hit.channelId
    )
      return null;
    const exchangeId = exchangeIdFromTags(event.tags);
    if (!exchangeId) return null;
    const page = await queryInbox({ exchangeId, limit: 1 });
    const task = page.tasks.find(
      (task) => task.record.exchangeId === exchangeId,
    );
    if (
      !task?.correspondenceId ||
      task.record.members.length !== 2 ||
      task.record.conversationId !== hit.channelId ||
      task.record.owner !== page.scope.ownerPubkey ||
      !task.record.members.includes(event.pubkey)
    )
      return null;
    return exchangeId;
  } catch {
    // Existing channel deep-links remain usable when a pair is not available.
    return null;
  }
}
