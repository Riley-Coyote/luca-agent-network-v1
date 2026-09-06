import * as React from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import {
  consumePendingSnapshotImport,
  subscribeSnapshotImport,
} from "@/features/agents/openSnapshotImportFromUrlEvent";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useOpenDmMutation } from "@/features/channels/hooks";
import { useOperatorForgeSettingsQuery } from "@/features/agents/operatorForgeQueries";
import { AddAgentToChannelDialog } from "./AddAgentToChannelDialog";
import { AddTeamToChannelDialog } from "./AddTeamToChannelDialog";
import { AgentDefaultsDialog } from "./AgentDefaultsDialog";
import { AgentDialog } from "./AgentDialog";
import { PersonaCatalogDialog } from "./PersonaCatalogDialog";
import { PersonaDeleteDialog } from "./PersonaDeleteDialog";
import { PersonaShareDialog } from "./PersonaShareDialog";
import { AgentSnapshotExportDialog } from "./AgentSnapshotExportDialog";
import { AgentSnapshotImportDialog } from "./AgentSnapshotImportDialog";
import { TeamSnapshotExportDialog } from "./TeamSnapshotExportDialog";
import { TeamSnapshotImportDialog } from "./TeamSnapshotImportDialog";
import { TeamShareDialog } from "./TeamShareDialog";
import { TeamDeleteDialog } from "./TeamDeleteDialog";
import { TeamDialog } from "./TeamDialog";
import { TeamsSection } from "./TeamsSection";
import { useManagedAgentActions } from "./useManagedAgentActions";
import { usePersonaActions } from "./usePersonaActions";
import { useTeamActions } from "./useTeamActions";
import { Button } from "@/shared/ui/button";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
import { ResidentSetup } from "@/features/luca/residents/ResidentSetup";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import { NativeResidentImportSection } from "./NativeResidentImportSection";
import { NativeAgentProvisioningDialog } from "./NativeAgentProvisioningDialog";
import { createPersonaDialogState } from "./personaDialogState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { useElementWidth } from "@/shared/hooks/use-mobile";
import {
  AgentLibraryRoster,
  type AgentLibraryFilter,
} from "./AgentLibraryRoster";
import {
  AgentLibraryWorkspace,
  type AgentLibrarySection,
} from "./AgentLibraryWorkspace";
import {
  buildResidentLibrary,
  type ResidentSummaryViewModel,
} from "./agentLibraryViewModel";

const AGENT_LIBRARY_SINGLE_PANE_BREAKPOINT_PX = 600;

