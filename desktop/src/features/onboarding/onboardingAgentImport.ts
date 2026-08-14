import type { DiscoveredResidentCandidate } from "@/shared/api/types";

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
