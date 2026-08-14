import * as React from "react";
import {
  Check,
  LoaderCircle,
  RefreshCw,
  Search,
  Terminal,
  TriangleAlert,
} from "lucide-react";

import type {
  DiscoveredResidentCandidate,
  NativeDiscoveryStatus,
} from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { isReadyAgentImportCandidate } from "../onboardingAgentImport";

export type PolyphonicAgentImportRowStatus =
  | "idle"
  | "importing"
  | "imported"
  | "needs-attention";

export type PolyphonicConnectedAgentSummary = {
  id: string;
  name: string;
};

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

const sourceDetails = {
  hermes: { label: "Hermes", order: 0 },
  openclaw: { label: "OpenClaw", order: 1 },
} as const;

function searchableText(candidate: DiscoveredResidentCandidate): string {
  return [
    candidate.displayName,
    candidate.nativeId,
    candidate.modelSummary,
    candidate.workspace,
    sourceDetails[candidate.nativeType].label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function detailText(candidate: DiscoveredResidentCandidate): string {
  if (candidate.readiness.status !== "ready") {
    return candidate.readiness.message;
  }
  return (
    candidate.modelSummary ??
    candidate.workspace ??
    `${sourceDetails[candidate.nativeType].label} agent`
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
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleCandidates = React.useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          normalizedQuery.length === 0 ||
          searchableText(candidate).includes(normalizedQuery),
      ),
    [candidates, normalizedQuery],
  );
  const groups = React.useMemo(
    () =>
      (
        Object.keys(
          sourceDetails,
        ) as DiscoveredResidentCandidate["nativeType"][]
      )
        .sort(
          (left, right) =>
            sourceDetails[left].order - sourceDetails[right].order,
        )
        .map((nativeType) => ({
          label: sourceDetails[nativeType].label,
          nativeType,
          outcome: sourceOutcomes.find(
            (outcome) => outcome.nativeType === nativeType,
          ),
          candidates: visibleCandidates.filter(
            (candidate) => candidate.nativeType === nativeType,
          ),
        }))
        .filter(
          (group) =>
            group.candidates.length > 0 ||
            (normalizedQuery.length === 0 &&
              group.outcome?.status !== "available" &&
              Boolean(group.outcome?.message)),
        ),
    [normalizedQuery, sourceOutcomes, visibleCandidates],
  );
  const readyCandidates = candidates.filter(
    (candidate) =>
      isReadyAgentImportCandidate(candidate) &&
      rowStatuses[candidate.semanticId] !== "imported",
  );
  const everyReadySelected =
    readyCandidates.length > 0 &&
    readyCandidates.every((candidate) => selectedIds.has(candidate.semanticId));
  const alreadyConnected = connectedSummary(connectedAgents);

  return (
    <section
      aria-labelledby="polyphonic-agent-import-title"
      className="overflow-hidden rounded-lg border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))]"
      data-testid="onboarding-agent-import-pane"
    >
      <header className="space-y-3 border-b border-[hsl(var(--mn-border))] px-3.5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2
                className="text-sm font-medium text-white/88"
                id="polyphonic-agent-import-title"
              >
                Agents found on this Mac
              </h2>
              <span className="text-xs tabular-nums text-white/42">
                {selectedIds.size} selected
              </span>
            </div>
            {alreadyConnected ? (
              <p className="mt-1 truncate text-xs text-white/42">
                Already in Luca · {alreadyConnected}
              </p>
            ) : (
              <p className="mt-1 text-xs text-white/42">
                Choose only the agents you want to bring in.
              </p>
            )}
          </div>
          <span
            aria-live="polite"
            className="flex shrink-0 items-center gap-1.5 text-xs text-white/46"
            role="status"
          >
            {isScanning ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                Scanning…
              </>
            ) : (
              `${candidates.length} found`
            )}
          </span>
        </div>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/38"
          />
          <Input
            aria-label="Search agents"
            className="h-8 border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-raised))] pl-8 text-sm text-white/84 placeholder:text-white/36 focus-visible:ring-white/50"
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            value={query}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            className="h-7 rounded-md px-2 text-xs font-normal text-white/58 hover:bg-white/[0.05] hover:text-white/88"
            disabled={disabled || isScanning || everyReadySelected}
            onClick={onSelectAllReady}
            size="sm"
            type="button"
            variant="ghost"
          >
            Select all ready
          </Button>
          <Button
            className="h-7 rounded-md px-2 text-xs font-normal text-white/46 hover:bg-white/[0.05] hover:text-white/80"
            disabled={disabled || selectedIds.size === 0}
            onClick={onClear}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
          <Button
            className="ml-auto h-7 rounded-md px-2 text-xs font-normal text-white/46 hover:bg-white/[0.05] hover:text-white/80"
            disabled={disabled || isScanning}
            onClick={onRescan}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                isScanning && "animate-spin motion-reduce:animate-none",
              )}
            />
            Scan again
          </Button>
        </div>
      </header>

      <section
        aria-busy={isScanning}
        aria-label="Discovered agents"
        className="h-[clamp(14rem,34dvh,22rem)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
        data-testid="onboarding-agent-import-list"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the independently scrollable inventory must be reachable by keyboard
        tabIndex={0}
      >
        {groups.length > 0 ? (
          <div>
            {groups.map((group) => (
              <section
                aria-labelledby={`polyphonic-agent-source-${group.nativeType}`}
                key={group.nativeType}
              >
                <h3
                  className="sticky top-0 z-10 border-b border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))] px-3.5 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-white/36"
                  id={`polyphonic-agent-source-${group.nativeType}`}
                >
                  {group.label}
                </h3>
                <div>
                  {group.candidates.map((candidate) => {
                    const selected = selectedIds.has(candidate.semanticId);
                    const status = rowStatuses[candidate.semanticId] ?? "idle";
                    const unavailable =
                      candidate.readiness.status === "unavailable";
                    const busy = status === "importing";
                    const imported = status === "imported";
                    const needsAttention = status === "needs-attention";
                    const reasonId = `polyphonic-agent-${candidate.semanticId}-detail`;
                    const rowDisabled =
                      disabled || busy || imported || unavailable;

                    return (
                      <div
                        className="flex min-h-14 items-center gap-2 border-b border-[hsl(var(--mn-border))] px-2 py-1 last:border-b-0"
                        data-testid={`onboarding-agent-row-${candidate.semanticId}`}
                        key={candidate.semanticId}
                      >
                        <button
                          aria-describedby={reasonId}
                          aria-pressed={selected}
                          className="group flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1.5 text-left hover:bg-[hsl(var(--mn-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                          disabled={rowDisabled}
                          onClick={() => onToggleCandidate(candidate)}
                          type="button"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-[hsl(var(--mn-border))] text-white/48">
                            {busy ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                            ) : imported ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : needsAttention ? (
                              <TriangleAlert className="h-3.5 w-3.5" />
                            ) : (
                              <Terminal className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-white/86">
                              {candidate.displayName}
                            </span>
                            <span
                              className={cn(
                                "block text-xs text-white/42",
                                candidate.readiness.status === "ready" &&
                                  !needsAttention
                                  ? "truncate"
                                  : "line-clamp-2 leading-4",
                                needsAttention && "text-destructive",
                              )}
                              id={reasonId}
                              title={
                                needsAttention
                                  ? (rowErrors[candidate.semanticId] ??
                                    "Needs attention")
                                  : detailText(candidate)
                              }
                            >
                              {busy
                                ? "Importing"
                                : imported
                                  ? "Imported"
                                  : needsAttention
                                    ? (rowErrors[candidate.semanticId] ??
                                      "Needs attention")
                                    : detailText(candidate)}
                            </span>
                          </span>
                          {!needsAttention ? (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                                selected || imported
                                  ? "border-white bg-white text-black"
                                  : "border-white/20 text-transparent",
                              )}
                            >
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                        </button>
                        {needsAttention ? (
                          <Button
                            className="h-7 shrink-0 rounded-md px-2 text-xs font-normal text-white/64 hover:bg-white/[0.05] hover:text-white"
                            disabled={disabled}
                            onClick={() => onRetryCandidate(candidate)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                  {group.outcome?.status !== "available" &&
                  group.outcome?.message ? (
                    <div className="flex items-start gap-2 border-b border-[hsl(var(--mn-border))] px-3.5 py-2.5 text-xs leading-5 text-white/46 last:border-b-0">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{group.outcome.message}</span>
                    </div>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[14rem] items-center justify-center px-6 text-center">
            <div>
              {isScanning ? (
                <LoaderCircle className="mx-auto h-4 w-4 animate-spin text-white/42 motion-reduce:animate-none" />
              ) : null}
              <p className="mt-2 text-sm text-white/58">
                {normalizedQuery
                  ? "No matching agents"
                  : isScanning
                    ? "Looking for agents…"
                    : "No agents found yet."}
              </p>
              {!isScanning && !normalizedQuery ? (
                <p className="mt-1 text-xs leading-5 text-white/38">
                  You can continue now and add agents later.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </section>

      {scanError ? (
        <div
          className="flex items-start justify-between gap-3 border-t border-[hsl(var(--mn-border))] px-3.5 py-2.5"
          role="alert"
        >
          <span className="min-w-0 text-xs leading-5 text-destructive">
            {scanError}
          </span>
        </div>
      ) : null}
    </section>
  );
}