export function AgentsView({
  onClearSelection,
  onReviewNativeConsumed,
  onSectionChange,
  onSelectPersona,
  onSelectResident,
  section,
  reviewNative,
  selectedPersonaId,
  selectedPubkey,
}: {
  onClearSelection: () => void;
  onReviewNativeConsumed: () => void;
  onSectionChange: (section: AgentLibrarySection) => void;
  onSelectPersona: (personaId: string) => void;
  onSelectResident: (pubkey: string) => void;
  section: AgentLibrarySection;
  reviewNative: boolean;
  selectedPersonaId: string | null;
  selectedPubkey: string | null;
}) {
  const agents = useManagedAgentActions();
  const personas = usePersonaActions();
  const operatorSettings = useOperatorForgeSettingsQuery();
  const residentsQuery = useLucaResidentsQuery();
  const openDmMutation = useOpenDmMutation();
  const { goChannel } = useAppNavigation();
  const teamImportInputRef = React.useRef<HTMLInputElement | null>(null);
  const aiDefaultsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [isAiDefaultsOpen, setIsAiDefaultsOpen] = React.useState(false);
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [isGroupsOpen, setIsGroupsOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<AgentLibraryFilter>("all");
  const [showMobileRoster, setShowMobileRoster] = React.useState(
    !selectedPubkey && !selectedPersonaId,
  );
  const [libraryContentRef, libraryContentWidthPx] =
    useElementWidth<HTMLDivElement>();
  const isSinglePaneLibrary =
    libraryContentWidthPx > 0 &&
    libraryContentWidthPx < AGENT_LIBRARY_SINGLE_PANE_BREAKPOINT_PX;
  const [instanceToEdit, setInstanceToEdit] =
    React.useState<ManagedAgent | null>(null);

  React.useEffect(() => {
    if (!reviewNative) return;
    setIsAddOpen(true);
    onReviewNativeConsumed();
  }, [onReviewNativeConsumed, reviewNative]);

  React.useEffect(() => {
    if (!isSinglePaneLibrary) return;
    setShowMobileRoster(!selectedPubkey && !selectedPersonaId);
  }, [isSinglePaneLibrary, selectedPersonaId, selectedPubkey]);
  // Exclusivity: create never sets `personaDialogState` (edit/dup/import do),
  // so the create-mode and definition-edit AgentDialog mounts never coexist.
  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false);
  const [nativeCreateRuntime, setNativeCreateRuntime] = React.useState<
    "hermes" | "openclaw" | null
  >(null);
  const effectiveTarget = operatorSettings.data
    ? operatorSettings.data.preferences.runtimeConfirmed
      ? operatorSettings.data.preferences.defaultRuntimeTarget
      : operatorSettings.data.recommendation
    : null;
  const createRuntimeId =
    effectiveTarget?.kind === "managed" ? effectiveTarget.runtimeId : undefined;
  const createInitialValues = React.useMemo(
    () => ({
      ...createPersonaDialogState().initialValues,
      runtime: createRuntimeId,
    }),
    [createRuntimeId],
  );

  function openUnifiedCreate() {
    personas.prepareCreate();
    setIsCreateDialogOpen(true);
  }

  function openResidentCreate() {
    openUnifiedCreate();
  }

  function openGroups() {
    agents.setActionNoticeMessage(null);
    agents.setActionErrorMessage(null);
    setIsGroupsOpen(true);
  }
  const teamActions = useTeamActions(
    {
      setActionNoticeMessage: agents.setActionNoticeMessage,
      setActionErrorMessage: agents.setActionErrorMessage,
    },
    {
      refetchManagedAgents: agents.refetchManagedAgents,
      refetchRelayAgents: agents.refetchRelayAgents,
    },
  );

  const isActionPending =
    agents.isPending ||
    personas.isPending ||
    teamActions.createTeamMutation.isPending ||
    teamActions.updateTeamMutation.isPending ||
    teamActions.deleteTeamMutation.isPending;
  const library = React.useMemo(
    () => buildResidentLibrary(agents.managedAgents, personas.libraryPersonas),
    [agents.managedAgents, personas.libraryPersonas],
  );
  const selectedResident = React.useMemo(() => {
    if (selectedPubkey) {
      const normalized = normalizePubkey(selectedPubkey);
      return (
        library.find(
          (resident) =>
            resident.pubkey && normalizePubkey(resident.pubkey) === normalized,
        ) ?? null
      );
    }
    if (selectedPersonaId) {
      return (
        library.find((resident) => resident.personaId === selectedPersonaId) ??
        null
      );
    }
    return library[0] ?? null;
  }, [library, selectedPersonaId, selectedPubkey]);
  const selectedManagedAgent = React.useMemo(
    () =>
      selectedResident?.pubkey
        ? (agents.managedAgents.find(
            (agent) =>
              normalizePubkey(agent.pubkey) ===
              normalizePubkey(selectedResident.pubkey ?? ""),
          ) ?? null)
        : null,
    [agents.managedAgents, selectedResident],
  );
  const selectedPersona = React.useMemo(
    () =>
      selectedResident?.personaId
        ? (personas.libraryPersonas.find(
            (persona) => persona.id === selectedResident.personaId,
          ) ?? null)
        : null,
    [personas.libraryPersonas, selectedResident],
  );

  React.useEffect(() => {
    if (
      libraryContentWidthPx === 0 ||
      isSinglePaneLibrary ||
      selectedPubkey ||
      selectedPersonaId ||
      !selectedResident
    ) {
      return;
    }
    if (selectedResident.pubkey) {
      onSelectResident(selectedResident.pubkey);
    } else if (selectedResident.personaId) {
      onSelectPersona(selectedResident.personaId);
    }
  }, [
    onSelectPersona,
    onSelectResident,
    isSinglePaneLibrary,
    libraryContentWidthPx,
    selectedPersonaId,
    selectedPubkey,
    selectedResident,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; personas.handleImportSnapshotFile and teamActions.handleImportTeamSnapshotFile are stable
  React.useEffect(() => {
    // Consume a snapshot import that was enqueued before navigation (e.g. from
    // a timeline AgentSnapshotCard click that navigated here).
    const pending = consumePendingSnapshotImport();
    if (pending) {
      if (pending.snapshotKind === "team") {
        void teamActions.handleImportTeamSnapshotFile(
          pending.fileBytes,
          pending.fileName,
        );
      } else {
        void personas.handleImportSnapshotFile(
          pending.fileBytes,
          pending.fileName,
        );
      }
    }

    return subscribeSnapshotImport(({ fileBytes, fileName, snapshotKind }) => {
      if (snapshotKind === "team") {
        void teamActions.handleImportTeamSnapshotFile(fileBytes, fileName);
      } else {
        void personas.handleImportSnapshotFile(fileBytes, fileName);
      }
    });
  }, []);

  const libraryQueries = [
    agents.managedAgentsQuery,
    personas.personasQuery,
  ] as const;
  const isLibraryLoading = libraryQueries.some(
    (queryState) => queryState.data === undefined && queryState.isFetching,
  );
  const hasLibraryError = libraryQueries.some(
    (queryState) => queryState.error !== null,
  );
  const isLibraryRetrying =
    hasLibraryError &&
    libraryQueries.some((queryState) => queryState.isFetching);

  if (isLibraryLoading && !hasLibraryError) {
    return (
      <div
        aria-busy="true"
        className="flex min-h-0 min-w-0 flex-1"
        data-testid="agents-data-loading"
        role="status"
      >
        <span className="sr-only">Loading agents…</span>
        <ViewLoadingFallback delayMs={0} kind="agents" />
      </div>
    );
  }

  if (hasLibraryError) {
    return (
      <AgentLibraryUnavailable
        isRetrying={isLibraryRetrying}
        onRetry={() => {
          void Promise.all(
            libraryQueries.map((queryState) => queryState.refetch()),
          );
        }}
      />
    );
  }

  return (
    <>
      <div
        className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[inherit] bg-card/40"
        data-luca-floor-host
        data-testid="agents-view"
      >
        <div
          className="relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
          data-luca-conversation-surface
          ref={libraryContentRef}
        >
          <div
            className={
              isSinglePaneLibrary
                ? showMobileRoster
                  ? "flex min-h-0 w-full"
                  : "hidden min-h-0"
                : "flex min-h-0"
            }
          >
            <AgentLibraryRoster
              filter={filter}
              onAdd={() => setIsAddOpen(true)}
              onFilterChange={setFilter}
              onGroups={openGroups}
              onOpenDefaults={() => setIsAiDefaultsOpen(true)}
              onQueryChange={setQuery}
              onSelect={(resident: ResidentSummaryViewModel) => {
                setShowMobileRoster(false);
                if (resident.pubkey) onSelectResident(resident.pubkey);
                else if (resident.personaId)
                  onSelectPersona(resident.personaId);
              }}
              query={query}
              residents={library}
              selectedId={selectedResident?.residentId ?? null}
            />
          </div>
          {selectedResident ? (
            <div
              className={
                isSinglePaneLibrary && showMobileRoster
                  ? "hidden min-h-0 min-w-0 flex-1"
                  : "flex min-h-0 min-w-0 flex-1"
              }
            >
              <AgentLibraryWorkspace
                channels={
                  selectedResident.pubkey
                    ? (agents.channelsByPubkey[
                        normalizePubkey(selectedResident.pubkey)
                      ] ?? [])
                    : []
                }
                actionErrorMessage={agents.actionErrorMessage}
                actionNoticeMessage={agents.actionNoticeMessage}
                isActionPending={isActionPending}
                managedAgent={selectedManagedAgent}
                onBack={() => {
                  setShowMobileRoster(true);
                  onClearSelection();
                }}
                onEdit={() => {
                  if (selectedManagedAgent) {
                    setInstanceToEdit(selectedManagedAgent);
                  } else if (selectedPersona) {
                    personas.openEdit(selectedPersona);
                  }
                }}
                onMessage={() => {
                  if (!selectedManagedAgent) return;
                  void openDmMutation
                    .mutateAsync({ pubkeys: [selectedManagedAgent.pubkey] })
                    .then((dm) => goChannel(dm.id));
                }}
                onOpenChannel={(channelId) => {
                  void goChannel(channelId);
                }}
                onSectionChange={onSectionChange}
                onStart={() => {
                  if (selectedManagedAgent) {
                    void agents.handleStart(selectedManagedAgent.pubkey);
                  } else if (selectedPersona) {
                    void agents.handleStartPersona(selectedPersona);
                  }
                }}
                onStop={() => {
                  if (selectedManagedAgent) {
                    void agents.handleStop(selectedManagedAgent.pubkey);
                  }
                }}
                onRestart={() => {
                  if (selectedManagedAgent) {
                    void agents.handleRestart(selectedManagedAgent.pubkey);
                  }
                }}
                onToggleStartOnLaunch={(enabled) => {
                  if (selectedManagedAgent) {
                    void agents.handleToggleStartOnAppLaunch(
                      selectedManagedAgent.pubkey,
                      enabled,
                    );
                  }
                }}
                persona={selectedPersona}
                resident={selectedResident}
                section={section}
                showBackButton={isSinglePaneLibrary}
              />
            </div>
          ) : (
            <div className="hidden min-h-0 min-w-0 flex-1 items-center justify-center px-8 text-center md:flex">
              <div className="max-w-sm">
                <h2 className="text-lg font-medium">No residents yet</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Import an agent already on this Mac or create a new resident.
                </p>
                <Button className="mt-5" onClick={() => setIsAddOpen(true)}>
                  Add agent
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog onOpenChange={setIsAddOpen} open={isAddOpen}>
        <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add an agent</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <NativeResidentImportSection residents={agents.managedAgents} />
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">Create a native agent</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Polyphonic previews every native change before creation.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["hermes", "openclaw"] as const).map((runtime) => (
                  <Button
                    key={runtime}
                    onClick={() => {
                      setIsAddOpen(false);
                      setNativeCreateRuntime(runtime);
                    }}
                    variant="outline"
                  >
                    New {runtime === "hermes" ? "Hermes" : "OpenClaw"} agent…
                  </Button>
                ))}
              </div>
            </section>
            <ResidentSetup
              isLoading={
                residentsQuery.isLoading || personas.personasQuery.isLoading
              }
              isPending={isActionPending}
              onAddResident={(persona) => {
                void agents.handleAddResident(persona).then(() => {
                  setIsAddOpen(false);
                });
              }}
              onCreateResident={() => {
                setIsAddOpen(false);
                openResidentCreate();
              }}
              personas={personas.libraryPersonas}
              residents={residentsQuery.data?.residents ?? []}
              startingPersonaIds={agents.startingPersonaIds}
            />
          </div>
        </DialogContent>
      </Dialog>

      {nativeCreateRuntime ? (
        <NativeAgentProvisioningDialog
          initialRuntime={nativeCreateRuntime}
          onComplete={() => {
            void agents.refetchManagedAgents();
          }}
          onOpenChange={(open) => {
            if (!open) setNativeCreateRuntime(null);
          }}
          open
        />
      ) : null}

      <Dialog onOpenChange={setIsGroupsOpen} open={isGroupsOpen}>
        <DialogContent className="max-h-[86vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agent groups</DialogTitle>
          </DialogHeader>
          <TeamsSection
            actionErrorMessage={agents.actionErrorMessage}
            actionNoticeMessage={agents.actionNoticeMessage}
            error={
              teamActions.teamsQuery.error instanceof Error
                ? teamActions.teamsQuery.error
                : null
            }
            isLoading={teamActions.teamsQuery.isLoading}
            isPending={
              teamActions.createTeamMutation.isPending ||
              teamActions.updateTeamMutation.isPending ||
              teamActions.deleteTeamMutation.isPending
            }
            onAddToChannel={teamActions.setTeamToAddToChannel}
            onCreate={teamActions.openCreateDialog}
            onDelete={teamActions.setTeamToDelete}
            onDuplicate={teamActions.openDuplicateDialog}
            onEdit={teamActions.openEditDialog}
            onImport={() => teamImportInputRef.current?.click()}
            onShare={teamActions.openShare}
            personas={personas.libraryPersonas}
            teams={teamActions.teams}
          />
        </DialogContent>
      </Dialog>

      {instanceToEdit ? (
        <AgentDialog
          agent={instanceToEdit}
          mode="instance-edit"
          onOpenChange={(open) => {
            if (!open) setInstanceToEdit(null);
          }}
          onUpdated={() => agents.refetchManagedAgents()}
          open={instanceToEdit !== null}
        />
      ) : null}

      <AgentDefaultsDialog
        onOpenChange={setIsAiDefaultsOpen}
        open={isAiDefaultsOpen}
        returnFocusRef={aiDefaultsTriggerRef}
      />

      {isCreateDialogOpen && !operatorSettings.data ? (
        <Dialog onOpenChange={setIsCreateDialogOpen} open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create agent</DialogTitle>
            </DialogHeader>
            <p
              className="text-sm text-muted-foreground"
              role={operatorSettings.isError ? "alert" : "status"}
            >
              {operatorSettings.isError
                ? "Your runtime default could not be loaded. Try again, or choose a native agent from Add agent."
                : "Loading your runtime default…"}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setIsCreateDialogOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              {operatorSettings.isError ? (
                <Button
                  disabled={operatorSettings.isFetching}
                  onClick={() => void operatorSettings.refetch()}
                >
                  {operatorSettings.isFetching ? "Retrying…" : "Try again"}
                </Button>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : isCreateDialogOpen && effectiveTarget?.kind === "native" ? (
        <NativeAgentProvisioningDialog
          initialRuntime={effectiveTarget.runtime}
          onComplete={() => {
            void agents.refetchManagedAgents();
          }}
          onOpenChange={(open) => {
            if (!open) setIsCreateDialogOpen(false);
          }}
          open
        />
      ) : isCreateDialogOpen ? (
        <AgentDialog
          definitionError={
            personas.createPersonaMutation.error instanceof Error
              ? personas.createPersonaMutation.error
              : null
          }
          initialValues={createInitialValues}
          isDefinitionPending={personas.isPending}
          mode="definition"
          onOpenChange={(open) => {
            if (!open) setIsCreateDialogOpen(false);
          }}
          onSubmitDefinition={personas.handleSubmitResident}
          runtimes={personas.acpRuntimesQuery.data ?? []}
          runtimesLoading={personas.acpRuntimesQuery.isLoading}
        />
      ) : null}
      {agents.agentToAddToChannel ? (
        <AddAgentToChannelDialog
          agent={agents.agentToAddToChannel}
          onAdded={agents.handleAddedToChannel}
          onOpenChange={(open) => {
            if (!open) {
              agents.setAgentToAddToChannel(null);
            }
          }}
          open={agents.agentToAddToChannel !== null}
        />
      ) : null}
      {personas.personaDialogState ? (
        <AgentDialog
          description={personas.personaDialogState.description}
          error={
            personas.updatePersonaMutation.error instanceof Error
              ? personas.updatePersonaMutation.error
              : personas.createPersonaMutation.error instanceof Error
                ? personas.createPersonaMutation.error
                : null
          }
          initialValues={personas.personaDialogState.initialValues}
          isPending={personas.isPending}
          mode="definition-edit"
          runtimes={personas.acpRuntimesQuery.data ?? []}
          runtimesLoading={personas.acpRuntimesQuery.isLoading}
          onOpenChange={(open) => {
            if (!open) {
              personas.setPersonaDialogState(null);
            }
          }}
          onSubmit={(input) =>
            "id" in input
              ? personas.handleUpdatePersona(input)
              : personas.handleSubmitResident(input)
          }
          open={personas.personaDialogState !== null}
          submitLabel={personas.personaDialogState.submitLabel}
          title={personas.personaDialogState.title}
        />
      ) : null}
      {personas.personaToDelete ? (
        <PersonaDeleteDialog
          instanceCount={
            (agents.managedAgents ?? []).filter(
              (a) => a.personaId === personas.personaToDelete?.id,
            ).length
          }
          onConfirm={(persona) => {
            void personas.handleDelete(persona);
          }}
          onOpenChange={(open) => {
            if (!open) {
              personas.setPersonaToDelete(null);
            }
          }}
          open={personas.personaToDelete !== null}
          persona={personas.personaToDelete}
        />
      ) : null}
      {personas.personaToShare ? (
        <PersonaShareDialog
          isPending={personas.isPending}
          linkedAgentPubkey={personas.personaToShare.linkedAgentPubkey}
          onExport={() => {
            const shareTarget = personas.personaToShare;
            if (!shareTarget) return;
            personas.setPersonaToShare(null);
            personas.setPersonaToExportSnapshot(shareTarget);
          }}
          onOpenChange={(open) => {
            if (!open) {
              personas.setPersonaToShare(null);
            }
          }}
          open={personas.personaToShare !== null}
          persona={personas.personaToShare.persona}
        />
      ) : null}
      {personas.personaToExportSnapshot ? (
        <AgentSnapshotExportDialog
          agentName={personas.personaToExportSnapshot.persona.displayName}
          isSavePending={personas.isPending}
          open={personas.personaToExportSnapshot !== null}
          linkedAgentPubkey={personas.personaToExportSnapshot.linkedAgentPubkey}
          onSaveFile={(memoryLevel, format) => {
            if (personas.personaToExportSnapshot) {
              personas.handleExportSnapshot(
                personas.personaToExportSnapshot.persona,
                personas.personaToExportSnapshot.linkedAgentPubkey,
                memoryLevel,
                format,
              );
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              personas.setPersonaToExportSnapshot(null);
            }
          }}
        />
      ) : null}
      {personas.snapshotImportState ? (
        <AgentSnapshotImportDialog
          open={personas.snapshotImportState !== null}
          preview={personas.snapshotImportState.preview}
          isConfirming={personas.isSnapshotImportConfirming}
          result={personas.snapshotImportResult}
          confirmError={personas.snapshotImportConfirmError}
          onConfirm={(keepAllowlist) => {
            void personas.handleConfirmSnapshotImport(keepAllowlist);
          }}
          onOpenChange={(open) => {
            if (!open) {
              personas.closeSnapshotImportDialog();
            }
          }}
        />
      ) : null}
      {personas.isCatalogDialogOpen ? (
        <PersonaCatalogDialog
          error={
            personas.personasQuery.error instanceof Error
              ? personas.personasQuery.error
              : null
          }
          feedbackErrorMessage={
            personas.personaFeedbackSurface === "catalog"
              ? personas.personaErrorMessage
              : null
          }
          feedbackNoticeMessage={
            personas.personaFeedbackSurface === "catalog"
              ? personas.personaNoticeMessage
              : null
          }
          isLoading={personas.personasQuery.isLoading}
          isPending={personas.setPersonaActiveMutation.isPending}
          onClearFeedback={() => {
            personas.clearFeedback("catalog");
          }}
          onOpenChange={personas.setIsCatalogDialogOpen}
          onSelectPersona={(persona, active) => {
            void personas.handleSetActive(persona, active, "catalog");
          }}
          open={personas.isCatalogDialogOpen}
          personas={personas.catalogPersonas}
        />
      ) : null}
      {teamActions.teamDialogState ? (
        <TeamDialog
          description={teamActions.teamDialogState.description}
          error={
            teamActions.updateTeamMutation.error instanceof Error
              ? teamActions.updateTeamMutation.error
              : teamActions.createTeamMutation.error instanceof Error
                ? teamActions.createTeamMutation.error
                : null
          }
          initialValues={teamActions.teamDialogState.initialValues}
          isPending={
            teamActions.createTeamMutation.isPending ||
            teamActions.updateTeamMutation.isPending
          }
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamDialogState(null);
            }
          }}
          onDeleteRemovedPersonas={teamActions.handleDeleteRemovedPersonas}
          onSubmit={teamActions.handleTeamSubmit}
          open={teamActions.teamDialogState !== null}
          personas={personas.libraryPersonas}
          submitLabel={teamActions.teamDialogState.submitLabel}
          title={teamActions.teamDialogState.title}
        />
      ) : null}
      {teamActions.teamToDelete ? (
        <TeamDeleteDialog
          onConfirm={(team) => {
            void teamActions.handleDeleteTeam(team);
          }}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamToDelete(null);
            }
          }}
          open={teamActions.teamToDelete !== null}
          team={teamActions.teamToDelete}
        />
      ) : null}
      {teamActions.teamToAddToChannel ? (
        <AddTeamToChannelDialog
          onDeployed={teamActions.handleTeamDeployed}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamToAddToChannel(null);
            }
          }}
          open={teamActions.teamToAddToChannel !== null}
          personas={personas.libraryPersonas}
          team={teamActions.teamToAddToChannel}
        />
      ) : null}
      {teamActions.teamToShare ? (
        <TeamShareDialog
          isPending={
            teamActions.createTeamMutation.isPending ||
            teamActions.updateTeamMutation.isPending ||
            teamActions.deleteTeamMutation.isPending
          }
          onExport={() => {
            if (teamActions.teamToShare) {
              const team = teamActions.teamToShare;
              teamActions.setTeamToShare(null);
              teamActions.openExportSnapshot(team);
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamToShare(null);
            }
          }}
          open={teamActions.teamToShare !== null}
          team={teamActions.teamToShare}
        />
      ) : null}
      {teamActions.teamToExport ? (
        <TeamSnapshotExportDialog
          isSavePending={teamActions.exportTeamSnapshotMutation.isPending}
          open={teamActions.teamToExport !== null}
          team={teamActions.teamToExport}
          onSaveFile={(memoryLevel, format) => {
            if (teamActions.teamToExport) {
              teamActions.handleExportTeamSnapshot(
                teamActions.teamToExport,
                memoryLevel,
                format,
              );
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamToExport(null);
            }
          }}
        />
      ) : null}
      {teamActions.teamSnapshotImportState ? (
        <TeamSnapshotImportDialog
          open={teamActions.teamSnapshotImportState !== null}
          preview={teamActions.teamSnapshotImportState.preview}
          isConfirming={teamActions.isTeamSnapshotImportConfirming}
          result={teamActions.teamSnapshotImportResult}
          confirmError={teamActions.teamSnapshotImportConfirmError}
          onConfirm={(keepAllowlist) => {
            void teamActions.handleConfirmTeamSnapshotImport(keepAllowlist);
          }}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.closeTeamSnapshotImportDialog();
            }
          }}
        />
      ) : null}
      {/* Hidden file input for team snapshot import via file picker */}
      <input
        accept=".team.json,.team.png"
        className="hidden"
        data-testid="team-snapshot-import-input"
        ref={teamImportInputRef}
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const buffer = reader.result as ArrayBuffer;
            const fileBytes = Array.from(new Uint8Array(buffer));
            void teamActions.handleImportTeamSnapshotFile(fileBytes, file.name);
          };
          reader.readAsArrayBuffer(file);
          // Reset so the same file can be picked again.
          e.target.value = "";
        }}
      />
    </>
  );
}

