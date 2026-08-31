import type {
  AgentPersona,
  CreatePersonaInput,
  RespondToMode,
} from "@/shared/api/types";

export const AGENT_MANAGEMENT_REQUEST = "agent_management_request" as const;

export type AgentManagementCreateRequest = {
  type: typeof AGENT_MANAGEMENT_REQUEST;
  action: "create";
  requestId: string;
  request: {
    channelId: string;
    displayName: string;
    systemPrompt: string;
    runtime?: string;
    provider?: string;
    model?: string;
    respondTo?: RespondToMode;
    projectId?: string;
    teamId?: string;
    createFirstChat?: boolean;
  };
};

export type AgentManagementUpdateRequest = {
  type: typeof AGENT_MANAGEMENT_REQUEST;
  action: "update";
  requestId: string;
  request: {
    channelId: string;
    agentName: string;
    displayName?: string;
    systemPrompt?: string;
    runtime?: string;
    provider?: string;
    model?: string;
    respondTo?: RespondToMode;
  };
};

export type AgentManagementRequest =
  | AgentManagementCreateRequest
  | AgentManagementUpdateRequest;

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRespondTo(value: unknown): value is RespondToMode | undefined {
  return value === undefined || value === "owner-only" || value === "anyone";
}

function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || isText(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Parses only the deliberately narrow no-secret agent-management request contract. */
export function parseAgentManagementRequest(
  value: unknown,
): AgentManagementRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Record<string, unknown>;
  if (
    payload.type !== AGENT_MANAGEMENT_REQUEST ||
    !isText(payload.requestId) ||
    (payload.action !== "create" && payload.action !== "update") ||
    typeof payload.request !== "object" ||
    payload.request === null
  ) {
    return null;
  }
  const request = payload.request as Record<string, unknown>;

  if (payload.action === "create") {
    if (
      !hasOnlyKeys(request, [
        "channelId",
        "displayName",
        "systemPrompt",
        "runtime",
        "provider",
        "model",
        "respondTo",
        "projectId",
        "teamId",
        "createFirstChat",
      ]) ||
      !isText(request.channelId) ||
      !isText(request.displayName) ||
      !isText(request.systemPrompt) ||
      !isOptionalText(request.runtime) ||
      !isOptionalText(request.provider) ||
      !isOptionalText(request.model) ||
      !isRespondTo(request.respondTo) ||
      !isOptionalText(request.projectId) ||
      !isOptionalText(request.teamId) ||
      (request.createFirstChat !== undefined &&
        typeof request.createFirstChat !== "boolean")
    ) {
      return null;
    }
    return {
      type: AGENT_MANAGEMENT_REQUEST,
      action: "create",
      requestId: payload.requestId,
      request: {
        channelId: request.channelId,
        displayName: request.displayName,
        systemPrompt: request.systemPrompt,
        ...(request.runtime ? { runtime: request.runtime } : {}),
        ...(request.provider ? { provider: request.provider } : {}),
        ...(request.model ? { model: request.model } : {}),
        ...(request.respondTo ? { respondTo: request.respondTo } : {}),
        ...(request.projectId ? { projectId: request.projectId } : {}),
        ...(request.teamId ? { teamId: request.teamId } : {}),
        ...(request.createFirstChat !== undefined
          ? { createFirstChat: request.createFirstChat }
          : {}),
      },
    };
  }

  if (
    !isRespondTo(request.respondTo) ||
    !hasOnlyKeys(request, [
      "channelId",
      "agentName",
      "displayName",
      "systemPrompt",
      "runtime",
      "provider",
      "model",
      "respondTo",
    ]) ||
    !isText(request.channelId) ||
    !isText(request.agentName)
  ) {
    return null;
  }
  const changes = {
    ...(isText(request.displayName)
      ? { displayName: request.displayName }
      : {}),
    ...(isText(request.systemPrompt)
      ? { systemPrompt: request.systemPrompt }
      : {}),
    ...(isText(request.runtime) ? { runtime: request.runtime } : {}),
    ...(isText(request.provider) ? { provider: request.provider } : {}),
    ...(isText(request.model) ? { model: request.model } : {}),
    ...(request.respondTo ? { respondTo: request.respondTo } : {}),
  };
  if (Object.keys(changes).length === 0) return null;
  return {
    type: AGENT_MANAGEMENT_REQUEST,
    action: "update",
    requestId: payload.requestId,
    request: {
      channelId: request.channelId,
      agentName: request.agentName,
      ...changes,
    },
  };
}

export function requestTargetsEditablePersona(
  persona: AgentPersona | undefined,
): persona is AgentPersona {
  return Boolean(persona && !persona.sourceTeam);
}

export function createInputFromRequest(
  request: Extract<AgentManagementRequest, { action: "create" }>,
): CreatePersonaInput {
  return {
    displayName: request.request.displayName,
    systemPrompt: request.request.systemPrompt,
    ...(request.request.runtime ? { runtime: request.request.runtime } : {}),
    ...(request.request.provider ? { provider: request.request.provider } : {}),
    ...(request.request.model ? { model: request.request.model } : {}),
    behavior: {
      respondTo: request.request.respondTo ?? "owner-only",
      respondToAllowlist: [],
    },
  };
}
