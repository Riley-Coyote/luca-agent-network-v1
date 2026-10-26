import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  useAllExchanges,
  useExchangeTurnTimes,
} from "@/features/exchange/exchangeStore";
import {
  buildSideConversations,
  type ExchangeTimes,
  exchangeTimesFromMessages,
  type SideConversation,
} from "@/features/exchange/sideConversations";
import { useAllRuntimeTasks } from "@/features/capabilities/useAllRuntimeTasks";
import { channelMessagesKey } from "@/features/messages/lib/messageQueryKeys";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveIdentityDisplayName } from "@/features/profile/lib/identity";
import { isGenericDmChannelName } from "@/features/sidebar/lib/railHomes";
import type { Channel, RelayEvent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * Every side conversation, live (WP-14): the exchange store's every exchange
 * and every conversation's runtime tasks, joined by `buildSideConversations`,
 * with the names a row says them by. An exchange's time is its latest turn
 * (heard live, or among the messages already loaded), else its first
 * message's, else its deadline (the record has no opened-at; nav-facts §1).
 */
export type SideConversations = {
  items: SideConversation[];
  /** A resident's or a person's name, never their key. */
  nameOf: (pubkey: string) => string;
  /** A room's name; a direct conversation by who is in it. */
  roomOf: (conversationId: string) => string;
  /** Whether the lists it is built from have arrived. */
  ready: boolean;
};

/** Re-read loaded messages whenever a room's message cache changes. */
function useMessageCacheVersion(rooms: ReadonlySet<string>) {
  const queryClient = useQueryClient();
  const [version, setVersion] = React.useState(0);
  const roomsRef = React.useRef(rooms);
  roomsRef.current = rooms;
  React.useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (
          event.type === "updated" &&
          key[0] === "channel-messages" &&
          typeof key[1] === "string" &&
          roomsRef.current.has(key[1])
        )
          setVersion((current) => current + 1);
      }),
    [queryClient],
  );
  return version;
}

export function useSideConversations(): SideConversations {
  const queryClient = useQueryClient();
  const exchanges = useAllExchanges();
  const liveTurns = useExchangeTurnTimes();
  const tasks = useAllRuntimeTasks();
  const channelsQuery = useChannelsQuery();
  const managedQuery = useManagedAgentsQuery();
  const relayQuery = useRelayAgentsQuery();

  const exchangeRooms = React.useMemo(
    () => new Set(exchanges.map((entry) => entry.record.conversationId)),
    [exchanges],
  );
  const cacheVersion = useMessageCacheVersion(exchangeRooms);
  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheVersion is the signal that a room's loaded messages changed.
  const times = React.useMemo(() => {
    const roots = new Map(
      exchanges.map((entry) => [
        entry.record.rootEventId.toLowerCase(),
        entry.record.exchangeId,
      ]),
    );
    const into = new Map<string, ExchangeTimes>();
    for (const room of exchangeRooms) {
      const messages = queryClient.getQueryData<RelayEvent[]>(
        channelMessagesKey(room),
      );
      if (messages) exchangeTimesFromMessages(messages, roots, into);
    }
    for (const [id, at] of liveTurns) {
      const times = into.get(id) ?? {};
      times.latestTurnAt = Math.max(times.latestTurnAt ?? 0, at);
      into.set(id, times);
    }
    return into;
  }, [cacheVersion, exchangeRooms, exchanges, liveTurns, queryClient]);

  const items = React.useMemo(
    () => buildSideConversations({ exchanges, tasks, times }),
    [exchanges, tasks, times],
  );

  const known = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const agent of relayQuery.data ?? [])
      names.set(normalizePubkey(agent.pubkey), agent.name);
    for (const agent of managedQuery.data ?? [])
      if (agent.name) names.set(normalizePubkey(agent.pubkey), agent.name);
    return names;
  }, [managedQuery.data, relayQuery.data]);
  const strangers = React.useMemo(() => {
    const keys = new Set<string>();
    for (const item of items) {
      const people =
        item.kind === "task"
          ? [item.residentPubkey]
          : [item.openedBy, ...item.members];
      for (const pubkey of people) if (!known.has(pubkey)) keys.add(pubkey);
    }
    return [...keys].sort();
  }, [items, known]);
  const profiles = useUsersBatchQuery(strangers, {
    enabled: strangers.length > 0,
  }).data?.profiles;

  const nameOf = React.useCallback(
    (pubkey: string) => {
      const key = normalizePubkey(pubkey);
      const name = known.get(key);
      if (name) return name;
      const profile = profiles?.[key];
      return resolveIdentityDisplayName({
        displayName: profile?.displayName,
        name: profile?.name,
        nip05Handle: profile?.nip05Handle,
        pubkey: key,
      });
    },
    [known, profiles],
  );

  const channels = channelsQuery.data;
  const roomOf = React.useCallback(
    (conversationId: string) => {
      const channel = channels?.find(
        (candidate: Channel) => candidate.id === conversationId,
      );
      if (!channel) return "";
      if (
        channel.channelType === "dm" &&
        isGenericDmChannelName(channel.name)
      ) {
        const members = channel.participantPubkeys.length
          ? channel.participantPubkeys
          : channel.memberPubkeys;
        return members.map(nameOf).join(" + ");
      }
      return channel.name;
    },
    [channels, nameOf],
  );

  return {
    items,
    nameOf,
    ready: channelsQuery.data !== undefined,
    roomOf,
  };
}
