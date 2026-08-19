import { maxReadAt } from "@/features/channels/readState/readStateFormat";

export type ObservedUnreadEvent = {
  id: string;
  createdAt: number;
  rootId: string | null;
  highPriority: boolean;
  countsTowardBadge: boolean;
  countsTowardAppBadge: boolean;
};

export function makeObservedUnreadEvent(input: {
  id: string;
  createdAt: number;
  rootId: string | null;
  highPriority: boolean;
  channelType: string | undefined;
  isThreadedReply: boolean;
  /**
   * A resident-authored turn inside an exchange (it carries the
   * `["exchange", <id>, <turn>]` tag). Residents talking to each other is
   * speech the owner can watch, not a summons: the volley is still recorded —
   * so the room keeps its quiet unread dot — but it badges nothing, here or on
   * the app icon. What does ask for the owner is the exchange PAUSING, and
   * that is derived from the exchange itself, not from any one message.
   *
   * This overrides the `isDm` short-circuit below: a volley in a DM must not
   * badge either.
   */
  isExchangeVolley?: boolean;
}): ObservedUnreadEvent {
  const isDm = input.channelType === "dm";
  const isExchangeVolley = input.isExchangeVolley === true;
  return {
    id: input.id,
    createdAt: input.createdAt,
    rootId: input.rootId,
    highPriority: input.highPriority,
    countsTowardBadge:
      !isExchangeVolley &&
      (isDm || input.isThreadedReply || input.highPriority),
    countsTowardAppBadge:
      !isExchangeVolley &&
      (isDm || (!input.isThreadedReply && input.highPriority)),
  };
}

export function mapsEqual(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

export function recordObservedUnreadEvent(
  eventsByChannel: Map<string, Map<string, ObservedUnreadEvent>>,
  channelId: string,
  event: ObservedUnreadEvent,
  limit: number,
): boolean {
  let eventsById = eventsByChannel.get(channelId);
  if (!eventsById) {
    eventsById = new Map<string, ObservedUnreadEvent>();
    eventsByChannel.set(channelId, eventsById);
  }
  if (eventsById.has(event.id)) return false;

  eventsById.set(event.id, event);
  if (eventsById.size <= limit) return true;

  const oldest = [...eventsById.values()].sort(
    (a, b) => a.createdAt - b.createdAt,
  )[0]?.id;
  if (oldest) {
    eventsById.delete(oldest);
  }
  return true;
}

export function countUnreadObservedEvents(
  eventsById: ReadonlyMap<string, ObservedUnreadEvent> | undefined,
  getReadAt: (event: ObservedUnreadEvent) => number | null,
): number {
  if (!eventsById) return 0;
  let count = 0;
  for (const event of eventsById.values()) {
    const readAt = getReadAt(event);
    if (readAt === null || event.createdAt > readAt) count += 1;
  }
  return count;
}

export function countUnreadBadgeObservedEvents(
  eventsById: ReadonlyMap<string, ObservedUnreadEvent> | undefined,
  getReadAt: (event: ObservedUnreadEvent) => number | null,
): number {
  if (!eventsById) return 0;
  let count = 0;
  for (const event of eventsById.values()) {
    if (!event.countsTowardBadge) continue;
    const readAt = getReadAt(event);
    if (readAt === null || event.createdAt > readAt) count += 1;
  }
  return count;
}

export function countUnreadAppBadgeObservedEvents(
  eventsById: ReadonlyMap<string, ObservedUnreadEvent> | undefined,
  getReadAt: (event: ObservedUnreadEvent) => number | null,
): number {
  if (!eventsById) return 0;
  let count = 0;
  for (const event of eventsById.values()) {
    if (!event.countsTowardAppBadge) continue;
    const readAt = getReadAt(event);
    if (readAt === null || event.createdAt > readAt) count += 1;
  }
  return count;
}

export function countUnreadHighPriorityObservedEvents(
  eventsById: ReadonlyMap<string, ObservedUnreadEvent> | undefined,
  getReadAt: (event: ObservedUnreadEvent) => number | null,
): number {
  if (!eventsById) return 0;
  let count = 0;
  for (const event of eventsById.values()) {
    if (!event.highPriority) continue;
    const readAt = getReadAt(event);
    if (readAt === null || event.createdAt > readAt) count += 1;
  }
  return count;
}

export function observedUnreadEventReadAt(
  event: ObservedUnreadEvent,
  channelReadAt: number | null,
  getThreadOwnMarker: (rootId: string) => number | null,
  getMessageOwnMarker: (messageId: string) => number | null = () => null,
): number | null {
  const markers = [channelReadAt, getMessageOwnMarker(event.id)];

  if (event.rootId !== null) {
    markers.push(getThreadOwnMarker(event.rootId));
  }

  return maxReadAt(...markers);
}
