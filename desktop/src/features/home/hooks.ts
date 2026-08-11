import { useQuery } from "@tanstack/react-query";

import { getHomeFeed, getOwnerNativeInbox } from "@/shared/api/tauri";
import { useRelayConnection } from "@/shared/api/useRelayConnection";

export function useHomeFeedQuery() {
  const connectionState = useRelayConnection();
  const connected = connectionState === "connected";

  return useQuery({
    queryKey: ["home-feed"],
    queryFn: () =>
      getHomeFeed({
        limit: 50,
        types: "mentions,needs_action,activity,agent_activity",
      }),
    staleTime: 15_000,
    gcTime: 5 * 60 * 1_000,
    // Pause background polling on degraded/stalled/disconnected connections.
    // The relay can't serve the request anyway, and the spurious failures
    // consume quota that the recovery path needs.
    refetchInterval: connected ? 30_000 : false,
  });
}

export function useOwnerNativeInboxQuery() {
  const connectionState = useRelayConnection();
  const connected = connectionState === "connected";

  return useQuery({
    queryKey: ["owner-native-inbox"],
    queryFn: () => getOwnerNativeInbox({ limit: 100 }),
    enabled: connected,
    staleTime: 15_000,
    gcTime: 5 * 60 * 1_000,
    refetchInterval: connected ? 30_000 : false,
    // A native source failure is represented by the command's source reports.
    // A missing/unregistered bridge should remain a quiet compatibility gap,
    // not a retry loop that disrupts the legacy Inbox.
    retry: false,
  });
}
