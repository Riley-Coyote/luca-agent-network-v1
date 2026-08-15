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
  if (
    candidate.readiness.status === "degraded" ||
    candidate.readiness.status === "unavailable"
  ) {
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
      className="min-w-0"
      data-testid="onboarding-agent-import-pane"
    >
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2
                className="text-sm font-medium text-white/86"
                id="polyphonic-agent-import-title"
              >
                Agents found on this Mac
              </h2>
              <span className="text-xs tabular-nums text-white/36">
                {selectedIds.size} selected
              </span>
            </div>
            {alreadyConnected ? (
              <p className="mt-0.5 truncate text-xs text-white/36">
                Already in Luca · {alreadyConnected}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-white/36">
                Choose only the agents you want to bring in.
              </p>
            )}
          </div>
          <span
            aria-live="polite"
            className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-white/38"
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
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/36"
            />
            <Input
              aria-label="Search agents"
              className="h-8 rounded-md border-white/[0.065] bg-black/15 pl-8 text-sm text-white/82 placeholder:text-white/30 hover:bg-black/20 focus-visible:border-white/12 focus-visible:ring-white/30"
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
              value={query}
            />
          </div>
          <Button
            className="h-8 shrink-0 rounded-md px-2 text-xs font-normal text-white/52 hover:bg-white/[0.045] hover:text-white/86"
            disabled={disabled || isScanning || everyReadySelected}
            onClick={onSelectAllReady}
            size="sm"
            type="button"
            variant="ghost"
          >
            Select all ready
          </Button>
          <Button
            className="h-8 shrink-0 rounded-md px-2 text-xs font-normal text-white/36 hover:bg-white/[0.045] hover:text-white/78"
            disabled={disabled || selectedIds.size === 0}
            onClick={onClear}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
          <Button
            aria-label="Scan again"
            className="h-8 w-8 shrink-0 rounded-md px-0 text-white/36 hover:bg-white/[0.045] hover:text-white/78"
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
          </Button>
        </div>
      </header>

      <section
        aria-busy={isScanning}
        aria-label="Discovered agents"
        className="mt-2.5 h-[clamp(11.5rem,26dvh,15.5rem)] overflow-y-auto overscroll-contain rounded-md border border-white/[0.06] bg-black/10 [scroll-padding-block:0.5rem] [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30"
        data-testid="onboarding-agent-import-list"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the independently scrollable inventory must be reachable by keyboard
        tabIndex={0}
      >
        {!isScanning && !normalizedQuery && candidates.length === 0 ? (
          <div className="border-b border-white/[0.035] px-3 py-2.5 text-center">
            <p className="text-sm text-white/58">No agents found yet.</p>
            <p className="mt-0.5 text-xs leading-5 text-white/38">
              You can continue now and add agents later.
            </p>
          </div>
        ) : null}
        {groups.length > 0 ? (
          <div>
            {groups.map((group) => (
              <section
                aria-labelledby={`polyphonic-agent-source-${group.nativeType}`}
                key={group.nativeType}
              >
                <h3
                  className="sticky top-0 z-10 border-b border-white/[0.04] bg-[hsl(var(--mn-surface)/0.96)] px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.12em] text-white/30 backdrop-blur-sm"
                  id={`polyphonic-agent-source-${group.nativeType}`}
                >
                  {group.label}
                </h3>
                <div className="divide-y divide-white/[0.035]">
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
                        className="flex min-h-11 items-center gap-1"
                        data-testid={`onboarding-agent-row-${candidate.semanticId}`}
                        key={candidate.semanticId}
                      >
                        <button
                          aria-describedby={reasonId}
                          aria-pressed={selected}
                          className={cn(
                            "group flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                            (selected || imported) && "bg-white/[0.045]",
                          )}
                          disabled={rowDisabled}
                          onClick={() => onToggleCandidate(candidate)}
                          type="button"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center text-white/38">
                            {busy ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                            ) : imported ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : needsAttention ? (
                              <TriangleAlert className="h-3.5 w-3.5" />
                            ) : (
                              <Terminal className="h-4 w-4" strokeWidth={1.5} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-white/84">
                              {candidate.displayName}
                            </span>
                            <span
                              className={cn(
                                "block text-xs text-white/38",
                                isReadyAgentImportCandidate(candidate) &&
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
                                "flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-[0.3rem] border transition-colors",
                                selected || imported
                                  ? "border-white bg-white text-black"
                                  : "border-white/18 text-transparent group-hover:border-white/32",
                              )}
                            >
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                        </button>
                        {needsAttention ? (
                          <Button
                            className="mr-1 h-7 shrink-0 rounded-md px-2 text-xs font-normal text-white/64 hover:bg-white/[0.05] hover:text-white"
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
                    <div className="flex items-start gap-2 border-t border-white/[0.035] px-3 py-2 text-xs leading-5 text-white/42">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{group.outcome.message}</span>
                    </div>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[11.5rem] items-center justify-center px-6 text-center">
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
          className="mt-2 flex items-start justify-between gap-3 rounded-md bg-destructive/5 px-3 py-2.5"
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
