import { AlertTriangle } from "lucide-react";
import * as React from "react";

import {
  useAvailableAcpRuntimes,
  useCreateChannelManagedAgentMutation,
  usePersonasQuery,
  useTeamsQuery,
} from "@/features/agents/hooks";
import { getActivePersonas } from "@/features/agents/lib/catalog";
import { resolvePersonaRuntime } from "@/features/agents/lib/resolvePersonaRuntime";
import { getUsableTeams } from "@/features/agents/lib/teamPersonas";
import { AddChannelBotPersonasSection } from "@/features/channels/ui/AddChannelBotPersonasSection";
import { AddChannelBotTeamsSection } from "@/features/channels/ui/AddChannelBotTeamsSection";
import type { ChannelVisibility } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { ChooserDialogContent } from "@/shared/ui/chooser-dialog-content";
import { Dialog } from "@/shared/ui/dialog";

import {
  type CreateChannelInput,
  useCreateChannelForm,
} from "@/features/sidebar/lib/useCreateChannelForm";
import { runRoomParticipantSetup } from "@/features/sidebar/lib/roomParticipantSetup";
import {
  CREATE_CHANNEL_FORM_ID,
  CreateChannelFormFields,
  CreateChannelFormFooter,
} from "@/features/sidebar/ui/CreateChannelFormFields";

type ChannelKind = "stream" | "forum";

type CreateChannelDialogProps = {
  /** Which kind of channel to create, or null when closed. */
  channelKind: ChannelKind | null;
  isCreating: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (
    input: {
      name: string;
      description?: string;
      visibility: ChannelVisibility;
      ttlSeconds?: number;
      templateId?: string;
    },
    onCreated?: (channelId: string) => void | Promise<void>,
  ) => Promise<void>;
};

