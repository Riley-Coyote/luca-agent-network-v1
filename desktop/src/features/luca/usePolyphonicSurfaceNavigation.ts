import * as React from "react";
import { listen } from "@tauri-apps/api/event";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { classifyAgentManagementOrigin } from "@/features/agents/agentManagementBuffer";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { subscribePolyphonicSurfaceRequests } from "@/features/agents/observerRelayStore";
import { useChannelsQuery } from "@/features/channels/hooks";
import { POLYPHONIC_REOPEN_ONBOARDING_EVENT } from "@/features/onboarding/hooks";

import {
  parsePolyphonicSurfaceRequest,
  type PolyphonicSurfaceRequest,
} from "./polyphonicSurfaceRequest";
import { useCompanionAppControl } from "./CompanionAppControl";

type Candidate = {
  agentPubkey: string;
  observerChannelId: string | null;
  request: PolyphonicSurfaceRequest;
  controlRequestId?: string;
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
  const [companionReview, setCompanionReview] = React.useState<{
    residentPubkey: string;
    conversationId: string;
  } | null>(null);
  const appControl = useCompanionAppControl();

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
    const navigate = async () => {
      switch (request.surface) {
        case "companion":
          setCompanionReview({
            residentPubkey: agentPubkey,
            conversationId: request.channelId,
          });
          break;
        case "onboarding":
          window.dispatchEvent(new Event(POLYPHONIC_REOPEN_ONBOARDING_EVENT));
          break;
        case "runtime":
          await goSettings("agents", {
            settingsAgent: agentPubkey,
            settingsAgentTab: "runtime",
          });
          break;
        case "native_agents":
          await goAgents({ reviewNative: true });
          break;
        case "brain":
          await goBrain();
          break;
        case "profile":
          await goSettings("profile");
          break;
        case "appearance":
          await goSettings("appearance");
          break;
        case "recovery":
          await goSettings("security");
          break;
        case "access":
          await goSettings("agents", {
            settingsAgent: agentPubkey,
            settingsAgentTab: "capabilities",
          });
          break;
      }
    };
    if (candidate.controlRequestId) {
      const name =
        managedAgentsRef.current?.find(
          (agent) => agent.pubkey.toLowerCase() === agentPubkey.toLowerCase(),
        )?.name || "Your companion";
      void appControl.run(candidate.controlRequestId, name, navigate);
    } else {
      // Legacy authenticated relay navigation has no native cancellation lease.
      // Do not present a Stop control that cannot enforce its promise.
      void navigate();
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

  // Managed residents use the scoped native broker; they never receive the
  // credentials needed by the legacy encrypted CLI request transport.
  React.useEffect(() => {
    let disposed = false;
    const subscription = listen<unknown>(
      "polyphonic-native-surface-request",
      ({ payload }) => {
        if (disposed || typeof payload !== "object" || payload === null) return;
        const value = payload as Record<string, unknown>;
        const request = parsePolyphonicSurfaceRequest(value.request);
        if (
          !request ||
          typeof value.agentPubkey !== "string" ||
          value.observerChannelId !== request.channelId ||
          (value.controlRequestId !== undefined &&
            value.controlRequestId !== request.requestId)
        )
          return;
        const candidate = {
          agentPubkey: value.agentPubkey,
          observerChannelId: request.channelId,
          request,
          ...(value.controlRequestId === request.requestId
            ? { controlRequestId: request.requestId }
            : {}),
        };
        if (
          classifyAgentManagementOrigin(
            managedAgentsRef.current,
            channelsRef.current,
            candidate.agentPubkey,
            request.channelId,
          ) === "buffer"
        ) {
          bufferedRef.current.push(candidate);
          if (bufferedRef.current.length > 100) bufferedRef.current.shift();
          return;
        }
        accept(candidate);
      },
    );
    void subscription.catch(() => {
      // Legacy relay navigation remains available outside the native shell.
    });
    return () => {
      disposed = true;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  return {
    companionReview,
    closeCompanionReview: () => setCompanionReview(null),
    appControl,
  };
}
