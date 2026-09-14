import * as React from "react";
import { Check, Plus } from "lucide-react";

import {
  managedAgentsQueryKey,
  useCreateManagedAgentMutation,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import {
  useOperatorForgeSettingsQuery,
  useSaveOperatorForgePreferencesMutation,
} from "@/features/agents/operatorForgeQueries";
import { AgentDialog } from "@/features/agents/ui/AgentDialog";
import { usePersonaActions } from "@/features/agents/ui/usePersonaActions";
import { discoverNativeResidents } from "@/shared/api/tauri";
import type { AgentRuntimeTargetV1 } from "@/shared/api/tauriOperatorForge";
import { setResidentContinuityEnabled } from "@/shared/api/tauriContinuity";
import type {
  DiscoveredResidentCandidate,
  NativeRuntimeDiscoveryOutcome,
  RuntimeBinding,
} from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useQueryClient } from "@tanstack/react-query";
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

export type PolyphonicAgentsStepHandle = {
  commit: () => Promise<
    { issueCount: number; residentCount: number } | undefined
  >;
};

const LUCA_PERSONA_ID = "builtin:fizz";

function bindingIdentity(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? `hermes:${binding.hermesHome}:${binding.profileName.trim()}`
    : `openclaw:${binding.gatewayIdentity.trim()}:${binding.agentId.trim()}`;
}

export const PolyphonicAgentsStep = React.forwardRef<
  PolyphonicAgentsStepHandle,
  {
    onBusyChange: (busy: boolean) => void;
    onContinueLabelChange: (label: string) => void;
    /** Whether agents brought in here get memory of their own. Recorded with
     *  the owner's other answers; see the row below. */
    residentMemory: boolean;
    onResidentMemoryChange: (value: boolean) => void;
  }
