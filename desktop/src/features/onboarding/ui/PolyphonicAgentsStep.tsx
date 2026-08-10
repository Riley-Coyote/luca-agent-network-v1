import * as React from "react";
import { Check, LoaderCircle, Plus, RefreshCw, Terminal } from "lucide-react";

import {
  managedAgentsQueryKey,
  useCreateManagedAgentMutation,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import { AgentDialog } from "@/features/agents/ui/AgentDialog";
import { usePersonaActions } from "@/features/agents/ui/usePersonaActions";
import { discoverNativeResidents } from "@/shared/api/tauri";
import { setResidentContinuityEnabled } from "@/shared/api/tauriContinuity";
import type {
  DiscoveredResidentCandidate,
  RuntimeBinding,
} from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  PolyphonicNotice,
  PolyphonicStepHeading,
} from "./PolyphonicSetupFrame";

type CandidateResult = "idle" | "importing" | "ready" | "failed";

export type PolyphonicAgentsStepHandle = {
  commit: () => Promise<{ issueCount: number; residentCount: number }>;
};

function bindingIdentity(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? `hermes:${binding.hermesHome}:${binding.profileName.trim()}`
    : `openclaw:${binding.gatewayIdentity.trim()}:${binding.agentId.trim()}`;
}

export const PolyphonicAgentsStep = React.forwardRef<
  PolyphonicAgentsStepHandle,
  { onBusyChange: (busy: boolean) => void }
