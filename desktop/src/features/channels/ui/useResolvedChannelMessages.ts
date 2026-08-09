import * as React from "react";

import { cacheSearchHitEvent } from "@/app/navigation/searchHitEventCache";
import { mergeMessages } from "@/features/messages/hooks";
import type { Channel, RelayEvent, SearchHit } from "@/shared/api/types";

type UseResolvedChannelMessagesInput = {
  activeChannel: Channel | null;
  messages: RelayEvent[] | undefined;
  targetMessageEvents: RelayEvent[];
};

export function useResolvedChannelMessages({
  activeChannel,
  messages,
  targetMessageEvents,
}: UseResolvedChannelMessagesInput) {
  const activeChannelId = activeChannel?.id ?? null;
  const [findEvents, setFindEvents] = React.useState<RelayEvent[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear spliced find results exactly when the active channel changes.
  React.useEffect(() => {
    setFindEvents([]);
  }, [activeChannelId]);

  const resolvedMessages = React.useMemo(() => {
    const currentMessages = messages ?? [];
    const extraEvents = [...targetMessageEvents, ...findEvents];
    if (!activeChannel || extraEvents.length === 0) {
      return currentMessages;
    }
    return extraEvents.reduce(mergeMessages, currentMessages);
  }, [activeChannel, findEvents, messages, targetMessageEvents]);

  const handleFindSearchHit = React.useCallback((hit: SearchHit) => {
    const event = cacheSearchHitEvent(hit);
    setFindEvents((currentEvents) =>
      currentEvents.some((currentEvent) => currentEvent.id === event.id)
        ? currentEvents
        : [...currentEvents, event],
    );
  }, []);

  return { handleFindSearchHit, resolvedMessages };
}