>(function PolyphonicAgentsStep(
  {
    onBusyChange,
    onContinueLabelChange,
    onResidentMemoryChange,
    residentMemory,
  },
  ref,
) {
  const queryClient = useQueryClient();
  const managedQuery = useManagedAgentsQuery();
  const createMutation = useCreateManagedAgentMutation();
  const personas = usePersonaActions();
  const operatorSettings = useOperatorForgeSettingsQuery();
  const saveOperatorSettings = useSaveOperatorForgePreferencesMutation();
  const [candidates, setCandidates] = React.useState<
    DiscoveredResidentCandidate[]
  >([]);
  const [sourceOutcomes, setSourceOutcomes] = React.useState<
    NativeRuntimeDiscoveryOutcome[]
  >([]);
  const [selected, setSelected] = React.useState(
    createEmptyAgentImportSelection,
  );
  const [results, setResults] = React.useState<
    Record<string, PolyphonicAgentImportRowStatus>
  >({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const errorsRef = React.useRef(errors);
  const [isScanning, setIsScanning] = React.useState(true);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [importProgress, setImportProgress] = React.useState<{
    current: number;
    total: number;
  } | null>(null);
  const [continueAnyway, setContinueAnyway] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [runtimeTarget, setRuntimeTarget] =
    React.useState<AgentRuntimeTargetV1 | null>(null);
  const [lucaSelected, setLucaSelected] = React.useState(true);

  // importCandidate is a stable callback the import queue iterates; the answer
  // is read at the moment of the import, not captured when the row last moved.
  const residentMemoryRef = React.useRef(residentMemory);
  residentMemoryRef.current = residentMemory;

  const replaceErrors = React.useCallback(
    (update: (current: Record<string, string>) => Record<string, string>) => {
      const next = update(errorsRef.current);
      errorsRef.current = next;
      setErrors(next);
    },
    [],
  );

  React.useEffect(() => {
    if (!operatorSettings.data) return;
    setRuntimeTarget(
      operatorSettings.data.preferences.defaultRuntimeTarget ??
        operatorSettings.data.recommendation,
    );
    setLucaSelected(operatorSettings.data.preferences.lucaEnabled);
  }, [operatorSettings.data]);

  const existingLuca = (managedQuery.data ?? []).find(
    (resident) => resident.personaId === LUCA_PERSONA_ID,
  );

  const importedBindingIdentities = React.useMemo(
    () =>
      new Set(
        (managedQuery.data ?? [])
          .map((resident) => resident.nativeRuntimeBinding)
          .filter((binding): binding is RuntimeBinding => binding !== null)
          .map(bindingIdentity),
      ),
    [managedQuery.data],
  );
  const importedCandidateIds = React.useMemo(
    () =>
      new Set(
        candidates
          .filter((candidate) =>
            importedBindingIdentities.has(
              bindingIdentity(candidate.bindingPreview),
            ),
          )
          .map((candidate) => candidate.semanticId),
      ),
    [candidates, importedBindingIdentities],
  );
  const importedSemanticIdsRef = React.useRef(importedCandidateIds);
  React.useEffect(() => {
    importedSemanticIdsRef.current = importedCandidateIds;
  }, [importedCandidateIds]);

  const scan = React.useCallback(async (preserveSelection: boolean) => {
    setIsScanning(true);
    setScanError(null);
    try {
      const outcome = await discoverNativeResidents();
      const found = outcome.runtimes.flatMap((runtime) => runtime.candidates);
      setSourceOutcomes(outcome.runtimes);
      setCandidates(found);
      setSelected((current) =>
        preserveSelection
          ? reconcileAgentImportSelection(
              current,
              found,
              importedSemanticIdsRef.current,
            )
          : createEmptyAgentImportSelection(),
      );
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsScanning(false);
    }
  }, []);

  React.useEffect(() => {
    void scan(false);
  }, [scan]);

  const allResidents = managedQuery.data ?? [];
  const visibleCandidates = React.useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          !importedCandidateIds.has(candidate.semanticId) ||
          results[candidate.semanticId] !== undefined,
      ),
    [candidates, importedCandidateIds, results],
  );
  const selectedImportCandidates = React.useMemo(
    () =>
      visibleCandidates.filter(
        (candidate) =>
          selected.has(candidate.semanticId) &&
          isSelectableAgentImportCandidate(candidate) &&
          results[candidate.semanticId] !== "imported",
      ),
    [results, selected, visibleCandidates],
  );

  React.useEffect(() => {
    if (importProgress) {
      onContinueLabelChange(
        `Importing ${importProgress.current} of ${importProgress.total}`,
      );
    } else if (continueAnyway) {
      onContinueLabelChange("Continue anyway");
    } else if (selectedImportCandidates.length > 0) {
      onContinueLabelChange(
        `Import ${selectedImportCandidates.length} and continue`,
      );
    } else {
      onContinueLabelChange("Continue");
    }
  }, [
    continueAnyway,
    importProgress,
    onContinueLabelChange,
    selectedImportCandidates.length,
  ]);

  const refreshResidents = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
    return managedQuery.refetch();
  }, [managedQuery, queryClient]);

  const importCandidate = React.useCallback(
    async (candidate: DiscoveredResidentCandidate): Promise<boolean> => {
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
        // "Give them memory here": continuity is the same kind of memory Luca
        // keeps, and it is the one option this call already takes. Nothing
        // else about memory is decided during setup — the rest of the answer
        // lives in the transaction for WP-ALIVE3 to act on.
        await setResidentContinuityEnabled(
          created.agent.pubkey,
          residentMemoryRef.current,
        );
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
        setSelected((current) => {
          const next = new Set(current);
          next.delete(candidate.semanticId);
          return next;
        });
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
        setSelected((current) => {
          const next = new Set(current);
          next.delete(candidate.semanticId);
          return next;
        });
        return false;
      }
    },
    [createMutation, replaceErrors],
  );

  const commit = React.useCallback(async () => {
    if (continueAnyway) {
      onBusyChange(true);
      try {
        const residents = await refreshResidents();
        return {
          issueCount:
            Object.keys(errorsRef.current).length + (scanError ? 1 : 0),
          residentCount:
            residents.data?.length ?? managedQuery.data?.length ?? 0,
        };
      } finally {
        onBusyChange(false);
      }
    }

    let issueCount = scanError ? 1 : 0;
    let importFailed = false;
    onBusyChange(true);
    try {
      await saveOperatorSettings.mutateAsync({
        defaultRuntimeTarget: runtimeTarget,
        runtimeConfirmed: runtimeTarget !== null,
        lucaEnabled: lucaSelected || existingLuca !== undefined,
      });
      // Luca is not created here. The reading step owns making Luca ready —
      // activating the persona, creating the resident on the chosen runtime,
      // opening the DM and publishing the one greeting — so that this step
      // creating a second Luca cannot race it. This step records the runtime
      // and brings in the agents that are already on the Mac.

      const importQueue = [...selectedImportCandidates];
      for (const [index, candidate] of importQueue.entries()) {
        setImportProgress({ current: index + 1, total: importQueue.length });
        const imported = await importCandidate(candidate);
        if (!imported) {
          issueCount += 1;
          importFailed = true;
        }
      }
      setImportProgress(null);
      const residents = await refreshResidents();
      if (importFailed) {
        setContinueAnyway(true);
        return undefined;
      }
      return {
        issueCount,
        residentCount: residents.data?.length ?? managedQuery.data?.length ?? 0,
      };
    } finally {
      setImportProgress(null);
      onBusyChange(false);
    }
  }, [
    continueAnyway,
    existingLuca,
    importCandidate,
    lucaSelected,
    managedQuery,
    onBusyChange,
    refreshResidents,
    runtimeTarget,
    scanError,
    saveOperatorSettings,
    selectedImportCandidates,
  ]);

  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PolyphonicStepHeading
        description="Agents already on your Mac. Bring in whoever you want; the rest can come later."
        stage="agents"
        title="Who else lives here?"
      />
      {/* The runtime was chosen on the screen before this one, and Luca is the
          premise of the place — neither is asked again here. Both are still
          committed with the rest of the answers below. */}
      <div className="mt-4 min-h-0 flex-1">
        <PolyphonicAgentImportPane
          candidates={visibleCandidates}
          compact
          connectedAgents={allResidents.map((resident) => ({
            id: resident.pubkey,
            name: resident.name,
          }))}
          disabled={importProgress !== null}
          isScanning={isScanning}
          onClear={() => {
            setContinueAnyway(false);
            setSelected(clearAgentImportSelection());
          }}
          onRescan={() => void scan(true)}
          onRetryCandidate={(candidate) => {
            void (async () => {
              onBusyChange(true);
              setImportProgress({ current: 1, total: 1 });
              try {
                const imported = await importCandidate(candidate);
                await refreshResidents();
                const remainingErrors = Object.keys(errorsRef.current).filter(
                  (key) => key !== "luca",
                );
                setContinueAnyway(!imported || remainingErrors.length > 0);
              } finally {
                setImportProgress(null);
                onBusyChange(false);
              }
            })();
          }}
          onSelectAllReady={() => {
            setContinueAnyway(false);
            setSelected(
              selectAllReadyAgentImports(
                visibleCandidates,
                importedCandidateIds,
              ),
            );
          }}
          onToggleCandidate={(candidate) => {
            setContinueAnyway(false);
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(candidate.semanticId))
                next.delete(candidate.semanticId);
              else next.add(candidate.semanticId);
              return next;
            });
          }}
          rowErrors={errors}
          rowStatuses={results}
          scanError={scanError}
          selectedIds={selected}
          sourceOutcomes={sourceOutcomes}
        />
      </div>
      {/* One quiet choice under the list: a hairline row, its own border on
          focus, and the honest consequence of saying no. */}
      <button
        aria-pressed={residentMemory}
        className="group mt-3.5 flex w-full shrink-0 items-start gap-3 border-t border-[var(--prototype-hairline)] px-1 pt-2.5 text-left outline-none"
        data-testid="polyphonic-resident-memory"
        onClick={() => onResidentMemoryChange(!residentMemory)}
        type="button"
      >
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
            residentMemory
              ? "border-[var(--prototype-ink)] bg-[var(--prototype-ink)] text-[var(--prototype-field)]"
              : "border-[var(--prototype-hairline)] text-transparent group-hover:border-[var(--prototype-muted)] group-focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_40%,transparent)]",
          )}
        >
          <Check className="size-3" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-[var(--prototype-ink)]">
            Give them memory here
          </span>
          <span className="mt-0.5 block text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
            The same kind Luca has. Say no and what they already remember stays
            exactly as it is.
          </span>
        </span>
      </button>
      <Button
        className="mt-1 h-8 shrink-0 gap-2 self-start rounded-md px-1.5 text-xs font-normal text-[var(--prototype-muted)] hover:bg-[var(--prototype-selection)] hover:text-[var(--prototype-ink)]"
        onClick={() => {
          personas.prepareCreate();
          setCreateOpen(true);
        }}
        type="button"
        variant="ghost"
      >
        <Plus className="h-3.5 w-3.5" /> Add another agent…
      </Button>
      {createOpen ? (
        <AgentDialog
          definitionError={
            personas.createPersonaMutation.error instanceof Error
              ? personas.createPersonaMutation.error
              : null
          }
          isDefinitionPending={personas.isPending}
          mode="definition"
          onOpenChange={setCreateOpen}
          onSubmitDefinition={personas.handleSubmitResident}
          runtimes={personas.acpRuntimesQuery.data ?? []}
          runtimesLoading={personas.acpRuntimesQuery.isLoading}
        />
      ) : null}
    </div>
  );
});