function AgentLibraryUnavailable({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[inherit] bg-card/40"
      data-luca-floor-host
      data-testid="agents-library-unavailable"
    >
      <div
        className="relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
        data-luca-conversation-surface
      >
        <aside className="flex min-h-0 w-full shrink-0 flex-col border-border/60 bg-card/45 md:w-[292px] md:border-r">
          <header className="border-b border-border/55 px-4 pb-4 pt-11 md:pt-5">
            <h1 className="text-lg font-medium tracking-tight">Agents</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Library unavailable
            </p>
          </header>
        </aside>
        <main className="hidden min-h-0 min-w-0 flex-1 items-center justify-center bg-card/60 px-8 text-center md:flex">
          <div className="max-w-md" role="alert">
            <span className="mx-auto flex size-10 items-center justify-center rounded-full border border-destructive/30 bg-destructive/8 text-destructive">
              <CircleAlert aria-hidden="true" className="size-5" />
            </span>
            <h2 className="mt-4 text-lg font-medium">
              Couldn’t load your agents
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Luca couldn’t read the local agent library. Your residents have
              not been changed.
            </p>
            <Button
              aria-busy={isRetrying || undefined}
              className="mt-5"
              disabled={isRetrying}
              onClick={onRetry}
              size="sm"
              variant="outline"
            >
              <RefreshCw
                aria-hidden="true"
                className={
                  isRetrying ? "animate-spin motion-reduce:animate-none" : ""
                }
              />
              {isRetrying ? "Trying again…" : "Try again"}
            </Button>
          </div>
        </main>
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-6 text-center md:hidden">
          <div className="max-w-sm" role="alert">
            <CircleAlert
              aria-hidden="true"
              className="mx-auto size-5 text-destructive"
            />
            <h2 className="mt-3 text-base font-medium">
              Couldn’t load your agents
            </h2>
            <Button
              aria-busy={isRetrying || undefined}
              className="mt-4"
              disabled={isRetrying}
              onClick={onRetry}
              size="sm"
              variant="outline"
            >
              <RefreshCw
                aria-hidden="true"
                className={
                  isRetrying ? "animate-spin motion-reduce:animate-none" : ""
                }
              />
              {isRetrying ? "Trying again…" : "Try again"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
