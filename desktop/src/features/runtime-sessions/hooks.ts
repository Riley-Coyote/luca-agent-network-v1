import { useMutation, useQuery } from "@tanstack/react-query";

import { listRuntimeConnectionStatus } from "@/shared/api/tauriMcp";
import {
  getConnectedRuntimeSessionContext,
  listConnectedRuntimeSessions,
  type IndexedRuntimeId,
} from "@/shared/api/tauriRuntimeSessions";

export const runtimeConnectionsQueryKey = ["runtime-connections"] as const;

export function useRuntimeConnectionsQuery() {
  return useQuery({
    queryKey: runtimeConnectionsQueryKey,
    queryFn: listRuntimeConnectionStatus,
    staleTime: 60_000,
  });
}

export function useRuntimeSessionsQuery(runtimeId: IndexedRuntimeId | null) {
  return useQuery({
    enabled: runtimeId !== null,
    queryKey: ["connected-runtime-sessions", runtimeId],
    queryFn: () => listConnectedRuntimeSessions(runtimeId as IndexedRuntimeId),
    staleTime: 30_000,
  });
}

export function useRuntimeSessionContextMutation() {
  return useMutation({
    mutationFn: getConnectedRuntimeSessionContext,
  });
}