function toggleValue(values: readonly string[], value: string) {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function failureSummary(
  failures: ReadonlyArray<{ name: string; error: string }>,
) {
  return failures.length === 1
    ? `Couldn’t add ${failures[0]?.name}: ${failures[0]?.error}`
    : failures.map(({ name, error }) => `${name}: ${error}`).join("; ");
}

export function CreateChannelDialog({
  channelKind,
  isCreating,
  onOpenChange,
  onCreate,
}: CreateChannelDialogProps) {
  const open = channelKind !== null;
  const personasQuery = usePersonasQuery();
  const teamsQuery = useTeamsQuery();
  const runtimesQuery = useAvailableAcpRuntimes({
    enabled: open && channelKind === "stream",
  });
  const addAgentMutation = useCreateChannelManagedAgentMutation(null);
  const resetAddAgentMutationRef = React.useRef(addAgentMutation.reset);
  resetAddAgentMutationRef.current = addAgentMutation.reset;
  const personas = React.useMemo(
    () => getActivePersonas(personasQuery.data ?? []),
    [personasQuery.data],
  );
  const teams = React.useMemo(
    () => getUsableTeams(teamsQuery.data ?? [], personas),
    [personas, teamsQuery.data],
  );
  const [selectedPersonaIds, setSelectedPersonaIds] = React.useState<string[]>(
    [],
  );
  const [createdChannelId, setCreatedChannelId] = React.useState<string | null>(
    null,
  );
  const [participantNotice, setParticipantNotice] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    if (!open) return;
    setSelectedPersonaIds([]);
    setCreatedChannelId(null);
    setParticipantNotice(null);
    resetAddAgentMutationRef.current();
  }, [open]);

  React.useEffect(() => {
    setSelectedPersonaIds((current) =>
      current.filter((id) => personas.some((persona) => persona.id === id)),
    );
  }, [personas]);

  const selectedPersonas = React.useMemo(
    () => personas.filter((persona) => selectedPersonaIds.includes(persona.id)),
    [personas, selectedPersonaIds],
  );

  function handleToggleTeam(personaIds: string[]) {
    setSelectedPersonaIds((current) => {
      const allSelected = personaIds.every((id) => current.includes(id));
      return allSelected
        ? current.filter((id) => !personaIds.includes(id))
        : [...new Set([...current, ...personaIds])];
    });
    setParticipantNotice(null);
  }

  async function addSelectedAgents(channelId: string) {
    const result = await runRoomParticipantSetup(
      selectedPersonas.map((persona) => ({
        id: persona.id,
        name: persona.displayName,
        persona,
      })),
      async ({ persona }) => {
        const runtime = resolvePersonaRuntime(
          persona.runtime,
          runtimesQuery.data,
          runtimesQuery.data[0] ?? null,
          false,
        ).runtime;
        if (!runtime) {
          throw new Error("No supported runtime is ready.");
        }

        await addAgentMutation.mutateAsync({
          avatarUrl: persona.avatarUrl ?? undefined,
          backend: { type: "local" },
          channelId,
          ensureRunning: true,
          harnessOverride: false,
          model: persona.model ?? undefined,
          name: persona.displayName,
          personaId: persona.id,
          role: "bot",
          runtime,
          systemPrompt: persona.systemPrompt,
        });
      },
    );

    setSelectedPersonaIds(result.failures.map((failure) => failure.id));
    if (result.failures.length > 0) {
      setParticipantNotice(
        result.addedIds.length > 0
          ? `Room created. Added ${result.addedIds.length}; retry the remaining ${result.failures.length}.`
          : "Room created. Retry the selected agents.",
      );
      throw new Error(failureSummary(result.failures));
    }
  }

  async function createWithParticipants(input: CreateChannelInput) {
    if (channelKind !== "stream" || selectedPersonas.length === 0) {
      await onCreate(input);
      return;
    }

    if (createdChannelId) {
      await addSelectedAgents(createdChannelId);
      return;
    }

    await onCreate(input, async (channelId) => {
      setCreatedChannelId(channelId);
      await addSelectedAgents(channelId);
    });
  }

  const isBusy = isCreating || addAgentMutation.isPending;

  const form = useCreateChannelForm({
    channelKind: channelKind ?? "stream",
    active: open,
    isCreating: isBusy,
    onCreate: createWithParticipants,
    onCreated: () => onOpenChange(false),
  });

  const kindLabel = channelKind === "forum" ? "forum" : "room";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isBusy) return;
        onOpenChange(nextOpen);
      }}
    >
      <ChooserDialogContent
        className="max-w-lg"
        contentClassName="pt-3"
        data-testid="create-channel-dialog"
        footerClassName="border-t-0 pt-0"
        headerClassName="pb-2"
        title={`Create a new ${kindLabel}`}
        description={
          channelKind === "forum"
            ? "Forums organize threaded discussions around a topic."
            : "Rooms are durable conversations for people, agents, and shared work."
        }
        footer={
          createdChannelId ? (
            <div className="flex w-full justify-end">
              <Button
                disabled={isBusy || selectedPersonas.length === 0}
                form={CREATE_CHANNEL_FORM_ID}
                type="submit"
              >
                {isBusy ? "Retrying…" : "Retry remaining agents"}
              </Button>
            </div>
          ) : (
            <CreateChannelFormFooter form={form} />
          )
        }
      >
        <form
          className="space-y-5"
          id={CREATE_CHANNEL_FORM_ID}
          onSubmit={form.handleSubmit}
        >
          {createdChannelId ? (
            <div className="space-y-2" aria-live="polite">
              <p className="rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
                {participantNotice ??
                  "The room is ready. Finish adding the remaining agents."}
              </p>
              {form.errorMessage ? (
                <p className="text-sm text-destructive" role="alert">
                  {form.errorMessage}
                </p>
              ) : null}
            </div>
          ) : (
            <CreateChannelFormFields form={form} />
          )}

          {channelKind === "stream" &&
          (personasQuery.isLoading || personas.length > 0) ? (
            <section
              aria-labelledby="create-room-participants-label"
              className="space-y-4 border-t border-border/55 pt-5"
              data-testid="create-room-participants"
            >
              <div>
                <h3
                  className="text-sm font-medium text-foreground"
                  id="create-room-participants-label"
                >
                  Agents
                  <span className="ml-1 text-xs font-normal text-ink-faint">
                    Optional
                  </span>
                </h3>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Add permanent room members now, or invite temporary visitors
                  later with @.
                </p>
              </div>
              <AddChannelBotPersonasSection
                canToggleSelections={!isBusy && !createdChannelId}
                isLoading={personasQuery.isLoading}
                onTogglePersona={(personaId) => {
                  setSelectedPersonaIds((current) =>
                    toggleValue(current, personaId),
                  );
                  setParticipantNotice(null);
                }}
                personas={personas}
                selectedPersonaIds={selectedPersonaIds}
              />
              {teams.length > 0 ? (
                <AddChannelBotTeamsSection
                  canToggleSelections={!isBusy && !createdChannelId}
                  isLoading={teamsQuery.isLoading}
                  onToggleTeam={handleToggleTeam}
                  personas={personas}
                  selectedPersonaIds={selectedPersonaIds}
                  teams={teams}
                />
              ) : null}
              {selectedPersonas.length > 0 &&
              runtimesQuery.data.length === 0 &&
              !runtimesQuery.isLoading ? (
                <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p className="text-sm text-warning">
                    Connect an agent runtime before adding these agents.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
        </form>
      </ChooserDialogContent>
    </Dialog>
  );
}
