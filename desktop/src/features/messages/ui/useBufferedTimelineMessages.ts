import * as React from "react";

function timelineIdentity(message: { id: string; renderKey?: string }): string {
  return message.renderKey ?? message.id;
}

/**
 * Keeps the logical tail stable while a reader is away from the bottom.
 *
 * Virtua remains the sole owner of mounting, measurement, and pixel anchoring.
 * This hook only controls when live output joins its keyed data model: older
 * history before the retained tail is admitted immediately, while newer output
 * is released atomically when the reader returns to the bottom.
 */
export function selectBufferedTimelineMessages<
  T extends { id: string; renderKey?: string },
>({
  frozenMessageIds,
  isAtBottom,
  messages,
}: {
  frozenMessageIds: readonly string[] | null;
  isAtBottom: boolean;
  messages: T[];
}): T[] {
  if (isAtBottom || frozenMessageIds === null) return messages;
  if (frozenMessageIds.length === 0) return [];

  const currentByIdentity = new Map(
    messages.map((message) => [timelineIdentity(message), message]),
  );
  if (frozenMessageIds.some((id) => !currentByIdentity.has(id))) {
    // A deletion or authoritative replacement removed part of the frozen
    // snapshot. Keeping stale message objects would be worse than accepting it.
    return messages;
  }

  const firstFrozenIndex = messages.findIndex(
    (message) => timelineIdentity(message) === frozenMessageIds[0],
  );
  const prepended = messages.slice(0, firstFrozenIndex);
  const frozen = frozenMessageIds.map((id) => currentByIdentity.get(id) as T);
  const buffered = [...prepended, ...frozen];
  if (
    buffered.length === messages.length &&
    buffered.every(
      (message, index) =>
        timelineIdentity(message) ===
        (messages[index] ? timelineIdentity(messages[index]) : undefined),
    )
  ) {
    // Crossing the bottom threshold without a live arrival must be a semantic
    // no-op for Virtua. Preserve the source array identity until there is
    // actually something to buffer; otherwise the threshold transition can
    // rebuild its model while a prepend is starting.
    return messages;
  }
  return buffered;
}

export function useBufferedTimelineMessages<
  T extends { id: string; renderKey?: string },
>({
  channelId,
  isAtBottom,
  messages,
}: {
  channelId?: string | null;
  isAtBottom: boolean;
  messages: T[];
}): { messages: T[]; pendingCount: number } {
  const frozenMessageIdsRef = React.useRef<string[] | null>(null);
  const previousChannelIdRef = React.useRef(channelId);

  if (previousChannelIdRef.current !== channelId) {
    previousChannelIdRef.current = channelId;
    frozenMessageIdsRef.current = null;
  }

  if (isAtBottom) {
    frozenMessageIdsRef.current = messages.map(timelineIdentity);
  } else if (frozenMessageIdsRef.current === null) {
    frozenMessageIdsRef.current = messages.map(timelineIdentity);
  }

  const buffered = selectBufferedTimelineMessages({
    frozenMessageIds: frozenMessageIdsRef.current,
    isAtBottom,
    messages,
  });
  const previousBufferedRef = React.useRef<T[]>(buffered);
  const stableBuffered =
    previousBufferedRef.current.length === buffered.length &&
    previousBufferedRef.current.every(
      (message, index) => message === buffered[index],
    )
      ? previousBufferedRef.current
      : buffered;
  previousBufferedRef.current = stableBuffered;
  return {
    messages: stableBuffered,
    pendingCount: Math.max(0, messages.length - stableBuffered.length),
  };
}
