/**
 * Query the relay's stored event log for one agent's signed trail.
 *
 * This is a plain history `REQ` — `authors` + `kinds` + an `until` cursor —
 * issued through the same `relayClient.fetchEvents` path the sidebar sync
 * helpers use. No `#h` tag is sent, so the relay scopes the read to every
 * channel the reader can already see and nothing beyond it.
 */

import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import {
  PROVENANCE_KINDS,
  type ProvenanceRecord,
  sortProvenanceRecords,
  toProvenanceRecord,
} from "@/features/provenance/lib/provenanceRecord";
import {
  type ProvenanceCursor,
  cursorBefore,
  nextCursorAfterPage,
  PROVENANCE_PAGE_SIZE,
  PROVENANCE_RELAY_LIMIT,
  unseenBoundaryEvents,
} from "@/features/provenance/lib/provenancePagination";
import { verifyProvenanceEvent } from "@/features/provenance/lib/verifyProvenance";
import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { RelayEvent } from "@/shared/api/types";

/** Signatures verified between yields, so a page never blocks the thread. */
const VERIFY_CHUNK = 10;

export const provenanceQueryKeys = {
  agent: (
    communityId: string,
    relayUrl: string,
    readerPubkey: string,
    agentPubkey: string,
  ) =>
    [
      "provenance",
      communityId,
      relayUrl,
      normalizePubkey(readerPubkey),
      normalizePubkey(agentPubkey),
    ] as const,
};

type ProvenancePage = {
  records: ProvenanceRecord[];
  /** The next request is either a same-second completion or a strict `until`. */
  nextCursor: ProvenanceCursor | null;
};

async function fetchProvenancePage(
  pubkey: string,
  cursor: ProvenanceCursor | undefined,
  signal: AbortSignal,
): Promise<ProvenancePage> {
  throwIfAborted(signal);
  if (cursor?.kind === "boundary") {
    const boundaryEvents = await relayClient.fetchEvents({
      authors: [normalizePubkey(pubkey)],
      kinds: PROVENANCE_KINDS,
      since: cursor.createdAt,
      until: cursor.createdAt,
      limit: PROVENANCE_RELAY_LIMIT,
    });
    throwIfAborted(signal);
    const events = unseenBoundaryEvents(boundaryEvents, cursor);

    // A page may end on a timestamp with no unseen rows (the usual
    // non-tied case). Continue below it in this same request so Load more
    // never appears to do nothing.
    if (events.length > 0) {
      return verifyProvenancePage(
        events,
        { ...cursorBefore(cursor.createdAt) },
        signal,
      );
    }
    return fetchProvenancePage(pubkey, cursorBefore(cursor.createdAt), signal);
  }

  const pageEvents = await relayClient.fetchEvents({
    authors: [normalizePubkey(pubkey)],
    kinds: PROVENANCE_KINDS,
    limit: PROVENANCE_PAGE_SIZE,
    ...(cursor?.kind === "before" ? { until: cursor.until } : {}),
  });
  throwIfAborted(signal);

  return verifyProvenancePage(
    pageEvents,
    nextCursorAfterPage(pageEvents),
    signal,
  );
}

async function verifyProvenancePage(
  events: RelayEvent[],
  nextCursor: ProvenanceCursor | null,
  signal: AbortSignal,
): Promise<ProvenancePage> {
  const records = sortProvenanceRecords(events.map(toProvenanceRecord));

  // Verify here rather than in a render pass: a schnorr check is ~1ms, and a
  // full page of them would be a visible hitch if it ran while painting.
  // Yielding every chunk keeps the main thread responsive while it works.
  for (let index = 0; index < records.length; index += 1) {
    throwIfAborted(signal);
    const record = records[index];
    record.verification = verifyProvenanceEvent(record.event);
    if (index % VERIFY_CHUNK === VERIFY_CHUNK - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      throwIfAborted(signal);
    }
  }

  return {
    records,
    nextCursor,
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw (
      signal.reason ??
      new DOMException("Activity history request cancelled", "AbortError")
    );
  }
}

export function useAgentProvenanceQuery(pubkey: string | null | undefined) {
  const { activeCommunity } = useCommunities();
  const identityQuery = useIdentityQuery();
  const queryClient = useQueryClient();
  const communityId = activeCommunity?.id ?? "";
  const relayUrl = activeCommunity?.relayUrl ?? "";
  const readerPubkey = identityQuery.data?.pubkey ?? "";
  const queryKey = useMemo(
    () =>
      provenanceQueryKeys.agent(
        communityId,
        relayUrl,
        readerPubkey,
        pubkey ?? "",
      ),
    [communityId, relayUrl, readerPubkey, pubkey],
  );

  // A community/account change gets a distinct cache key. Cancelling the old
  // observer also prevents an in-flight old-relay response from committing
  // while the app is applying the next workspace.
  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey, exact: true });
    },
    [queryClient, queryKey],
  );

  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => {
      if (!pubkey) throw new Error("An agent public key is required");
      return fetchProvenancePage(pubkey, pageParam, signal);
    },
    initialPageParam: undefined as ProvenanceCursor | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!pubkey && !!communityId && !!relayUrl && !!readerPubkey,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}
