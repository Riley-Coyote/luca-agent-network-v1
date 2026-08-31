import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  createInputFromRequest,
  requestTargetsEditablePersona,
  type AgentManagementRequest,
} from "./agentManagement";
import { subscribeAgentManagementRequests } from "./observerRelayStore";
import {
  managedAgentsQueryKey,
  personasQueryKey,
  useAcpRuntimesQuery,
  useCreateManagedAgentMutation,
  useCreatePersonaMutation,
  useManagedAgentsQuery,
  usePersonasQuery,
  useUpdatePersonaMutation,
} from "./hooks";
import {
  availableRuntimesForStart,
  buildInstanceInputForDefinition,
  type BackendIntent,
} from "./lib/instanceInputForDefinition";
import { useCreatedAgentChannelAttachment } from "./useCreatedAgentChannelAttachment";
import { classifyAgentManagementOrigin } from "./agentManagementBuffer";
import { subscribeConversationalActions } from "./conversationalActionStore";
import { useChannelsQuery } from "@/features/channels/hooks";
import { resolveManagedAgentAvatarUrl } from "./ui/managedAgentAvatar";
import type { AgentCreateIntent } from "./ui/agentCreateIntent";
import { editPersonaDialogState } from "./ui/personaDialogState";
import type {
  CreatePersonaInput,
  UpdatePersonaInput,
} from "@/shared/api/types";
import { createChat } from "@/shared/api/tauriChannels";
import { listTeams, updateTeam } from "@/shared/api/tauriTeams";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";

function updateInputFromRequest(
  request: Extract<AgentManagementRequest, { action: "update" }>,
  current: UpdatePersonaInput,
): UpdatePersonaInput {
  const changes = request.request;
  return {
    ...current,
    displayName: changes.displayName ?? current.displayName,
    systemPrompt: changes.systemPrompt ?? current.systemPrompt,
    runtime: changes.runtime ?? current.runtime,
    provider: changes.provider ?? current.provider,
    model: changes.model ?? current.model,
    ...(changes.respondTo
      ? {
          behavior: {
            respondTo: changes.respondTo,
            respondToAllowlist: [],
            parallelism: current.behavior?.parallelism,
          },
        }
      : {}),
  };
}

