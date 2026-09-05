import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  createInputFromRequest,
  parseAgentManagementRequest,
  requestTargetsEditablePersona,
  type AgentManagementRequest,
} from "./agentManagement";
import { subscribeAgentManagementRequests } from "./observerRelayStore";
import {
  authorizeResidentProposal,
  finishResidentProposal,
  listResidentProposals,
  listenResidentProposals,
  type ResidentProposal,
  type ResidentProposalCompletion,
} from "@/shared/api/tauriResidentProposals";
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
import { attachManagedAgentToChannel } from "./channelAgents";
import { classifyAgentManagementOrigin } from "./agentManagementBuffer";
import { useChannelsQuery } from "@/features/channels/hooks";
import { resolveManagedAgentAvatarUrl } from "./ui/managedAgentAvatar";
import type { AgentCreateIntent } from "./ui/agentCreateIntent";
import { editPersonaDialogState } from "./ui/personaDialogState";
import {
  agentManagementCompletionMessage,
  type NativeAgentCompletion,
} from "./lib/agentManagementCompletion";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import type {
  CreatePersonaInput,
  UpdatePersonaInput,
} from "@/shared/api/types";

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
  const closingImportId = React.useRef<string | null>(null);
  const closingImportBusy = React.useRef(false);
  const [importCloseState, setImportCloseState] = React.useState({
    closing: false,
    pending: false,
    error: null as string | null,
  });
  const hostRequestIds = React.useRef(new Set<string>());
  const completedHostRequestIds = React.useRef(new Set<string>());
  const managedCreateOutcome = React.useRef<{
    requestId: string;
    name: string;
    completion: ResidentProposalCompletion;
  } | null>(null);
  const managedAgentsRef = React.useRef(managedAgentsQuery.data);
  const channelsRef = React.useRef(channelsQuery.data);
  const bufferedRequestsRef = React.useRef<
    Array<{ agentPubkey: string; request: AgentManagementRequest }>
  >([]);

  const acceptOwnedRequest = React.useEffectEvent(
    (agentPubkey: string, next: AgentManagementRequest) => {
      if (
        next.action === "import" &&
        !hostRequestIds.current.has(next.requestId)
      )
        return;
      if (seenRequestIds.current.has(next.requestId)) return;
      if (
        classifyAgentManagementOrigin(
          managedAgentsRef.current,
          channelsRef.current,
          agentPubkey,
          next.request.channelId,
        ) !== "accept"
      ) {
        if (hostRequestIds.current.delete(next.requestId)) {
          void finishResidentProposal(next.requestId, {
            status: "closed",
            busy: false,
          }).catch(() => {});
        }
        return;
      }
      if (pendingRequestId.current !== null) {
        if (hostRequestIds.current.has(next.requestId)) {
          void finishResidentProposal(next.requestId, {
            status: "closed",
            busy: true,
          }).catch(() => {});
          hostRequestIds.current.delete(next.requestId);
        }
        return;
      }
      if (pendingRequestId.current === null) {
        seenRequestIds.current.add(next.requestId);
        setError(null);
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

  React.useEffect(() => {
    const unsubscribe = subscribeAgentManagementRequests(
      (agentPubkey, next) => {
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
      },
    );
    return () => {
      unsubscribe();
      pendingRequestId.current = null;
      sourceAgentPubkey.current = null;
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const receive = (proposal: ResidentProposal) => {
      if (disposed) return;
      const next = parseAgentManagementRequest(
        proposal.provisioningIntent === "import"
          ? {
              type: "agent_management_request",
              action: "import",
              requestId: proposal.requestId,
              request: {
                channelId: proposal.conversationId,
                nativeProfileName: proposal.nativeProfileName,
              },
            }
          : {
              type: "agent_management_request",
              action: "create",
              requestId: proposal.requestId,
              request: {
                channelId: proposal.conversationId,
                displayName: proposal.displayName,
                systemPrompt: proposal.systemPrompt,
                ...(proposal.runtimeFamily
                  ? { requestedRuntimeFamily: proposal.runtimeFamily }
                  : {}),
                ...(proposal.provisioningIntent
                  ? { provisioningIntent: proposal.provisioningIntent }
                  : {}),
              },
            },
      );
      if (
        !next ||
        !/^[0-9a-f]{64}$/i.test(proposal.residentPubkey) ||
        seenRequestIds.current.has(next.requestId)
      )
        return;
      hostRequestIds.current.add(next.requestId);
      const classification = classifyAgentManagementOrigin(
        managedAgentsRef.current,
        channelsRef.current,
        proposal.residentPubkey,
        proposal.conversationId,
      );
      if (classification === "buffer") {
        if (
          !bufferedRequestsRef.current.some(
            (item) => item.request.requestId === next.requestId,
          )
        ) {
          bufferedRequestsRef.current.push({
            agentPubkey: proposal.residentPubkey,
            request: next,
          });
        }
      } else if (classification === "accept") {
        acceptOwnedRequest(proposal.residentPubkey, next);
      } else {
        void finishResidentProposal(next.requestId, {
          status: "closed",
          busy: false,
        }).catch(() => {});
        hostRequestIds.current.delete(next.requestId);
      }
    };
    // Listen before replay so a request cannot disappear during renderer startup.
    void listenResidentProposals(receive)
      .then(async (stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        for (const proposal of await listResidentProposals()) receive(proposal);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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

  async function authorizePendingCreate(checkHost = true) {
    const requestingPubkey = sourceAgentPubkey.current;
    if (
      (request?.action !== "create" && request?.action !== "import") ||
      pendingRequestId.current !== request.requestId ||
      closingImportId.current === request.requestId ||
      !requestingPubkey
    ) {
      throw new Error("This agent creation request is no longer available.");
    }
    const [agents, channels] = await Promise.all([
      managedAgentsQuery.refetch({ throwOnError: true }),
      channelsQuery.refetch({ throwOnError: true }),
    ]);
    if (
      pendingRequestId.current !== request.requestId ||
      closingImportId.current === request.requestId ||
      sourceAgentPubkey.current !== requestingPubkey ||
      classifyAgentManagementOrigin(
        agents.data,
        channels.data,
        requestingPubkey,
        request.request.channelId,
      ) !== "accept"
    ) {
      throw new Error(
        "This request requires an owned agent and a conversation you both still belong to.",
      );
    }
    if (checkHost && hostRequestIds.current.has(request.requestId)) {
      await authorizeResidentProposal(request.requestId);
    }
    if (
      closingImportId.current === request.requestId ||
      pendingRequestId.current !== request.requestId
    )
      throw new Error("This review is closing or no longer available.");
  }

  async function completeNativeCreate(completion: NativeAgentCompletion) {
    const requestingPubkey = sourceAgentPubkey.current;
    if (!request || !requestingPubkey) {
      throw new Error("This agent creation request is no longer available.");
    }
    // Creation already happened; current owner/room authority still governs
    // its receipt, even if the proposing model stopped waiting in the meantime.
    await authorizePendingCreate(false);
    await returnHostOutcome({
      status: "native_created",
      transactionId: completion.receipt.transactionId,
      ...(completion.attachment
        ? { attachedConversationId: completion.attachment.channelId }
        : {}),
    });
    await sendManagedAgentChannelMessage(
      agentManagementCompletionMessage(request, requestingPubkey, completion),
    );
  }

  async function completeNativeImport() {
    if (request?.action !== "import")
      throw new Error("This import review is no longer available.");
    const requestId = request.requestId;
    await authorizePendingCreate(false);
    if (
      pendingRequestId.current !== requestId ||
      closingImportId.current === requestId
    )
      throw new Error("This import review is no longer available.");
    await finishResidentProposal(requestId, { status: "native_imported" });
    completedHostRequestIds.current.add(requestId);
    void queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
    if (pendingRequestId.current === requestId) dismiss();
  }

  async function closeNativeImport() {
    const requestId = pendingRequestId.current;
    if (
      !requestId ||
      request?.action !== "import" ||
      request.requestId !== requestId ||
      closingImportBusy.current
    )
      return;
    // Once closing begins, neither an in-flight import callback nor a new
    // owner action can revive it. Retain the ID until the close is acknowledged.
    closingImportId.current = requestId;
    closingImportBusy.current = true;
    setImportCloseState({ closing: true, pending: true, error: null });
    try {
      await finishResidentProposal(requestId, {
        status: "closed",
        busy: false,
      });
      if (pendingRequestId.current === requestId) {
        completedHostRequestIds.current.add(requestId);
        dismiss();
      }
    } catch (cause) {
      if (pendingRequestId.current === requestId)
        setImportCloseState({
          closing: true,
          pending: false,
          error: `The host has not acknowledged closing this review. Retry closing: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
    } finally {
      closingImportBusy.current = false;
    }
  }

  async function returnHostOutcome(completion: ResidentProposalCompletion) {
    const requestId = pendingRequestId.current;
    if (
      !requestId ||
      !hostRequestIds.current.has(requestId) ||
      completedHostRequestIds.current.has(requestId)
    )
      return;
    await finishResidentProposal(requestId, completion);
    completedHostRequestIds.current.add(requestId);
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
    try {
      const previous = managedCreateOutcome.current;
      if (previous?.requestId === request.requestId) {
        // Only retry the outcome delivery. The previous save/create already ran.
        await returnHostOutcome(previous.completion);
        dismiss();
        return true;
      }
      await authorizePendingCreate();
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
      managedCreateOutcome.current = {
        requestId: request.requestId,
        name: persona.displayName,
        completion: { status: "definition_saved", personaId: persona.id },
      };

      if (intent === "definition_start") {
        const created = await createAgentMutation.mutateAsync(
          await buildInstanceInputForDefinition(
            persona,
            runtime,
            undefined,
            backendIntent ?? undefined,
          ),
        );
        managedCreateOutcome.current.completion = {
          status: "managed_created",
          residentPubkey: created.agent.pubkey,
          personaId: persona.id,
        };
        if (created.spawnError) throw new Error(created.spawnError);
        await authorizePendingCreate();
        const attachment = await attachManagedAgentToChannel(
          request.request.channelId,
          {
            agent: created.agent,
            role: "bot",
            ensureRunning: true,
          },
        );
        managedCreateOutcome.current.completion = {
          status: "managed_created",
          residentPubkey: created.agent.pubkey,
          personaId: persona.id,
          attachedConversationId: attachment.channelId,
        };
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: personasQueryKey }),
        queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey }),
      ]);
      await returnHostOutcome(managedCreateOutcome.current.completion);
      dismiss();
      return true;
    } catch (cause) {
      const saved = managedCreateOutcome.current;
      const detail =
        cause instanceof Error ? cause.message : "Could not finish this setup.";
      if (saved?.requestId === request.requestId) {
        try {
          await returnHostOutcome(saved.completion);
          toast.warning(
            `${saved.name} was saved. ${detail} Review its existing setup before trying again.`,
          );
          dismiss();
          return true;
        } catch {
          setError(
            `${saved.name} was saved, but its result could not be returned to Luca. Retry to send the same result; this will not create another agent.`,
          );
          return false;
        }
      }
      setError(detail);
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
    const requestId = pendingRequestId.current;
    if (requestId && hostRequestIds.current.has(requestId)) {
      if (!completedHostRequestIds.current.has(requestId)) {
        void finishResidentProposal(requestId, {
          status: "closed",
          busy: false,
        }).catch(() => {});
      }
      hostRequestIds.current.delete(requestId);
      completedHostRequestIds.current.delete(requestId);
    }
    pendingRequestId.current = null;
    sourceAgentPubkey.current = null;
    closingImportId.current = null;
    setImportCloseState({ closing: false, pending: false, error: null });
    managedCreateOutcome.current = null;
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
    completeNativeCreate,
    completeNativeImport,
    closeNativeImport,
    importCloseState,
    managedAgents: managedAgentsQuery.data ?? [],
    residentProposalId:
      request && hostRequestIds.current.has(request.requestId)
        ? request.requestId
        : undefined,
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
