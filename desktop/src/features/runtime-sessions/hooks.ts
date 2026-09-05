import { useMutation, useQuery } from "@tanstack/react-query";

import { listRuntimeConnectionStatus } from "@/shared/api/tauriMcp";
import {
  getConnectedRuntimeSessionContext,
  listConnectedRuntimeSessions,
  type IndexedRuntimeId,
} from "@/shared/api/tauriRuntimeSessions";

const RUNTIME_SESSION_READ_TIMEOUT_MS = 12_000;

async function listRuntimeSessionsWithTimeout(
  runtimeId: IndexedRuntimeId,
  signal: AbortSignal,
) {
  return new Promise<Awaited<ReturnType<typeof listConnectedRuntimeSessions>>>(
    (resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        cleanUp();
        reject(new Error("The local session index did not respond in time."));
      }, RUNTIME_SESSION_READ_TIMEOUT_MS);
      const abort = () => {
        cleanUp();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const cleanUp = () => {
        globalThis.clearTimeout(timeoutId);
        signal.removeEventListener("abort", abort);
      };

      signal.addEventListener("abort", abort, { once: true });
      void listConnectedRuntimeSessions(runtimeId).then(
        (sessions) => {
          cleanUp();
          resolve(sessions);
        },
        (error: unknown) => {
          cleanUp();
          reject(error);
        },
      );
    },
  );
}

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
    queryFn: ({ signal }) =>
      listRuntimeSessionsWithTimeout(runtimeId as IndexedRuntimeId, signal),
    retry: false,
    staleTime: 30_000,
  });
}

export function useRuntimeSessionContextMutation() {
  return useMutation({
    mutationFn: getConnectedRuntimeSessionContext,
  });
}