>(function PolyphonicAgentsStep({ onBusyChange }, ref) {
  const queryClient = useQueryClient();
  const managedQuery = useManagedAgentsQuery();
  const createMutation = useCreateManagedAgentMutation();
  const personas = usePersonaActions();
  const [candidates, setCandidates] = React.useState<
    DiscoveredResidentCandidate[]
  >([]);
  const [selected, setSelected] = React.useState(new Set<string>());
  const [results, setResults] = React.useState<Record<string, CandidateResult>>(
    {},
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [isScanning, setIsScanning] = React.useState(true);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const importedBindings = React.useMemo(
    () =>
      new Set(
        (managedQuery.data ?? [])
          .map((resident) => resident.nativeRuntimeBinding)
          .filter((binding): binding is RuntimeBinding => binding !== null)
          .map(bindingIdentity),
      ),
    [managedQuery.data],
  );

  const scan = React.useCallback(async () => {
    setIsScanning(true);
    setScanError(null);
    try {
      const outcome = await discoverNativeResidents();
      const found = outcome.runtimes.flatMap((runtime) => runtime.candidates);
      setCandidates(found);
      setSelected(
        new Set(
          found
            .filter(
              (candidate) =>
                candidate.readiness.status === "ready" &&
                !importedBindings.has(
                  bindingIdentity(candidate.bindingPreview),
                ),
            )
            .map((candidate) => candidate.semanticId),
        ),
      );
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsScanning(false);
    }
  }, [importedBindings]);

  React.useEffect(() => {
    void scan();
  }, [scan]);

  const commit = React.useCallback(async () => {
    let issueCount = 0;
    onBusyChange(true);
    try {
      for (const candidate of candidates) {
        if (
          !selected.has(candidate.semanticId) ||
          results[candidate.semanticId] === "ready" ||
          importedBindings.has(bindingIdentity(candidate.bindingPreview))
        ) {
          continue;
        }
        setResults((current) => ({
          ...current,
          [candidate.semanticId]: "importing",
        }));
        setErrors((current) => {
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
            spawnAfterCreate: true,
            startOnAppLaunch: true,
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
            [candidate.semanticId]: "ready",
          }));
        } catch (cause) {
          issueCount += 1;
          setResults((current) => ({
            ...current,
            [candidate.semanticId]: "failed",
          }));
          setErrors((current) => ({
            ...current,
            [candidate.semanticId]:
              cause instanceof Error ? cause.message : String(cause),
          }));
        }
      }
      await queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
      const residents = await managedQuery.refetch();
      return {
        issueCount,
        residentCount: residents.data?.length ?? managedQuery.data?.length ?? 0,
      };
    } finally {
      onBusyChange(false);
    }
  }, [
    candidates,
    createMutation,
    importedBindings,
    managedQuery,
    onBusyChange,
    queryClient,
    results,
    selected,
  ]);

  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  const allResidents = managedQuery.data ?? [];
  const visibleCandidates = candidates.filter(
    (candidate) =>
      !importedBindings.has(bindingIdentity(candidate.bindingPreview)),
  );

  return (
    <>
      <PolyphonicStepHeading
        description="Polyphonic found agents already set up on this Mac. Bring in the ones you want now; their models and native settings stay unchanged."
        stage="agents"
        title="Bring your agents together"
      />
      <div className="mt-6 overflow-hidden rounded-lg border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))]">
        {allResidents.map((resident) => (
          <div
            className="flex min-h-14 items-center gap-3 border-b border-[hsl(var(--mn-border))] px-3.5 py-2 last:border-b-0"
            key={resident.pubkey}
          >
            <AgentIdentitySpecimen
              accessibleName={resident.name}
              publicKey={resident.pubkey}
              size={36}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-white/88">
                {resident.name}
              </span>
              <span className="block text-xs text-white/46">Connected</span>
            </span>
            <Check aria-label="Connected" className="h-4 w-4 text-white/72" />
          </div>
        ))}
        {visibleCandidates.map((candidate) => {
          const isSelected = selected.has(candidate.semanticId);
          const result = results[candidate.semanticId] ?? "idle";
          const unavailable = candidate.readiness.status === "unavailable";
          return (
            <button
              aria-pressed={isSelected}
              className="group flex min-h-14 w-full items-center gap-3 border-b border-[hsl(var(--mn-border))] px-3.5 py-2 text-left last:border-b-0 hover:bg-[hsl(var(--mn-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
              disabled={unavailable || result === "importing"}
              key={candidate.semanticId}
              onClick={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(candidate.semanticId))
                    next.delete(candidate.semanticId);
                  else next.add(candidate.semanticId);
                  return next;
                })
              }
              type="button"
            >
              <span className="flex h-9 w-9 items-center justify-center border border-[hsl(var(--mn-border))] text-white/52">
                {result === "importing" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Terminal className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-white/88">
                  {candidate.displayName}
                </span>
                <span className="block truncate text-xs text-white/46">
                  {candidate.nativeType === "hermes" ? "Hermes" : "OpenClaw"}
                  {result === "failed" ? " · Needs attention" : ""}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border",
                  isSelected
                    ? "border-white bg-white text-black"
                    : "border-white/20 text-transparent",
                )}
              >
                <Check className="h-3 w-3" />
              </span>
            </button>
          );
        })}
        {!isScanning &&
        allResidents.length === 0 &&
        visibleCandidates.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-white/52">
            No agents found yet. You can create one now or continue without
            agents.
          </div>
        ) : null}
      </div>
      {isScanning ? (
        <p
          className="mt-3 flex items-center gap-2 text-sm text-white/52"
          role="status"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" /> Looking for agents…
        </p>
      ) : null}
      {scanError ? (
        <PolyphonicNotice kind="error">
          <div className="flex items-center justify-between gap-3">
            <span>{scanError}</span>
            <Button onClick={() => void scan()} size="sm" variant="ghost">
              <RefreshCw /> Scan again
            </Button>
          </div>
        </PolyphonicNotice>
      ) : null}
      {Object.entries(errors).map(([id, message]) => (
        <PolyphonicNotice key={id} kind="error">
          {message}
        </PolyphonicNotice>
      ))}
      <Button
        className="mt-2 h-10 gap-2 rounded-lg px-2.5 text-sm text-white/60 hover:bg-white/[0.04] hover:text-white"
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
