import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  queryAgentInbox,
  type AgentInboxCursor,
} from "@/shared/api/agentInbox";
import { listenForExchangeUpdates } from "@/shared/api/exchanges";

/** One shared passive reference cache, never one poller per agent or row. */
export function useAgentInbox(residentPubkey?: string) {
  const { activeCommunity, reinitKey } = useCommunities();
  const owner = useIdentityQuery().data?.pubkey;
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: [
      "agent-inbox",
      activeCommunity?.id,
      reinitKey,
      owner,
      residentPubkey,
    ],
    queryFn: ({ pageParam }) =>
      queryAgentInbox({ residentPubkey, cursor: pageParam, limit: 100 }),
    initialPageParam: undefined as AgentInboxCursor | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(activeCommunity && owner),
    staleTime: 30_000,
    retry: false,
  });
  React.useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void listenForExchangeUpdates(() => {
      void client.invalidateQueries({ queryKey: ["agent-inbox"] });
    })
      .then((stop) => {
        if (stopped) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [client]);
  return query;
}
