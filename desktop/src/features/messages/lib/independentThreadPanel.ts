import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import { buildThreadPanelData } from "@/features/messages/lib/threadPanel";
import { getThreadReference } from "@/features/messages/lib/threading";
import type { RelayEvent } from "@/shared/api/types";

/**
 * Resolve the canonical relay query root for a selected conversation row.
 *
 * Broadcast replies remain visible in the room timeline and can therefore be
 * selected as focused thread heads, but the relay stores every descendant
 * under the original NIP-10 root. Keep the selected head as the presentation
 * anchor while fetching and caching against that canonical root.
 */
export function resolveThreadQueryRootId(
  channelEvents: RelayEvent[],
  selectedHeadId: string | null,
): string | null {
  if (!selectedHeadId) return null;
  const selectedHead = channelEvents.find(
    (event) => event.id === selectedHeadId,
  );
  if (!selectedHead) return selectedHeadId;
  return getThreadReference(selectedHead.tags).rootId ?? selectedHead.id;
}

export function buildIndependentThreadPanel(
  channelEvents: RelayEvent[],
  replyEvents: RelayEvent[],
  rootId: string | null,
  replyTargetId: string | null,
  expandedReplyIds: ReadonlySet<string>,
  ...formatArgs: Tail<Parameters<typeof formatTimelineMessages>>
) {
  if (!rootId) {
    return buildThreadPanelData([], null, replyTargetId, expandedReplyIds);
  }
  const head = channelEvents.find((event) => event.id === rootId);
  // A canonical-root fetch includes a selected depth>0 head in its reply set.
  // Prefer the room's copy of the visible head and avoid formatting it twice;
  // buildThreadPanelData will project only descendants anchored at `rootId`.
  const events = head
    ? [head, ...replyEvents.filter((event) => event.id !== rootId)]
    : replyEvents;
  return buildThreadPanelData(
    formatTimelineMessages(events, ...formatArgs),
    rootId,
    replyTargetId,
    expandedReplyIds,
  );
}

type Tail<T extends readonly unknown[]> = T extends readonly [
  unknown,
  ...infer R,
]
  ? R
  : never;