export function useAgentManagement() {
  const queryClient = useQueryClient();
  const personasQuery = usePersonasQuery();
  const managedAgentsQuery = useManagedAgentsQuery();
  const channelsQuery = useChannelsQuery();
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const createPersonaMutation = useCreatePersonaMutation();
  const updatePersonaMutation = useUpdatePersonaMutation();
  const createAgentMutation = useCreateManagedAgentMutation();
  const [request, setRequest] = React.useState<AgentManagementRequest | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const createdAgentAttachment = useCreatedAgentChannelAttachment();
  const seenRequestIds = React.useRef(new Set<string>());
  const pendingRequestId = React.useRef<string | null>(null);
  const sourceAgentPubkey = React.useRef<string | null>(null);
  const managedAgentsRef = React.useRef(managedAgentsQuery.data);
  const channelsRef = React.useRef(channelsQuery.data);
  const bufferedRequestsRef = React.useRef<
    Array<{ agentPubkey: string; request: AgentManagementRequest }>
  >([]);

  const acceptOwnedRequest = React.useEffectEvent(
    (agentPubkey: string, next: AgentManagementRequest) => {
      if (
        classifyAgentManagementOrigin(
          managedAgentsRef.current,
          channelsRef.current,
          agentPubkey,
          next.request.channelId,
        ) !== "accept" ||
        seenRequestIds.current.has(next.requestId)
      ) {
        return;
      }
      seenRequestIds.current.add(next.requestId);
      setError(null);
      if (pendingRequestId.current === null) {
        pendingRequestId.current = next.requestId;
        sourceAgentPubkey.current = agentPubkey;
        setRequest(next);
      }
    },
  );

  React.useEffect(() => {
    managedAgentsRef.current = managedAgentsQuery.data;
    channelsRef.current = channelsQuery.data;
    if (managedAgentsQuery.data && channelsQuery.data) {
      const buffered = bufferedRequestsRef.current.splice(0);
      for (const candidate of buffered) {
        acceptOwnedRequest(candidate.agentPubkey, candidate.request);
      }
    }
  }, [channelsQuery.data, managedAgentsQuery.data]);

  React.useEffect(
    () =>
      subscribeAgentManagementRequests((agentPubkey, next) => {
        // Observer frames are owner-scoped and authenticated. Any managed agent
        // this Desktop owns may draft a change; defer the ownership decision
        // until the managed-agent query has initialized so ephemeral requests
        // cannot disappear during startup.
        if (
          classifyAgentManagementOrigin(
            managedAgentsRef.current,
            channelsRef.current,
            agentPubkey,
            next.request.channelId,
          ) === "buffer"
        ) {
          bufferedRequestsRef.current.push({ agentPubkey, request: next });
          if (bufferedRequestsRef.current.length > 100) {
            bufferedRequestsRef.current.shift();
          }
          return;
        }
        acceptOwnedRequest(agentPubkey, next);
      }),
    [],
  );

  React.useEffect(
    () =>
      subscribeConversationalActions((action) => {
        if (action.action !== "propose_agent") return;
        const name = action.payload.name;
        const instructions = action.payload.instructions;
        if (typeof name !== "string" || typeof instructions !== "string") {
          return;
        }
        acceptOwnedRequest(action.residentPubkey, {
          type: "agent_management_request",
          action: "create",
          requestId: action.requestId,
          request: {
            channelId: action.sourceChatId,
            displayName: name,
            systemPrompt: instructions,
            provisioningIntent: "fresh",
            runtime:
              typeof action.payload.runtime === "string"
                ? action.payload.runtime
                : undefined,
            provider:
              typeof action.payload.provider === "string"
                ? action.payload.provider
                : undefined,
            model:
              typeof action.payload.model === "string"
                ? action.payload.model
                : undefined,
            respondTo: "owner-only",
            projectId:
              typeof action.payload.projectId === "string"
                ? action.payload.projectId
                : undefined,
            teamId:
              typeof action.payload.teamId === "string"
                ? action.payload.teamId
                : undefined,
            createFirstChat: action.payload.createFirstChat === true,
          },
        });
      }),
    [],
  );

  const matchingPersonas = React.useMemo(() => {
    if (request?.action !== "update") return [];
    const target = request.request.agentName.trim().toLocaleLowerCase();
    return (personasQuery.data ?? []).filter(
      (persona) =>
        persona.displayName.trim().toLocaleLowerCase() === target &&
        requestTargetsEditablePersona(persona),
    );
  }, [personasQuery.data, request]);
  const currentPersona =
    matchingPersonas.length === 1 ? matchingPersonas[0] : undefined;
  const createTargetChannel = React.useMemo(() => {
    if (request?.action !== "create") return null;
    const channel = (channelsQuery.data ?? []).find(
      (candidate) => candidate.id === request.request.channelId,
    );
    return channel ? { id: channel.id, name: channel.name } : null;
  }, [channelsQuery.data, request]);

  const isPending =
    createPersonaMutation.isPending ||
    updatePersonaMutation.isPending ||
    createAgentMutation.isPending;

  function assertAgentCanActFromOrigin(channelId: string) {
    const targetChannel = (channelsQuery.data ?? []).find(
      (channel) => channel.id === channelId,
    );
    const requestingPubkey = sourceAgentPubkey.current?.toLowerCase();
    if (
      !targetChannel?.isMember ||
      !requestingPubkey ||
      !targetChannel.memberPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === requestingPubkey,
      )
    ) {
      throw new Error(
        "An agent can only manage agents from a channel you both belong to.",
      );
    }
  }

  function authorizePendingCreate() {
    if (request?.action !== "create") {
      throw new Error("This agent creation request is no longer available.");
    }
    assertAgentCanActFromOrigin(request.request.channelId);
  }

  async function submitCreate(
    input: CreatePersonaInput | UpdatePersonaInput,
    intent: AgentCreateIntent,
    backendIntent: BackendIntent | null,
  ): Promise<boolean> {
    if (request?.action !== "create" || "id" in input) {
      return false;
    }
    setError(null);
    let createdPersonaName: string | null = null;
    try {
      assertAgentCanActFromOrigin(request.request.channelId);
      const runtimes = await availableRuntimesForStart(runtimesQuery);
      const runtime = runtimes.find(
        (candidate) => candidate.id === input.runtime,
      );
      if (!runtime) {
        throw new Error("Choose an available runtime for this agent.");
      }

      const avatarUrl = await resolveManagedAgentAvatarUrl(
        input.avatarUrl,
        undefined,
        runtime.avatarUrl,
      );
      const persona = await createPersonaMutation.mutateAsync({
        ...input,
        avatarUrl,
      });
      createdPersonaName = persona.displayName;

      if (intent === "definition_start") {
        const created = await createAgentMutation.mutateAsync(
          await buildInstanceInputForDefinition(
            persona,
            runtime,
            undefined,
            backendIntent ?? undefined,
          ),
        );
        if (created.spawnError) throw new Error(created.spawnError);
        await createdAgentAttachment.presentCreatedAgent(created, null);
        if (request.request.teamId) {
          const team = (await listTeams()).find(
            (candidate) => candidate.id === request.request.teamId,
          );
          if (team) {
            await updateTeam({
              id: team.id,
              name: team.name,
              description: team.description ?? "",
              instructions: team.instructions ?? undefined,
              memberPubkeys: Array.from(
                new Set([...team.memberPubkeys, created.agent.pubkey]),
              ),
              personaIds: team.personaIds,
            });
          }
        }
        let firstChatId: string | null = null;
        if (request.request.createFirstChat) {
          const firstChat = await createChat({
            participantPubkeys: [created.agent.pubkey],
            projectId: request.request.projectId,
          });
          firstChatId = firstChat.chat.id;
        }
        const requestingAgent = sourceAgentPubkey.current;
        if (!requestingAgent) {
          throw new Error("The requesting Agent is no longer available.");
        }
        await sendManagedAgentChannelMessage({
          agentPubkey: requestingAgent,
          channelId: request.request.channelId,
          content: firstChatId
            ? `Created Agent “${created.agent.name}”. Open the first Chat: buzz://message?channel=${firstChatId}`
            : `Created Agent “${created.agent.name}”. It is now available in Agents.`,
          marker: `luca-action:${request.requestId}:confirmed`,
          markerScope: "agent",
        });
        createdAgentAttachment.dismissCreatedAgent();
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: personasQueryKey }),
        queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey }),
      ]);
      dismiss();
      return true;
    } catch (cause) {
      setError(
        createdPersonaName
          ? `${createdPersonaName} was saved. Retry agent setup from its Add agent action.`
          : cause instanceof Error
            ? cause.message
            : "Could not save this agent.",
      );
      if (createdPersonaName) {
        dismiss();
        return true;
      }
      return false;
    }
  }

  async function submitUpdate(input: CreatePersonaInput | UpdatePersonaInput) {
    if (request?.action !== "update" || !("id" in input)) {
      return false;
    }
    setError(null);
    try {
      assertAgentCanActFromOrigin(request.request.channelId);
      await updatePersonaMutation.mutateAsync(input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: personasQueryKey }),
        queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey }),
      ]);
      dismiss();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this agent.",
      );
      return false;
    }
  }

  function dismiss() {
    pendingRequestId.current = null;
    sourceAgentPubkey.current = null;
    setRequest(null);
  }

  const createInitialValues = React.useMemo(
    () =>
      request?.action === "create" ? createInputFromRequest(request) : null,
    [request],
  );

  const editInitialValues = React.useMemo(() => {
    if (request?.action !== "update" || !currentPersona) return null;
    return updateInputFromRequest(
      request,
      editPersonaDialogState(currentPersona)
        .initialValues as UpdatePersonaInput,
    );
  }, [currentPersona, request]);

  const editError = React.useMemo(() => {
    if (request?.action !== "update") return error;
    if (error) return error;
    if (matchingPersonas.length > 1) {
      return "More than one personal agent has that name. Rename it in Agents, then ask the agent again.";
    }
    if (!currentPersona) {
      return "Agents can only update a personal agent profile by its current name.";
    }
    return null;
  }, [currentPersona, error, matchingPersonas.length, request]);

  return {
    authorizePendingCreate,
    request,
    createTargetChannel,
    createInitialValues,
    editInitialValues,
    editError,
    error,
    ...createdAgentAttachment,
    isPending,
    runtimes: runtimesQuery.data ?? [],
    runtimesLoading: runtimesQuery.isLoading,
    submitCreate,
    submitUpdate,
    dismiss,
  };
}
