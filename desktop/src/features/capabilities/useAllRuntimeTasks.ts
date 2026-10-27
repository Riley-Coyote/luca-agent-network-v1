import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { mergeRuntimeTasks } from "./lib/runtimeTaskPresentation";
import {
  listAllRuntimeTaskProposals,
  listAllRuntimeTasks,
  listenRuntimeTaskProposalResolved,
  listenRuntimeTaskProposals,
  listenRuntimeTasks,
  type RuntimeTaskProposal,
  type RuntimeTaskProjection,
} from "@/shared/api/tauriRuntimeTasks";

/**
 * Every conversation's runtime tasks and open runtime-task proposals, kept
 * live by the same events the per-room hooks follow (WP-14). The Activity
 * place reads them for its side conversations and Needs you, the Chats rail
 * for Luca's side rows, and a connected app's card for what Luca did with it.
 * Each list is one query, shared by every reader.
 */

const ALL_TASKS_KEY = ["runtime-tasks-all"] as const;
/** The shared list's key, for a command's reply to land in (WP-35). */
export const ALL_RUNTIME_TASKS_KEY = ALL_TASKS_KEY;
const ALL_PROPOSALS_KEY = ["runtime-task-proposals-all"] as const;

const EMPTY_TASKS: RuntimeTaskProjection[] = [];
const EMPTY_PROPOSALS: RuntimeTaskProposal[] = [];

export function useAllRuntimeTasks(): RuntimeTaskProjection[] {
  const queryClient = useQueryClient();
  const [listening, setListening] = React.useState(false);
  const query = useQuery({
    queryKey: ALL_TASKS_KEY,
    queryFn: async () =>
      mergeRuntimeTasks(
        queryClient.getQueryData<RuntimeTaskProjection[]>(ALL_TASKS_KEY) ?? [],
        await listAllRuntimeTasks(),
      ),
    enabled: listening,
    retry: false,
    staleTime: 5_000,
  });
  const refetch = query.refetch;
  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const ready = () => {
      if (disposed) return;
      setListening(true);
      void refetch({ cancelRefetch: false });
    };
    void listenRuntimeTasks((task) => {
      if (disposed) return;
      queryClient.setQueryData<RuntimeTaskProjection[]>(
        ALL_TASKS_KEY,
        (current = []) => mergeRuntimeTasks(current, [task]),
      );
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
        ready();
      })
      // The snapshot is still the record when events are unavailable.
      .catch(ready);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [queryClient, refetch]);
  return query.data ?? EMPTY_TASKS;
}

export function useAllRuntimeTaskProposals(): RuntimeTaskProposal[] {
  const queryClient = useQueryClient();
  const [listening, setListening] = React.useState(false);
  const resolved = React.useRef(new Set<string>());
  const query = useQuery({
    queryKey: ALL_PROPOSALS_KEY,
    queryFn: async () => {
      const listed = await listAllRuntimeTaskProposals();
      const merged = new Map(
        (
          queryClient.getQueryData<RuntimeTaskProposal[]>(ALL_PROPOSALS_KEY) ??
          []
        ).map((item) => [item.proposalId, item]),
      );
      for (const item of listed) merged.set(item.proposalId, item);
      // The list is the record: anything it no longer holds was answered.
      const listedIds = new Set(listed.map((item) => item.proposalId));
      return [...merged.values()].filter(
        (item) =>
          listedIds.has(item.proposalId) &&
          !resolved.current.has(item.proposalId),
      );
    },
    enabled: listening,
    retry: false,
    staleTime: 2_000,
  });
  const refetch = query.refetch;
  React.useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    void Promise.allSettled([
      listenRuntimeTaskProposals((proposal) => {
        if (disposed || resolved.current.has(proposal.proposalId)) return;
        queryClient.setQueryData<RuntimeTaskProposal[]>(
          ALL_PROPOSALS_KEY,
          (current = []) => [
            ...current.filter(
              (item) => item.proposalId !== proposal.proposalId,
            ),
            proposal,
          ],
        );
      }),
      listenRuntimeTaskProposalResolved((resolution) => {
        if (disposed) return;
        resolved.current.add(resolution.proposalId);
        if (resolved.current.size > 512) {
          const oldest = resolved.current.values().next().value;
          if (oldest) resolved.current.delete(oldest);
        }
        queryClient.setQueryData<RuntimeTaskProposal[]>(
          ALL_PROPOSALS_KEY,
          (current = []) =>
            current.filter((item) => item.proposalId !== resolution.proposalId),
        );
      }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        if (disposed) result.value();
        else stops.push(result.value);
      }
      if (disposed) return;
      setListening(true);
      void refetch({ cancelRefetch: false });
    });
    return () => {
      disposed = true;
      for (const stop of stops) stop();
    };
  }, [queryClient, refetch]);
  return query.data ?? EMPTY_PROPOSALS;
}

/** The residents running a runtime task right now (lowercase): they count as
 *  working (WP-14 review, decided by the orchestrator), in the Agents rail
 *  and in their own space's now line. */
export function runtimeWorkingPubkeys(
  tasks: readonly RuntimeTaskProjection[],
): Set<string> {
  return new Set(
    tasks
      .filter(
        (task) =>
          task.state === "queued" ||
          task.state === "active" ||
          task.state === "stopping",
      )
      .map((task) => task.residentPubkey.toLowerCase()),
  );
}

/** `runtimeWorkingPubkeys` of every conversation's tasks, kept live. */
export function useRuntimeWorkingPubkeys(): ReadonlySet<string> {
  const tasks = useAllRuntimeTasks();
  return React.useMemo(() => runtimeWorkingPubkeys(tasks), [tasks]);
}

/** The latest runtime task `pubkey` is running right now, or null: what a
 *  mind's now line and its row in Now say while Claude Code or Codex works
 *  for it (WP-09b, Decided 2). `enabled: false` reads nothing. */
export function useRunningRuntimeTask(
  pubkey: string | null | undefined,
  enabled = true,
): RuntimeTaskProjection | null {
  const tasks = useAllRuntimeTasks();
  return React.useMemo(() => {
    const key = enabled && pubkey ? pubkey.toLowerCase() : null;
    if (!key) return null;
    const running = tasks.filter(
      (task) =>
        task.residentPubkey.toLowerCase() === key &&
        runtimeWorkingPubkeys([task]).size > 0,
    );
    return (
      running.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    );
  }, [enabled, pubkey, tasks]);
}
