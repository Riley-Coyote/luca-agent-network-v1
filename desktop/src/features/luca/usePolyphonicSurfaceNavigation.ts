import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { classifyAgentManagementOrigin } from "@/features/agents/agentManagementBuffer";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { subscribePolyphonicSurfaceRequests } from "@/features/agents/observerRelayStore";
import { useChannelsQuery } from "@/features/channels/hooks";
import { POLYPHONIC_REOPEN_ONBOARDING_EVENT } from "@/features/onboarding/hooks";

import type { PolyphonicSurfaceRequest } from "./polyphonicSurfaceRequest";

type Candidate = {
  agentPubkey: string;
  observerChannelId: string | null;
  request: PolyphonicSurfaceRequest;
};

/** Authenticate a conversation-bound resident request, then open its surface. */
export function usePolyphonicSurfaceNavigation() {
  const { goAgents, goBrain, goSettings } = useAppNavigation();
  const managedAgentsQuery = useManagedAgentsQuery();
  const channelsQuery = useChannelsQuery();
  const managedAgentsRef = React.useRef(managedAgentsQuery.data);
  const channelsRef = React.useRef(channelsQuery.data);
  const bufferedRef = React.useRef<Candidate[]>([]);
  const seenRef = React.useRef(new Set<string>());

  const accept = React.useEffectEvent((candidate: Candidate) => {
    const { agentPubkey, observerChannelId, request } = candidate;
    if (
      observerChannelId !== request.channelId ||
      seenRef.current.has(request.requestId) ||
      classifyAgentManagementOrigin(
        managedAgentsRef.current,
        channelsRef.current,
        agentPubkey,
        request.channelId,
      ) !== "accept"
    ) {
      return;
    }
    seenRef.current.add(request.requestId);
    switch (request.surface) {
      case "onboarding":
        window.dispatchEvent(new Event(POLYPHONIC_REOPEN_ONBOARDING_EVENT));
        break;
      case "runtime":
        void goSettings("agents", {
          settingsAgent: agentPubkey,
          settingsAgentTab: "runtime",
        });
        break;
      case "native_agents":
        void goAgents({ reviewNative: true });
        break;
      case "brain":
        void goBrain();
        break;
      case "profile":
        void goSettings("profile");
        break;
      case "appearance":
        void goSettings("appearance");
        break;
      case "recovery":
        void goSettings("security");
        break;
      case "access":
        void goSettings("agents", {
          settingsAgent: agentPubkey,
          settingsAgentTab: "capabilities",
        });
        break;
    }
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
      subscribePolyphonicSurfaceRequests(
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
