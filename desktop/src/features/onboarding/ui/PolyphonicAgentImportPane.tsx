import * as React from "react";

import type {
  DiscoveredResidentCandidate,
  NativeDiscoveryStatus,
} from "@/shared/api/types";
import { isReadyAgentImportCandidate } from "../onboardingAgentImport";
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

export type PolyphonicAgentImportSourceOutcome = {
  message?: string;
  nativeType: DiscoveredResidentCandidate["nativeType"];
  status: NativeDiscoveryStatus;
};

export type PolyphonicAgentImportPaneProps = {
  candidates: readonly DiscoveredResidentCandidate[];
  connectedAgents: readonly PolyphonicConnectedAgentSummary[];
  disabled?: boolean;
  isScanning: boolean;
  onClear: () => void;
  onRescan: () => void;
  onRetryCandidate: (candidate: DiscoveredResidentCandidate) => void;
  onSelectAllReady: () => void;
  onToggleCandidate: (candidate: DiscoveredResidentCandidate) => void;
  rowErrors?: Readonly<Record<string, string>>;
  rowStatuses?: Readonly<Record<string, PolyphonicAgentImportRowStatus>>;
  scanError?: string | null;
  selectedIds: ReadonlySet<string>;
  sourceOutcomes?: readonly PolyphonicAgentImportSourceOutcome[];
};

const sourceLabels = { hermes: "Hermes", openclaw: "OpenClaw" } as const;

function detailText(candidate: DiscoveredResidentCandidate): string {
  if (
    candidate.readiness.status === "degraded" ||
    candidate.readiness.status === "unavailable"
  ) {
    return candidate.readiness.message;
  }
  return (
    candidate.modelSummary ??
    candidate.workspace ??
    `${sourceLabels[candidate.nativeType]} agent`
  );
}

function connectedSummary(
  connectedAgents: readonly PolyphonicConnectedAgentSummary[],
): string {
  if (connectedAgents.length === 0) return "";
  const shown = connectedAgents.slice(0, 3).map((agent) => agent.name);
  const remaining = connectedAgents.length - shown.length;
  return `${shown.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`;
}

export function PolyphonicAgentImportPane({
  candidates,
  connectedAgents,
  disabled = false,
  isScanning,
  onClear,
  onRescan,
  onRetryCandidate,
  onSelectAllReady,
  onToggleCandidate,
  rowErrors = {},
  rowStatuses = {},
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
      candidates.map((candidate) => {
        const status = rowStatuses[candidate.semanticId] ?? "idle";
        const needsAttention = status === "needs-attention";
        return {
          detail: needsAttention
            ? (rowErrors[candidate.semanticId] ?? "Needs attention")
            : detailText(candidate),
          disabled:
            candidate.readiness.status === "unavailable" ||
            (!isReadyAgentImportCandidate(candidate) && !needsAttention),
          id: candidate.semanticId,
          name: candidate.displayName,
          source: sourceLabels[candidate.nativeType],
          status,
        };
      }),
    [candidates, rowErrors, rowStatuses],
  );
  const connected = connectedSummary(connectedAgents);
  const sourceMessages = sourceOutcomes.filter(
    (outcome) => outcome.status !== "available" && outcome.message,
  );

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
      <div className="min-h-0 flex-1">
        <PolyphonicPresentationAgentSelector
          agents={agents}
          disabled={disabled}
          isScanning={isScanning}
          onClear={onClear}
          onQueryChange={setQuery}
          onRescan={onRescan}
          onRetry={(id) => {
            const candidate = candidateById.get(id);
            if (candidate) onRetryCandidate(candidate);
          }}
          onSelectAll={onSelectAllReady}
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
      {sourceMessages.map((outcome) => (
        <p
          className="mt-1 shrink-0 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]"
          key={outcome.nativeType}
        >
          {sourceLabels[outcome.nativeType]} · {outcome.message}
        </p>
      ))}
    </section>
  );
}
