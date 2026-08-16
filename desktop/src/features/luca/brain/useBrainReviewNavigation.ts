import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { classifyAgentManagementOrigin } from "@/features/agents/agentManagementBuffer";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { subscribeBrainReviewRequests } from "@/features/agents/observerRelayStore";
import { useChannelsQuery } from "@/features/channels/hooks";

import type { BrainReviewRequest } from "./brainReviewRequest";

type BufferedRequest = {
  agentPubkey: string;
  observerChannelId: string | null;
  request: BrainReviewRequest;
};

/** Authenticate an owned resident's conversation-bound request, then open Brain. */
export function useBrainReviewNavigation() {
  const { goBrain } = useAppNavigation();
  const managedAgentsQuery = useManagedAgentsQuery();
  const channelsQuery = useChannelsQuery();
  const managedAgentsRef = React.useRef(managedAgentsQuery.data);
  const channelsRef = React.useRef(channelsQuery.data);
  const bufferedRef = React.useRef<BufferedRequest[]>([]);
  const seenRequestIdsRef = React.useRef(new Set<string>());

  const accept = React.useEffectEvent((candidate: BufferedRequest) => {
    const { agentPubkey, observerChannelId, request } = candidate;
    if (
      observerChannelId !== request.channelId ||
      seenRequestIdsRef.current.has(request.requestId) ||
      classifyAgentManagementOrigin(
        managedAgentsRef.current,
        channelsRef.current,
        agentPubkey,
        request.channelId,
      ) !== "accept"
    ) {
      return;
    }
    seenRequestIdsRef.current.add(request.requestId);
    void goBrain();
  });

  React.useEffect(() => {
    managedAgentsRef.current = managedAgentsQuery.data;
    channelsRef.current = channelsQuery.data;
    if (managedAgentsQuery.data && channelsQuery.data) {
      const buffered = bufferedRef.current.splice(0);
      for (const candidate of buffered) accept(candidate);
    }
  }, [channelsQuery.data, managedAgentsQuery.data]);

  React.useEffect(
    () =>
      subscribeBrainReviewRequests(
        (agentPubkey, observerChannelId, request) => {
          const candidate = { agentPubkey, observerChannelId, request };
          if (
            classifyAgentManagementOrigin(
              managedAgentsRef.current,
              channelsRef.current,
              agentPubkey,
              request.channelId,
            ) === "buffer"
          ) {
            bufferedRef.current.push(candidate);
            if (bufferedRef.current.length > 100) bufferedRef.current.shift();
            return;
          }
          accept(candidate);
        },
      ),
    [],
  );
}
