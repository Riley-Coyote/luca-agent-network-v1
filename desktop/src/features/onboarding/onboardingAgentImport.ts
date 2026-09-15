import { useQuery, type QueryClient } from "@tanstack/react-query";

import { discoverNativeResidents } from "@/shared/api/tauri";
import type {
  DiscoveredResidentCandidate,
  NativeResidentDiscoveryOutcome,
} from "@/shared/api/types";

export const nativeResidentDiscoveryQueryKey = [
  "native-resident-discovery",
] as const;

/**
 * Looking around the Mac takes as long as it takes, and the agents chapter
 * must paint its rows the moment it opens. The scan is therefore one query,
 * warmed a chapter early (see the flow) and read here from the cache.
 */
const DISCOVERY_STALE_MS = 60_000;

export function useNativeResidentDiscoveryQuery() {
  return useQuery({
    queryKey: nativeResidentDiscoveryQueryKey,
    queryFn: discoverNativeResidents,
    staleTime: DISCOVERY_STALE_MS,
  });
}

/** Start the scan without waiting for it; failures surface on the step. */
export function prefetchNativeResidentDiscovery(client: QueryClient) {
  void client
    .prefetchQuery({
      queryKey: nativeResidentDiscoveryQueryKey,
      queryFn: discoverNativeResidents,
      staleTime: DISCOVERY_STALE_MS,
    })
    .catch(() => {
      // The agents chapter runs the same query and shows what went wrong;
      // a warm-up that fails must never surface on the chapter before it.
    });
}

/** Every candidate any source returned, in the sources' own order. */
export function candidatesFromDiscovery(
  outcome: NativeResidentDiscoveryOutcome | undefined,
): DiscoveredResidentCandidate[] {
  return (outcome?.runtimes ?? []).flatMap((runtime) => runtime.candidates);
}

export type NativeAgentImportGroup = {
  nativeType: DiscoveredResidentCandidate["nativeType"];
  label: string;
  candidates: DiscoveredResidentCandidate[];
};

const NATIVE_SOURCE_ORDER: ReadonlyArray<
  DiscoveredResidentCandidate["nativeType"]
> = ["hermes", "openclaw"];

const NATIVE_SOURCE_LABELS: Record<
  DiscoveredResidentCandidate["nativeType"],
  string
> = {
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

/** New onboarding visits never opt imported native agents in implicitly. */
export function createEmptyAgentImportSelection(): Set<string> {
  return new Set();
}

/** Unavailable identities stay visible but cannot be selected for import. */
export function isSelectableAgentImportCandidate(
  candidate: DiscoveredResidentCandidate,
): boolean {
  return candidate.readiness.status !== "unavailable";
}

/** Identity and executable are sufficient for the existing import command. */
export function isReadyAgentImportCandidate(
  candidate: DiscoveredResidentCandidate,
): boolean {
  return (
    candidate.readiness.status === "ready" ||
    candidate.readiness.status === "discovered"
  );
}

/** Replace the current selection with every newly importable ready identity. */
export function selectAllReadyAgentImports(
  candidates: readonly DiscoveredResidentCandidate[],
  importedSemanticIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    candidates
      .filter(
        (candidate) =>
          isReadyAgentImportCandidate(candidate) &&
          !importedSemanticIds.has(candidate.semanticId),
      )
      .map((candidate) => candidate.semanticId),
  );
}

export function clearAgentImportSelection(): Set<string> {
  return new Set();
}

/**
 * Preserve choices across an in-step rescan while dropping identities that
 * disappeared, became unavailable, or were imported since the prior scan.
 */
export function reconcileAgentImportSelection(
  currentSelection: ReadonlySet<string>,
  candidates: readonly DiscoveredResidentCandidate[],
  importedSemanticIds: ReadonlySet<string>,
): Set<string> {
  const selectableIds = new Set(
    candidates
      .filter(isSelectableAgentImportCandidate)
      .map((candidate) => candidate.semanticId),
  );

  return new Set(
    [...currentSelection].filter(
      (semanticId) =>
        selectableIds.has(semanticId) && !importedSemanticIds.has(semanticId),
    ),
  );
}

export function filterAgentImportCandidates(
  candidates: readonly DiscoveredResidentCandidate[],
  query: string,
): DiscoveredResidentCandidate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...candidates];

  return candidates.filter((candidate) =>
    [
      candidate.displayName,
      candidate.nativeId,
      candidate.nativeType,
      NATIVE_SOURCE_LABELS[candidate.nativeType],
      candidate.modelSummary,
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
  );
}

/** Group in stable product order while preserving discovery order per source. */
export function groupAgentImportCandidates(
  candidates: readonly DiscoveredResidentCandidate[],
): NativeAgentImportGroup[] {
  return NATIVE_SOURCE_ORDER.flatMap((nativeType) => {
    const sourceCandidates = candidates.filter(
      (candidate) => candidate.nativeType === nativeType,
    );
    return sourceCandidates.length > 0
      ? [
          {
            nativeType,
            label: NATIVE_SOURCE_LABELS[nativeType],
            candidates: sourceCandidates,
          },
        ]
      : [];
  });
}
