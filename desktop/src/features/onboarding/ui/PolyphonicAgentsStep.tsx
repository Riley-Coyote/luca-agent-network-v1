import * as React from "react";
import { Check, Plus } from "lucide-react";

import {
  managedAgentsQueryKey,
  useAcpRuntimesQuery,
  useCreateManagedAgentMutation,
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import {
  availableRuntimesForStart,
  buildInstanceInputForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import {
  useOperatorForgeSettingsQuery,
  useSaveOperatorForgePreferencesMutation,
} from "@/features/agents/operatorForgeQueries";
import { AgentDialog } from "@/features/agents/ui/AgentDialog";
import { AgentRuntimeTargetSelector } from "@/features/agents/ui/AgentRuntimeTargetSelector";
import { usePersonaActions } from "@/features/agents/ui/usePersonaActions";
import { createLucaResident } from "@/features/luca/residents/api";
import { discoverNativeResidents } from "@/shared/api/tauri";
import {
  executeNativeAgentProvisioning,
  previewNativeAgentProvisioning,
  type AgentRuntimeTargetV1,
  type NativeProvisioningPreviewV1,
  type NativeProvisioningRequestV1,
} from "@/shared/api/tauriOperatorForge";
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
import { PolyphonicBrandMark } from "./PolyphonicThresholdField";

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
  }
>(function PolyphonicAgentsStep({ onBusyChange, onContinueLabelChange }, ref) {
  const queryClient = useQueryClient();
  const managedQuery = useManagedAgentsQuery();
  const createMutation = useCreateManagedAgentMutation();
  const personas = usePersonaActions();
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
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
  const [lucaPreview, setLucaPreview] =
    React.useState<NativeProvisioningPreviewV1 | null>(null);
  const [lucaRequest, setLucaRequest] =
    React.useState<NativeProvisioningRequestV1 | null>(null);

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
      if (lucaSelected && !existingLuca && runtimeTarget) {
        const lucaPersona = (personasQuery.data ?? []).find(
          (persona) => persona.id === LUCA_PERSONA_ID,
        );
        if (!lucaPersona) {
          issueCount += 1;
          replaceErrors((current) => ({
            ...current,
            luca: "Luca's built-in definition is unavailable.",
          }));
        } else if (runtimeTarget.kind === "managed") {
          try {
            const runtimes = await availableRuntimesForStart(runtimesQuery);
            const runtime = runtimes.find(
              (candidate) => candidate.id === runtimeTarget.runtimeId,
            );
            if (!runtime)
              throw new Error("The selected runtime is no longer ready.");
            const input = await buildInstanceInputForDefinition(
              lucaPersona,
              runtime,
            );
            await createLucaResident(input);
          } catch (cause) {
            issueCount += 1;
            replaceErrors((current) => ({
              ...current,
              luca: cause instanceof Error ? cause.message : String(cause),
            }));
          }
        } else {
          const request: NativeProvisioningRequestV1 = {
            displayName: "Luca",
            systemPrompt: lucaPersona.systemPrompt,
            runtime: runtimeTarget.runtime,
            mode: "fresh",
            selectedSkills: [],
            includeMemory: false,
            workspaceDocuments: [],
          };
          if (
            !lucaPreview ||
            JSON.stringify(lucaRequest) !== JSON.stringify(request)
          ) {
            setLucaRequest(request);
            setLucaPreview(await previewNativeAgentProvisioning(request));
            return undefined;
          }
          try {
            await executeNativeAgentProvisioning(
              lucaPreview.transactionId,
              LUCA_PERSONA_ID,
              request,
            );
            setLucaPreview(null);
          } catch (cause) {
            issueCount += 1;
            replaceErrors((current) => ({
              ...current,
              luca: cause instanceof Error ? cause.message : String(cause),
            }));
          }
        }
      }

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
    lucaPreview,
    lucaRequest,
    lucaSelected,
    managedQuery,
    onBusyChange,
    personasQuery.data,
    refreshResidents,
    replaceErrors,
    runtimeTarget,
    runtimesQuery,
    scanError,
    saveOperatorSettings,
    selectedImportCandidates,
  ]);

  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  return (
    <>
      <PolyphonicStepHeading
        description="Choose how new agents run, add Luca if you want a conversational operator, and bring in agents already on this Mac."
        stage="agents"
        title="Bring your agents together"
      />
      <div className="mt-7 space-y-4">
        {operatorSettings.data ? (
          <AgentRuntimeTargetSelector
            appearance="onboarding"
            disabled={saveOperatorSettings.isPending}
            onChange={(target) => {
              setRuntimeTarget(target);
              setLucaPreview(null);
            }}
            options={operatorSettings.data.runtimeOptions}
            value={runtimeTarget}
          />
        ) : (
          <p className="text-sm text-white/48" role="status">
            Checking available runtimes…
          </p>
        )}
        <button
          aria-pressed={existingLuca ? true : lucaSelected}
          className="group flex w-full items-center gap-3 rounded-xl bg-white/[0.025] px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_rgb(255_255_255/0.035)] transition-colors hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45"
          disabled={Boolean(existingLuca)}
          onClick={() => setLucaSelected((current) => !current)}
          type="button"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center text-white/70"
          >
            <PolyphonicBrandMark />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-white/88">Luca</span>
            <span className="mt-0.5 block text-xs leading-4 text-white/42">
              Can help organize your Luca home and prepare agent creation for
              your review.
            </span>
          </span>
          <span
            aria-hidden
            className={cn(
              "flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-[0.3rem] border transition-colors",
              existingLuca || lucaSelected
                ? "border-white bg-white text-black"
                : "border-white/18 text-transparent group-hover:border-white/32",
            )}
          >
            <Check className="h-3 w-3" />
          </span>
        </button>
        {lucaPreview ? (
          <section
            className="rounded-lg border border-white/16 bg-white/[0.035] p-3"
            aria-label="Review Luca native creation"
          >
            <p className="text-sm font-medium text-white/88">
              Review Luca's native setup
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-white/56">
              {lucaPreview.changes.map((change) => (
                <li key={`${change.subject}-${change.action}`}>
                  {change.subject} · {change.detail}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-white/42">
              Press Continue again to approve these exact changes.
            </p>
          </section>
        ) : null}
      </div>
      <div className="mt-5">
        <PolyphonicAgentImportPane
          candidates={visibleCandidates}
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
      {errors.luca ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {errors.luca}
        </p>
      ) : null}
      <Button
        className="mt-2 h-9 gap-2 rounded-lg px-2 text-sm font-normal text-white/48 hover:bg-white/[0.035] hover:text-white/82"
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
    </>
  );
});
