import * as React from "react";
import { useQueries } from "@tanstack/react-query";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useArtifactLibrary } from "@/features/artifacts/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { listResidentNotebookItems } from "@/shared/api/tauriNotebook";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  isNewSince,
  lastVisitOf,
  mindVisitsVersion,
  subscribeMindVisits,
} from "./mindVisits";

const ACTIVE_ARTIFACTS = {
  deletedState: "active",
  kind: "all",
  query: "",
} as const;

/**
 * Which minds have something new since you last looked (BETA14_RELEASE.md
 * WP-42, Decided 8), for the dot on their rail row: a piece they made, or
 * a journal page or note they kept, after your last visit. Read from the
 * Library and each local notebook; the relay's signed record is read only
 * on their page, so a day entry alone marks their page, not the rail.
 */
export function useMindFreshness(): ReadonlySet<string> {
  const { activeCommunity } = useCommunities();
  const scope = activeCommunity?.id ?? null;
  const version = React.useSyncExternalStore(
    subscribeMindVisits,
    mindVisitsVersion,
  );
  const agents = useManagedAgentsQuery();
  const artifacts = useArtifactLibrary(ACTIVE_ARTIFACTS);
  const local = (agents.data ?? []).filter(
    (agent) => agent.backend.type === "local",
  );
  const notebooks = useQueries({
    queries: local.map((agent) => ({
      queryFn: () => listResidentNotebookItems(agent.pubkey, 0, 25),
      queryKey: ["mind-freshness-notebook", normalizePubkey(agent.pubkey)],
      retry: false,
      staleTime: 30_000,
    })),
  });
  // One word for every notebook's latest answer, so the dot is worked out
  // again only when one of them changes.
  const notebooksAt = notebooks.map((each) => each.dataUpdatedAt).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-reads the visits; `notebooksAt` stands for the notebooks' answers.
  return React.useMemo(() => {
    const fresh = new Set<string>();
    if (!scope) return fresh;
    const newest = new Map<string, number>();
    const note = (pubkey: string, at: number) => {
      const key = normalizePubkey(pubkey);
      newest.set(key, Math.max(newest.get(key) ?? 0, at));
    };
    for (const page of artifacts.data?.pages ?? [])
      for (const artifact of page.artifacts) {
        const owner = artifact.provenance.residentPubkey;
        if (owner) note(owner, Date.parse(artifact.createdAt) || 0);
      }
    local.forEach((agent, index) => {
      for (const item of notebooks[index]?.data?.items ?? [])
        if (item.status === "active" && item.kind !== "journal_annotation")
          note(agent.pubkey, Date.parse(item.createdAt) || 0);
    });
    for (const [pubkey, at] of newest)
      if (isNewSince(at, lastVisitOf(scope, pubkey))) fresh.add(pubkey);
    return fresh;
  }, [artifacts.data, agents.data, scope, version, notebooksAt]);
}
