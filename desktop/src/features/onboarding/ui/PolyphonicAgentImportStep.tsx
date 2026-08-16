import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  managedAgentsQueryKey,
  useCreateManagedAgentMutation,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import { setResidentContinuityEnabled } from "@/shared/api/tauriContinuity";
import type {
  DiscoveredResidentCandidate,
  NativeResidentDiscoveryOutcome,
  RuntimeBinding,
} from "@/shared/api/types";
import {
  clearAgentImportSelection,
  createEmptyAgentImportSelection,
  isSelectableAgentImportCandidate,
  reconcileAgentImportSelection,
  selectAllReadyAgentImports,
} from "../onboardingAgentImport";
import {
  PolyphonicAgentImportPane,
  type PolyphonicAgentImportRowStatus,
} from "./PolyphonicAgentImportPane";
import { PolyphonicStepHeading } from "./PolyphonicSetupFrame";

export type PolyphonicAgentImportStepHandle = {
  commit: () => Promise<{ issueCount: number } | undefined>;
  showSummary: () => void;
};

export type PolyphonicAgentImportMode = "summary" | "select";

function bindingIdentity(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? `hermes:${binding.hermesHome}:${binding.profileName.trim()}`
    : `openclaw:${binding.gatewayIdentity.trim()}:${binding.agentId.trim()}`;
}

export const PolyphonicAgentImportStep = React.forwardRef<
  PolyphonicAgentImportStepHandle,
  {
    discovery: NativeResidentDiscoveryOutcome;
    onBusyChange: (busy: boolean) => void;
    onContinueLabelChange: (label: string) => void;
    onModeChange: (mode: PolyphonicAgentImportMode) => void;
    onRescan: () => Promise<NativeResidentDiscoveryOutcome>;
  }
