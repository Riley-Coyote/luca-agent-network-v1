import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  listenProjectProposalResolved,
  listenProjectProposals,
  listProjectProposals,
  type ProjectProposalV1,
} from "@/shared/api/tauriProjectProposals";

const PROPOSALS_KEY = ["project-proposals"] as const;
const SETTLED_KEY = ["project-proposals-settled"] as const;
const NONE: ProjectProposalV1[] = [];
const NONE_SETTLED: SettledProjectProposal[] = [];

/** A project the owner made from a card, kept for the conversation's line. */
export type SettledProjectProposal = {
  requestId: string;
  conversationId: string;
  projectId: string;
  projectName: string;
  /** The first chat, when it was made: the line's way in. */
  chatId?: string;
  /** What the line says is there. */
  words: string;
  /** Take keyboard focus once, to the way in (after Create). */
  focus?: boolean;
};

/** The owner's part is done for these requests; their cards never return. */
function useSettledList(): SettledProjectProposal[] {
  return useQuery({
    queryKey: SETTLED_KEY,
    queryFn: () => NONE_SETTLED,
    enabled: false,
    initialData: NONE_SETTLED,
  }).data;
}

function byCreatedAt(left: ProjectProposalV1, right: ProjectProposalV1) {
  return left.createdAt.localeCompare(right.createdAt);
}

/**
 * Every project ask still waiting on this owner, oldest first: replayed from
 * the host once listening has begun, then kept current by its events. The
 * query cache belongs to the community, so a switch starts it fresh.
 */
export function useAllProjectProposals(): ProjectProposalV1[] {
  const queryClient = useQueryClient();
  const resolved = React.useRef(new Set<string>());
  const [listening, setListening] = React.useState(false);
  const query = useQuery({
    queryKey: PROPOSALS_KEY,
    queryFn: async () =>
      (await listProjectProposals())
        .filter((proposal) => !resolved.current.has(proposal.requestId))
        .sort(byCreatedAt),
    enabled: listening,
    retry: false,
    staleTime: 1_000,
  });

  React.useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void Promise.allSettled([
      listenProjectProposals((proposal) => {
        if (resolved.current.has(proposal.requestId)) return;
        queryClient.setQueryData<ProjectProposalV1[]>(
          PROPOSALS_KEY,
          (current = []) =>
            [
              ...current.filter(
                (item) => item.requestId !== proposal.requestId,
              ),
              proposal,
            ].sort(byCreatedAt),
        );
      }),
      listenProjectProposalResolved(({ requestId }) => {
        resolved.current.add(requestId);
        queryClient.setQueryData<ProjectProposalV1[]>(
          PROPOSALS_KEY,
          (current = []) =>
            current.filter((item) => item.requestId !== requestId),
        );
      }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        if (disposed) result.value();
        else unlisteners.push(result.value);
      }
      if (!disposed) setListening(true);
    });
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [queryClient]);

  // A project made in full is the owner's part done, even when telling the
  // resident failed: its card does not come back with Create on it.
  const settled = useSettledList();
  const all = query.data ?? NONE;
  return React.useMemo(() => {
    if (settled.length === 0) return all;
    const done = new Set(settled.map((item) => item.requestId));
    return all.filter((proposal) => !done.has(proposal.requestId));
  }, [all, settled]);
}

/** The waiting project asks of one conversation. */
export function useProjectProposals(
  conversationId: string | null,
): ProjectProposalV1[] {
  const all = useAllProjectProposals();
  return React.useMemo(
    () =>
      conversationId
        ? all.filter((proposal) => proposal.conversationId === conversationId)
        : NONE,
    [all, conversationId],
  );
}

/** Projects created from a card, for the one quiet line each leaves behind. */
export function useSettledProjectProposals(conversationId: string | null) {
  const queryClient = useQueryClient();
  const settled = useSettledList();
  const lines = React.useMemo(
    () =>
      conversationId
        ? settled.filter((item) => item.conversationId === conversationId)
        : NONE_SETTLED,
    [conversationId, settled],
  );
  const dismiss = React.useCallback(
    (requestId: string) =>
      queryClient.setQueryData<SettledProjectProposal[]>(
        SETTLED_KEY,
        (current = []) =>
          current.filter((item) => item.requestId !== requestId),
      ),
    [queryClient],
  );
  const focused = React.useCallback(
    (requestId: string) =>
      queryClient.setQueryData<SettledProjectProposal[]>(
        SETTLED_KEY,
        (current = []) =>
          current.map((item) =>
            item.requestId === requestId ? { ...item, focus: false } : item,
          ),
      ),
    [queryClient],
  );
  return { dismiss, focused, lines };
}

/** Keep a created project's line, wherever its card was answered. */
export function useRememberSettledProject() {
  const queryClient = useQueryClient();
  return React.useCallback(
    (item: SettledProjectProposal) =>
      queryClient.setQueryData<SettledProjectProposal[]>(
        SETTLED_KEY,
        (current = []) => [
          ...current.filter((other) => other.requestId !== item.requestId),
          item,
        ],
      ),
    [queryClient],
  );
}
