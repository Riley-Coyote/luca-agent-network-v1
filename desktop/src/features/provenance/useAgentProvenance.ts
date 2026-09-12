/**
 * Query the relay's stored event log for one agent's signed trail.
 *
 * This is a plain history `REQ` — `authors` + `kinds` + an `until` cursor —
 * issued through the same `relayClient.fetchEvents` path the sidebar sync
 * helpers use. No `#h` tag is sent, so the relay scopes the read to every
 * channel the reader can already see and nothing beyond it.
 */

import { useInfiniteQuery } from "@tanstack/react-query";

import {
  PROVENANCE_KINDS,
  type ProvenanceRecord,
  sortProvenanceRecords,
  toProvenanceRecord,
} from "@/features/provenance/lib/provenanceRecord";
import { verifyProvenanceEvent } from "@/features/provenance/lib/verifyProvenance";
import { relayClient } from "@/shared/api/relayClient";
import { normalizePubkey } from "@/shared/lib/pubkey";

const PAGE_SIZE = 60;
/** Signatures verified between yields, so a page never blocks the thread. */
const VERIFY_CHUNK = 10;

export const provenanceQueryKeys = {
  agent: (pubkey: string) => ["provenance", normalizePubkey(pubkey)] as const,
};

type ProvenancePage = {
  records: ProvenanceRecord[];
  /** `until` for the next page: one second before the oldest row returned. */
  nextCursor: number | null;
};

async function fetchProvenancePage(
  pubkey: string,
  until: number | undefined,
): Promise<ProvenancePage> {
  const events = await relayClient.fetchEvents({
    authors: [normalizePubkey(pubkey)],
    kinds: PROVENANCE_KINDS,
    limit: PAGE_SIZE,
    ...(until === undefined ? {} : { until }),
  });

  const records = sortProvenanceRecords(events.map(toProvenanceRecord));

  // Verify here rather than in a render pass: a schnorr check is ~1ms, and a
  // full page of them would be a visible hitch if it ran while painting.
  // Yielding every chunk keeps the main thread responsive while it works.
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    record.verification = verifyProvenanceEvent(record.event);
    if (index % VERIFY_CHUNK === VERIFY_CHUNK - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const oldest = records.at(-1);

  return {
    records,
    // A short page means the relay had nothing more to give; stop rather than
    // spinning on an `until` that returns the same tail forever.
    nextCursor:
      records.length < PAGE_SIZE || !oldest ? null : oldest.createdAt - 1,
  };
}

export function useAgentProvenanceQuery(pubkey: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: provenanceQueryKeys.agent(pubkey ?? ""),
    // biome-ignore lint/style/noNonNullAssertion: guarded by enabled: !!pubkey
    queryFn: ({ pageParam }) => fetchProvenancePage(pubkey!, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!pubkey,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}
