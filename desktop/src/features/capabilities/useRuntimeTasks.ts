import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { mergeRuntimeTasks } from "./lib/runtimeTaskPresentation";
import {
  listRuntimeTasks,
  listRuntimeTaskProposals,
  listenRuntimeTaskProposalResolved,
  listenRuntimeTaskProposals,
  listenRuntimeTasks,
  type RuntimeTaskProposal,
  type RuntimeTaskProjection,
} from "@/shared/api/tauriRuntimeTasks";

export function runtimeTasksKey(conversationId: string | null) {
  return ["runtime-tasks", conversationId] as const;
}

function runtimeTaskProposalsKey(conversationId: string | null) {
  return ["runtime-task-proposals", conversationId] as const;
}

export function useRuntimeTaskProposals(conversationId: string | null) {
  const queryClient = useQueryClient();
  const [listeningConversation, setListeningConversation] = React.useState<
    string | null
  >(null);
  const observed = React.useRef({
    pending: new Map<string, RuntimeTaskProposal>(),
    resolved: new Set<string>(),
  });
  const query = useQuery({
    queryKey: runtimeTaskProposalsKey(conversationId),
    queryFn: async () => {
      const observations = observed.current;
      const proposals = await listRuntimeTaskProposals(conversationId ?? "");
      const merged = new Map(proposals.map((item) => [item.proposalId, item]));
      for (const proposal of observations.pending.values()) {
        merged.set(proposal.proposalId, proposal);
      }
      return [...merged.values()]
        .filter((item) => !observations.resolved.has(item.proposalId))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    enabled:
      Boolean(conversationId) && listeningConversation === conversationId,
    retry: false,
    staleTime: 1_000,
  });
  const refetch = query.refetch;

  React.useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    observed.current = { pending: new Map(), resolved: new Set() };
    setListeningConversation(null);
    void Promise.allSettled([
      listenRuntimeTaskProposals((proposal) => {
        if (
          disposed ||
          proposal.conversationId !== conversationId ||
          observed.current.resolved.has(proposal.proposalId)
        )
          return;
        observed.current.pending.set(proposal.proposalId, proposal);
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
        if (disposed || resolution.conversationId !== conversationId) return;
        observed.current.pending.delete(resolution.proposalId);
        observed.current.resolved.add(resolution.proposalId);
        if (observed.current.resolved.size > 512) {
          const oldest = observed.current.resolved.values().next().value;
          if (oldest) observed.current.resolved.delete(oldest);
        }
        queryClient.setQueryData<RuntimeTaskProposal[]>(
          runtimeTaskProposalsKey(conversationId),
          (current = []) =>
            current.filter((item) => item.proposalId !== resolution.proposalId),
        );
      }),
    ]).then((results) => {
      const stops = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (disposed) {
        for (const stop of stops) stop();
      } else {
        unlisteners.push(...stops);
        // Backfill only after subscription. Events observed while the list is
        // in flight are merged, including resolved-proposal tombstones.
        setListeningConversation(conversationId);
        // An early event can make the cache fresh before enabled flips. Still
        // fetch the authoritative backfill once; share any already-running read.
        void refetch({ cancelRefetch: false });
      }
    });
    return () => {
      disposed = true;
      for (const stop of unlisteners) stop();
    };
  }, [conversationId, queryClient, refetch]);

  return query;
}

export function useRuntimeTasks(conversationId: string | null) {
  const queryClient = useQueryClient();
  const [listeningConversation, setListeningConversation] = React.useState<
    string | null
  >(null);
  const query = useQuery({
    queryKey: runtimeTasksKey(conversationId),
    queryFn: async () => {
      const tasks = await listRuntimeTasks(conversationId ?? "");
      return mergeRuntimeTasks(
        queryClient.getQueryData<RuntimeTaskProjection[]>(
          runtimeTasksKey(conversationId),
        ) ?? [],
        tasks,
      );
    },
    enabled:
      Boolean(conversationId) && listeningConversation === conversationId,
    retry: false,
    staleTime: 1_000,
  });
  const refetch = query.refetch;

  React.useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    setListeningConversation(null);
    void listenRuntimeTasks((task) => {
      if (disposed || task.conversationId !== conversationId) return;
      queryClient.setQueryData<RuntimeTaskProjection[]>(
        runtimeTasksKey(conversationId),
        (current = []) => mergeRuntimeTasks(current, [task]),
      );
    })
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          setListeningConversation(conversationId);
          void refetch({ cancelRefetch: false });
        }
      })
      .catch(() => {
        // A snapshot is still useful when event subscription is unavailable.
        // No polling or replacement work is started to compensate.
        if (!disposed) {
          setListeningConversation(conversationId);
          void refetch({ cancelRefetch: false });
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [conversationId, queryClient, refetch]);

  return query;
}
