import * as React from "react";

import type {
  DiscoveredResidentCandidate,
  NativeRuntimeDiscoveryOutcome,
} from "@/shared/api/types";
import {
  describeDiscoverySources,
  describeResidentCandidate,
  nativeSourceLabel,
} from "./agentReadiness";
import {
  PolyphonicPresentationAgentSelector,
  type PolyphonicPresentationAgent,
} from "./PolyphonicOnboardingPresentation";

export type PolyphonicAgentImportRowStatus =
  | "idle"
  | "importing"
  | "imported"
  | "needs-attention";

export type PolyphonicConnectedAgentSummary = { id: string; name: string };

export type PolyphonicAgentImportPaneProps = {
  candidates: readonly DiscoveredResidentCandidate[];
  /** Plain rows while the list is short; see the selector. */
  compact?: boolean;
  connectedAgents: readonly PolyphonicConnectedAgentSummary[];
  disabled?: boolean;
  /** What the list says when the scan has finished and found nobody. */
  emptyMessage?: string;
  isScanning: boolean;
  onClear?: () => void;
  onRescan?: () => void;
  onSelectAllReady?: () => void;
  onToggleCandidate: (candidate: DiscoveredResidentCandidate) => void;
  scanError?: string | null;
  selectedIds: ReadonlySet<string>;
  sourceOutcomes?: readonly NativeRuntimeDiscoveryOutcome[];
};

function connectedSummary(
  connectedAgents: readonly PolyphonicConnectedAgentSummary[],
): string {
  if (connectedAgents.length === 0) return "";
  const shown = connectedAgents.slice(0, 3).map((agent) => agent.name);
  const remaining = connectedAgents.length - shown.length;
  return `${shown.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`;
}

/**
 * The agents already on this Mac, each a row the owner can tick.
 *
 * Nothing is read or imported here — ticking a row is a choice, acted on in
 * the background once the card has become the application. So every identity
 * the scan returned is offered, including the ones a runtime currently calls
 * unavailable: an import that fails costs the owner nothing but one line on
 * that one row.
 */
export function PolyphonicAgentImportPane({
  candidates,
  compact = false,
  connectedAgents,
  disabled = false,
  emptyMessage,
  isScanning,
  onClear,
  onRescan,
  onSelectAllReady,
  onToggleCandidate,
  scanError = null,
  selectedIds,
  sourceOutcomes = [],
}: PolyphonicAgentImportPaneProps) {
  const [query, setQuery] = React.useState("");
  const candidateById = React.useMemo(
    () =>
      new Map(candidates.map((candidate) => [candidate.semanticId, candidate])),
    [candidates],
  );
  const agents = React.useMemo<PolyphonicPresentationAgent[]>(
    () =>
      candidates.map((candidate) => ({
        detail: describeResidentCandidate(candidate),
        id: candidate.semanticId,
        name: candidate.displayName,
        source: nativeSourceLabel(candidate.nativeType),
        status: "idle" as const,
      })),
    [candidates],
  );
  const connected = connectedSummary(connectedAgents);
  // What a source has to say about itself is said once, above its rows —
  // never repeated on every row it returned.
  const sourceMessages = describeDiscoverySources(sourceOutcomes);

  return (
    <section
      aria-label="Choose agents"
      className="flex h-full min-h-0 flex-col"
      data-testid="onboarding-agent-import-pane"
    >
      {connected ? (
        <p className="mb-2 shrink-0 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
          Already in Polyphonic · {connected}
        </p>
      ) : null}
      {sourceMessages.map((outcome) => (
        <p
          className="mb-2 shrink-0 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]"
          data-testid={`onboarding-agent-source-${outcome.nativeType}`}
          key={outcome.nativeType}
        >
          {nativeSourceLabel(outcome.nativeType)} · {outcome.message}
        </p>
      ))}
      <div className="flex min-h-0 flex-1 flex-col">
        <PolyphonicPresentationAgentSelector
          agents={agents}
          compact={compact}
          disabled={disabled}
          emptyMessage={emptyMessage}
          isScanning={isScanning}
          onClear={onClear ?? (() => undefined)}
          onQueryChange={setQuery}
          onRescan={onRescan}
          onSelectAll={onSelectAllReady ?? (() => undefined)}
          onToggle={(id) => {
            const candidate = candidateById.get(id);
            if (candidate) onToggleCandidate(candidate);
          }}
          query={query}
          selectedIds={selectedIds}
        />
      </div>
      {scanError ? (
        <p
          className="mt-2 shrink-0 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-destructive"
          role="alert"
        >
          {scanError}
        </p>
      ) : null}
    </section>
  );
}