>(function PolyphonicAgentImportStep(
  { discovery, onBusyChange, onContinueLabelChange, onModeChange, onRescan },
  ref,
) {
  const queryClient = useQueryClient();
  const managedQuery = useManagedAgentsQuery();
  const createMutation = useCreateManagedAgentMutation();
  const [outcome, setOutcome] = React.useState(discovery);
  const [selected, setSelected] = React.useState(
    createEmptyAgentImportSelection,
  );
  const [results, setResults] = React.useState<
    Record<string, PolyphonicAgentImportRowStatus>
  >({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const errorsRef = React.useRef(errors);
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{
    current: number;
    total: number;
  } | null>(null);
  const [continueAnyway, setContinueAnyway] = React.useState(false);
  const [mode, setMode] = React.useState<PolyphonicAgentImportMode>("summary");

  const candidates = React.useMemo(
    () => outcome.runtimes.flatMap((runtime) => runtime.candidates),
    [outcome],
  );
  const existingBindings = React.useMemo(
    () =>
      new Set(
        (managedQuery.data ?? [])
          .map((resident) => resident.nativeRuntimeBinding)
          .filter((binding): binding is RuntimeBinding => binding !== null)
          .map(bindingIdentity),
      ),
    [managedQuery.data],
  );
  const importedIds = React.useMemo(
    () =>
      new Set(
        candidates
          .filter((candidate) =>
            existingBindings.has(bindingIdentity(candidate.bindingPreview)),
          )
          .map((candidate) => candidate.semanticId),
      ),
    [candidates, existingBindings],
  );
  const visibleCandidates = candidates.filter(
    (candidate) =>
      !importedIds.has(candidate.semanticId) || results[candidate.semanticId],
  );
  const selectedCandidates = visibleCandidates.filter(
    (candidate) =>
      selected.has(candidate.semanticId) &&
      isSelectableAgentImportCandidate(candidate) &&
      results[candidate.semanticId] !== "imported",
  );

  React.useEffect(() => {
    if (mode === "summary") {
      onContinueLabelChange("Choose agents");
    } else if (progress) {
      onContinueLabelChange(
        `Importing ${progress.current} of ${progress.total}`,
      );
    } else if (continueAnyway) {
      onContinueLabelChange("Continue anyway");
    } else if (selectedCandidates.length) {
      onContinueLabelChange(`Import ${selectedCandidates.length} and continue`);
    } else {
      onContinueLabelChange("Continue");
    }
  }, [
    continueAnyway,
    mode,
    onContinueLabelChange,
    progress,
    selectedCandidates.length,
  ]);

  const replaceErrors = React.useCallback(
    (update: (current: Record<string, string>) => Record<string, string>) => {
      const next = update(errorsRef.current);
      errorsRef.current = next;
      setErrors(next);
    },
    [],
  );

  const refreshResidents = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
    await managedQuery.refetch();
  }, [managedQuery, queryClient]);

  const importCandidate = React.useCallback(
    async (candidate: DiscoveredResidentCandidate) => {
      setResults((current) => ({
        ...current,
        [candidate.semanticId]: "importing",
      }));
      replaceErrors((current) => {
        const next = { ...current };
        delete next[candidate.semanticId];
        return next;
      });
      try {
        const created = await createMutation.mutateAsync({
          name: candidate.displayName,
          agentCommand: candidate.bindingPreview.executablePath,
          agentArgs: ["acp"],
          harnessOverride: true,
          parallelism: 1,
          nativeRuntimeBinding: candidate.bindingPreview,
          spawnAfterCreate: false,
          startOnAppLaunch: false,
        });
        await setResidentContinuityEnabled(created.agent.pubkey, true);
        if (created.spawnError || created.profileSyncError) {
          throw new Error(
            created.spawnError ??
              created.profileSyncError ??
              "Import needs attention",
          );
        }
        setResults((current) => ({
          ...current,
          [candidate.semanticId]: "imported",
        }));
        return true;
      } catch (cause) {
        setResults((current) => ({
          ...current,
          [candidate.semanticId]: "needs-attention",
        }));
        replaceErrors((current) => ({
          ...current,
          [candidate.semanticId]:
            cause instanceof Error ? cause.message : String(cause),
        }));
        return false;
      } finally {
        setSelected((current) => {
          const next = new Set(current);
          next.delete(candidate.semanticId);
          return next;
        });
      }
    },
    [createMutation, replaceErrors],
  );

  const commit = React.useCallback(async () => {
    if (mode === "summary") {
      setMode("select");
      onModeChange("select");
      return undefined;
    }
    if (continueAnyway)
      return { issueCount: Object.keys(errorsRef.current).length };
    onBusyChange(true);
    let failed = false;
    try {
      for (const [index, candidate] of selectedCandidates.entries()) {
        setProgress({ current: index + 1, total: selectedCandidates.length });
        if (!(await importCandidate(candidate))) failed = true;
      }
      await refreshResidents();
      if (failed) {
        setContinueAnyway(true);
        return undefined;
      }
      return { issueCount: Object.keys(errorsRef.current).length };
    } finally {
      setProgress(null);
      onBusyChange(false);
    }
  }, [
    continueAnyway,
    importCandidate,
    mode,
    onBusyChange,
    onModeChange,
    refreshResidents,
    selectedCandidates,
  ]);
  const showSummary = React.useCallback(() => {
    setMode("summary");
    onModeChange("summary");
  }, [onModeChange]);
  React.useImperativeHandle(ref, () => ({ commit, showSummary }), [
    commit,
    showSummary,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PolyphonicStepHeading
        key={mode}
        description={
          mode === "summary"
            ? `We found ${candidates.length} agents on this Mac. Nothing is imported unless you choose it.`
            : "Nothing is imported unless you select it."
        }
        stage="agents"
        title={
          mode === "summary"
            ? "Bring in agents you already use"
            : "Choose agents"
        }
      />
      {mode === "summary" ? (
        <div className="mt-7 grid grid-cols-2 gap-5 rounded-[10px] bg-[var(--prototype-recessed)] px-4 py-3.5">
          {(["hermes", "openclaw"] as const).map((nativeType) => {
            const runtime = outcome.runtimes.find(
              (candidate) => candidate.nativeType === nativeType,
            );
            return (
              <div key={nativeType}>
                <p className="text-sm font-medium text-[var(--prototype-ink)]">
                  {nativeType === "hermes" ? "Hermes" : "OpenClaw"}
                </p>
                <p className="mt-1 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
                  {runtime?.candidates.length ?? 0}{" "}
                  {nativeType === "hermes" ? "profiles" : "agents"} found
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1">
          <PolyphonicAgentImportPane
            candidates={visibleCandidates}
            connectedAgents={(managedQuery.data ?? []).map((resident) => ({
              id: resident.pubkey,
              name: resident.name,
            }))}
            disabled={progress !== null}
            isScanning={isScanning}
            onClear={() => {
              setContinueAnyway(false);
              setSelected(clearAgentImportSelection());
            }}
            onRescan={() => {
              void (async () => {
                setIsScanning(true);
                setScanError(null);
                try {
                  const next = await onRescan();
                  setOutcome(next);
                  const nextCandidates = next.runtimes.flatMap(
                    (runtime) => runtime.candidates,
                  );
                  setSelected((current) =>
                    reconcileAgentImportSelection(
                      current,
                      nextCandidates,
                      importedIds,
                    ),
                  );
                } catch (cause) {
                  setScanError(
                    cause instanceof Error ? cause.message : String(cause),
                  );
                } finally {
                  setIsScanning(false);
                }
              })();
            }}
            onRetryCandidate={(candidate) =>
              void importCandidate(candidate).then(refreshResidents)
            }
            onSelectAllReady={() =>
              setSelected(
                selectAllReadyAgentImports(visibleCandidates, importedIds),
              )
            }
            onToggleCandidate={(candidate) =>
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(candidate.semanticId))
                  next.delete(candidate.semanticId);
                else next.add(candidate.semanticId);
                return next;
              })
            }
            rowErrors={errors}
            rowStatuses={results}
            scanError={scanError}
            selectedIds={selected}
            sourceOutcomes={outcome.runtimes}
          />
        </div>
      )}
    </div>
  );
});
