import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  listRuntimeTasks,
  listRuntimeTaskProposals,
  listenRuntimeTaskProposalResolved,
  listenRuntimeTaskProposals,
  listenRuntimeTasks,
  type RuntimeTaskProposal,
  type RuntimeTaskProjection,
} from "@/shared/api/tauriRuntimeTasks";

function runtimeTasksKey(conversationId: string | null) {
  return ["runtime-tasks", conversationId] as const;
}

function runtimeTaskProposalsKey(conversationId: string | null) {
  return ["runtime-task-proposals", conversationId] as const;
}

export function useRuntimeTaskProposals(conversationId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: runtimeTaskProposalsKey(conversationId),
    queryFn: () => listRuntimeTaskProposals(conversationId ?? ""),
    enabled: Boolean(conversationId),
    retry: false,
    staleTime: 1_000,
  });

  React.useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void Promise.all([
      listenRuntimeTaskProposals((proposal) => {
        if (proposal.conversationId !== conversationId) return;
        queryClient.setQueryData<RuntimeTaskProposal[]>(
          runtimeTaskProposalsKey(conversationId),
          (current = []) =>
            [
              ...current.filter(
                (item) => item.proposalId !== proposal.proposalId,
              ),
              proposal,
            ].sort((left, right) =>
              left.createdAt.localeCompare(right.createdAt),
            ),
        );
      }),
      listenRuntimeTaskProposalResolved((resolution) => {
        if (resolution.conversationId !== conversationId) return;
        queryClient.setQueryData<RuntimeTaskProposal[]>(
          runtimeTaskProposalsKey(conversationId),
          (current = []) =>
            current.filter((item) => item.proposalId !== resolution.proposalId),
        );
      }),
    ]).then((stops) => {
      if (disposed) {
        for (const stop of stops) stop();
      } else unlisteners.push(...stops);
    });
    return () => {
      disposed = true;
      for (const stop of unlisteners) stop();
    };
  }, [conversationId, queryClient]);

  return query;
}

export function useRuntimeTasks(conversationId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: runtimeTasksKey(conversationId),
    queryFn: () => listRuntimeTasks(conversationId ?? ""),
    enabled: Boolean(conversationId),
    retry: false,
    staleTime: 1_000,
  });

  React.useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenRuntimeTasks((task) => {
      if (task.conversationId !== conversationId) return;
      queryClient.setQueryData<RuntimeTaskProjection[]>(
        runtimeTasksKey(conversationId),
        (current = []) => {
          const next = current.filter((item) => item.taskId !== task.taskId);
          next.push(task);
          next.sort((left, right) =>
            right.startedAt.localeCompare(left.startedAt),
          );
          return next;
        },
      );
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [conversationId, queryClient]);

  return query;
}
