import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  activateRateLimit,
  parseRateLimitHint,
} from "@/shared/api/relayRateLimitGate";
import type {
  AddChannelMembersInput,
  AddChannelMembersResult,
  BackendProviderCandidate,
  BackendProviderProbeResult,
  CanvasResponse,
  GetHomeFeedInput,
  HomeFeedResponse,
  ManagedAgent,
  ManagedAgentBackend,
  RelayAgent,
  RelayMember,
  RelayMemberRole,
  PresenceLookup,
  PresenceStatus,
  RelayEvent,
  SearchMessagesInput,
  SearchMessagesResponse,
  SendChannelMessageResult,
  SetCanvasInput,
  SetCanvasResult,
  ThreadCursor,
  ThreadRepliesResponse,
  CreateManagedAgentInput,
  CreateManagedAgentResponse,
  AgentModelsResponse,
  UpdateManagedAgentInput,
  AcpAvailabilityStatus,
  AcpRuntimeCatalogEntry,
  AuthStatus,
  CommandAvailability,
  InstallRuntimeResult,
  GitBashPrerequisite,
  RuntimeConfigSurface,
  NativeResidentDiscoveryOutcome,
  RuntimeBinding,
} from "@/shared/api/types";

export * from "@/shared/api/tauriChannels";

export type OwnerInboxSource =
  | "conversation_membership"
  | "direct_messages"
  | "managed_agent_messages"
  | "read_state";
export type OwnerInboxSourceAvailability =
  | "ready"
  | "empty"
  | "degraded"
  | "unavailable";
export type OwnerInboxSourceReport = {
  source: OwnerInboxSource;
  availability: OwnerInboxSourceAvailability;
  diagnosticCode: string | null;
};
export type OwnerNativeInboxPresentationItem = {
  sourceEventId: string;
  kind: number;
  authorPubkey: string;
  content: string;
  createdAt: number;
  channelId: string;
  channelName: string;
  channelType: "direct" | "room";
  structuralTags: string[][];
  categories: Array<"direct" | "agents">;
};
export type OwnerNativeInboxResponse = {
  presentationItems: OwnerNativeInboxPresentationItem[];
  sources: OwnerInboxSourceReport[];
};
export type GetOwnerNativeInboxInput = { since?: number; limit?: number };

type RawPresenceLookup = Record<string, PresenceStatus>;

type RawAddChannelMembersResult = {
  added: string[];
  errors: Array<{
    pubkey: string;
    error: string;
  }>;
};

type RawFeedItem = {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  created_at: number;
  channel_id: string | null;
  channel_name: string;
  // Native FeedItemInfo.channel_type is Option<String>: serde emits `null`,
  // never omits the key.
  channel_type: string | null;
  tags: string[][];
  category: "mention" | "needs_action" | "activity" | "agent_activity";
};

type RawHomeFeedResponse = {
  feed: {
    mentions: RawFeedItem[];
    needs_action: RawFeedItem[];
    activity: RawFeedItem[];
    agent_activity: RawFeedItem[];
  };
  meta: {
    since: number;
    total: number;
    generated_at: number;
  };
};

type RawOwnerInboxSourceReport = {
  source:
    | "conversation_membership"
    | "direct_messages"
    | "managed_agent_messages"
    | "read_state";
  availability: "ready" | "empty" | "degraded" | "unavailable";
  diagnostic_code?: string;
};

type RawOwnerNativeInboxPresentationItem = {
  source_event_id: string;
  kind: number;
  author_pubkey: string;
  content: string;
  created_at: number;
  channel_id: string;
  channel_name: string;
  channel_type: "direct" | "room";
  structural_tags: string[][];
  categories: Array<"direct" | "agents">;
};

type RawOwnerNativeInboxResponse = {
  // The trusted protocol projection remains available to future native Inbox
  // surfaces, but this compatibility adapter consumes presentation fields
  // only. Keep it opaque rather than duplicating the Rust protocol contract.
  projection: unknown;
  presentation_items: RawOwnerNativeInboxPresentationItem[];
  sources: RawOwnerInboxSourceReport[];
};

type RawSearchHit = {
  event_id: string;
  content: string;
  kind: number;
  pubkey: string;
  channel_id: string | null;
  channel_name: string | null;
  created_at: number;
  score: number;
};

type RawSearchResponse = {
  hits: RawSearchHit[];
  found: number;
};

type RawSendChannelMessageResult = {
  event_id: string;
  parent_event_id: string | null;
  root_event_id: string | null;
  depth: number;
  created_at: number;
};

type RawRelayAgent = {
  pubkey: string;
  name: string;
  agent_type: string;
  channels: string[];
  channel_ids: string[];
  capabilities: string[];
  status: RelayAgent["status"];
  respond_to?: RelayAgent["respondTo"];
  respond_to_allowlist?: string[];
};
export type RawManagedAgent = {
  pubkey: string;
  name: string;
  persona_id: string | null;
  team_id?: string | null;
  relay_url: string;
  acp_command: string;
  agent_command: string;
  agent_command_override?: string | null;
  agent_args: string[];
  mcp_command: string;
  turn_timeout_seconds: number;
  idle_timeout_seconds: number | null;
  max_turn_duration_seconds: number | null;
  parallelism: number;
  system_prompt: string | null;
  avatar_url?: string | null;
  model: string | null;
  provider: string | null;
  persona_out_of_date: boolean;
  persona_orphaned: boolean;
  needs_restart: boolean;
  env_vars?: Record<string, string>;
  status: ManagedAgent["status"];
  pid: number | null;
  created_at: string;
  updated_at: string;
  last_started_at: string | null;
  last_stopped_at: string | null;
  last_exit_code: number | null;
  last_error: string | null;
  last_error_code: number | null;
  log_path: string;
  start_on_app_launch: boolean;
  auto_restart_on_config_change?: boolean;
  backend: ManagedAgentBackend;
  backend_agent_id: string | null;
  native_runtime_binding?: RuntimeBinding | null;
  // The agent folder (`residents/<pubkey>`) and its content hash. Optional:
  // a record only gains them once the boot migration or a create has
  // materialized the folder.
  documents_dir?: string | null;
  documents_hash?: string | null;
  // Optional: pre-feature mock fixtures may omit these. Mapped to
  // `"owner-only"` / `[]` in `fromRawManagedAgent`.
  respond_to?: ManagedAgent["respondTo"];
  respond_to_allowlist?: string[];
};

type RawCreateLucaResidentResponse = {
  resident: {
    residentPubkey: string;
  };
  profileSyncError: string | null;
  spawnError: string | null;
  reused: boolean;
  recoveryNotice: string | null;
};

type RawManagedAgentLog = {
  content: string;
  log_path: string;
};

export type RawAcpRuntimeCatalogEntry = {
  id: string;
  label: string;
  avatar_url: string;
  availability: AcpAvailabilityStatus;
  command: string | null;
  binary_path: string | null;
  default_args: string[];
  mcp_command: string | null;
  artifact_mcp_support?: "standard_session_new";
  model_env_var?: string | null;
  provider_env_var?: string | null;
  thinking_env_var?: string | null;
  install_hint: string;
  install_instructions_url: string;
  can_auto_install: boolean;
  underlying_cli_path: string | null;
  node_required: boolean;
  /** Tagged union with snake_case status values — same shape as `AuthStatus`. */
  auth_status: AuthStatus;
  login_hint?: string;
};

export type RawInstallStepResult = {
  step: string;
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  hint?: string;
};

export type RawInstallRuntimeResult = {
  success: boolean;
  steps: RawInstallStepResult[];
  restarted_count: number;
  failed_restart_count: number;
};

type RawGitBashPrerequisite = {
  available: boolean;
  path: string | null;
  install_instructions_url: string;
  install_hint: string;
};

type RawCommandAvailability = {
  command: string;
  resolved_path: string | null;
  available: boolean;
};

type RawManagedAgentPrereqs = {
  acp: RawCommandAvailability;
  mcp: RawCommandAvailability;
};

type RawRelayMember = {
  pubkey: string;
  role: string;
  added_by: string | null;
  created_at: string;
};

type RawListRelayMembersResponse = {
  members: RawRelayMember[];
};

type RawCanvasResponse = {
  content: string | null;
  updated_at: number | null;
  author: string | null;
};

type RawSetCanvasResult = {
  ok: boolean;
  event_id: string;
};

/** Error normalized from a rejected Tauri invocation with its wire payload. */
export class TauriInvokeError extends Error {
  readonly payload: unknown;

  constructor(message: string, payload: unknown) {
    super(message);
    this.name = "TauriInvokeError";
    this.payload = payload;
  }
}

function toTauriError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new TauriInvokeError(error, error);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new TauriInvokeError(error.message, error);
  }

  try {
    return new TauriInvokeError(JSON.stringify(error), error);
  } catch {
    return new TauriInvokeError("Unknown Tauri error", error);
  }
}

/**
 * Inspect a Tauri error message and activate the shared rate-limit gate when
 * the Rust relay layer emitted an HTTP 429 response (`relay rate-limited:` prefix).
 *
 * Extracted so it can be unit-tested without mocking the Tauri invoke bridge.
 */
export function applyTauriRateLimitIfNeeded(message: string): void {
  if (message.startsWith("relay rate-limited:")) {
    activateRateLimit(parseRateLimitHint(message));
  }
}

export async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    const err = toTauriError(error);
    // Rust emits `relay rate-limited:` for HTTP 429 responses. Activate the
    // shared gate so the TS relay client backs off for the same window.
    applyTauriRateLimitIfNeeded(err.message);
    throw err;
  }
}

export function fromRawFeedItem(item: RawFeedItem) {
  return {
    id: item.id,
    kind: item.kind,
    pubkey: item.pubkey,
    content: item.content,
    createdAt: item.created_at,
    channelId: item.channel_id,
    channelName: item.channel_name,
    // Canonicalize the wire `null` to undefined so FeedItem's optional
    // channelType contract holds at runtime (enrichment and the DM
    // notification filter both key off `=== undefined`).
    channelType: item.channel_type ?? undefined,
    tags: item.tags,
    category: item.category,
  };
}

function fromRawSearchHit(hit: RawSearchHit) {
  return {
    eventId: hit.event_id,
    content: hit.content,
    kind: hit.kind,
    pubkey: hit.pubkey,
    channelId: hit.channel_id,
    channelName: hit.channel_name,
    createdAt: hit.created_at,
    score: hit.score,
  };
}

export async function getPresence(pubkeys: string[]): Promise<PresenceLookup> {
  const response = await invokeTauri<RawPresenceLookup>("get_presence", {
    pubkeys,
  });

  return Object.fromEntries(
    Object.entries(response).map(([pubkey, status]) => [
      pubkey.toLowerCase(),
      status,
    ]),
  );
}

export function getDefaultRelayUrl(): Promise<string> {
  return invokeTauri<string>("get_default_relay_url");
}

export function isSharedIdentity(): Promise<boolean> {
  return invokeTauri<boolean>("is_shared_identity");
}

export function getRelayWsUrl(): Promise<string> {
  return invokeTauri<string>("get_relay_ws_url");
}

export function getRelayHttpUrl(): Promise<string> {
  return invokeTauri<string>("get_relay_http_url");
}

export async function addChannelMembers(
  input: AddChannelMembersInput,
): Promise<AddChannelMembersResult> {
  return invokeTauri<RawAddChannelMembersResult>("add_channel_members", input);
}

export async function removeChannelMember(
  channelId: string,
  pubkey: string,
): Promise<void> {
  await invokeTauri("remove_channel_member", { channelId, pubkey });
}

export async function changeChannelMemberRole(
  channelId: string,
  pubkey: string,
  role: string,
): Promise<void> {
  await invokeTauri("change_channel_member_role", { channelId, pubkey, role });
}

export async function joinChannel(channelId: string): Promise<void> {
  await invokeTauri("join_channel", { channelId });
}

export async function leaveChannel(channelId: string): Promise<void> {
  await invokeTauri("leave_channel", { channelId });
}

export async function getCanvas(channelId: string): Promise<CanvasResponse> {
  const response = await invokeTauri<RawCanvasResponse>("get_canvas", {
    channelId,
  });
  return {
    content: response.content,
    // Normalize absent keys to null: ensureWelcomeCanvas treats null as
    // "no canvas yet", and `undefined !== null` would make every fresh
    // channel look already-seeded.
    updatedAt: response.updated_at ?? null,
    author: response.author ?? null,
  };
}

export async function setCanvas(
  input: SetCanvasInput,
): Promise<SetCanvasResult> {
  const response = await invokeTauri<RawSetCanvasResult>("set_canvas", {
    channelId: input.channelId,
    content: input.content,
  });
  return {
    ok: response.ok,
    eventId: response.event_id,
  };
}

export async function getHomeFeed(
  input: GetHomeFeedInput = {},
): Promise<HomeFeedResponse> {
  const response = await invokeTauri<RawHomeFeedResponse>("get_feed", input);

  return {
    feed: {
      mentions: response.feed.mentions.map(fromRawFeedItem),
      needsAction: response.feed.needs_action.map(fromRawFeedItem),
      activity: response.feed.activity.map(fromRawFeedItem),
      agentActivity: response.feed.agent_activity.map(fromRawFeedItem),
    },
    meta: {
      since: response.meta.since,
      total: response.meta.total,
      generatedAt: response.meta.generated_at,
    },
  };
}

/**
 * Read the trusted desktop's passive native Inbox projection. This command
 * never dispatches an agent or changes read state.
 */
export async function getOwnerNativeInbox(
  input: GetOwnerNativeInboxInput = {},
): Promise<OwnerNativeInboxResponse> {
  const response = await invokeTauri<RawOwnerNativeInboxResponse>(
    "get_luca_owner_inbox",
    input,
  );

  return {
    presentationItems: response.presentation_items.map((item) => ({
      sourceEventId: item.source_event_id,
      kind: item.kind,
      authorPubkey: item.author_pubkey,
      content: item.content,
      createdAt: item.created_at,
      channelId: item.channel_id,
      channelName: item.channel_name,
      channelType: item.channel_type,
      structuralTags: item.structural_tags,
      categories: item.categories,
    })),
    sources: response.sources.map((source) => ({
      source: source.source,
      availability: source.availability,
      diagnosticCode: source.diagnostic_code ?? null,
    })),
  };
}

export async function searchMessages(
  input: SearchMessagesInput,
): Promise<SearchMessagesResponse> {
  const response = await invokeTauri<RawSearchResponse>("search_messages", {
    q: input.q,
    limit: input.limit,
    channelId: input.channelId,
  });

  return {
    hits: response.hits.map(fromRawSearchHit),
    found: response.found,
  };
}

export async function getEventById(eventId: string): Promise<RelayEvent> {
  const eventJson = await invokeTauri<string>("get_event", { eventId });
  return JSON.parse(eventJson) as RelayEvent;
}

type RawThreadCursor = {
  created_at: number;
  event_id: string;
};

type RawThreadRepliesResponse = {
  events: RelayEvent[];
  next_cursor: RawThreadCursor | null;
};

/**
 * Fetch the full reply subtree under a thread root, server-side.
 *
 * Unlike the channel timeline (which the desktop assembles from its local
 * cache), this walks `thread_metadata` on the relay, so a thread renders
 * complete even when its replies fell outside the channel cold-load window —
 * the descendant gap that made deep/old threads silently incomplete.
 *
 * Paging is forward keyset on `(createdAt, eventId)`: pass the returned
 * `nextCursor` back as `cursor` for the next page. `nextCursor` is non-null only
 * when a full page was returned. The returned `events` are raw nostr events
 * (`RelayEvent`), chronological (oldest first). These are the *replies* under
 * the root (depth >= 1); the root event itself is NOT returned (the relay query
 * keys on `root_event_id`, which a root row lacks). The caller already holds
 * the root — it is the open thread head.
 */
export async function getThreadReplies(
  rootEventId: string,
  channelId?: string | null,
  options?: {
    limit?: number;
    depthLimit?: number;
    cursor?: ThreadCursor | null;
  },
): Promise<ThreadRepliesResponse> {
  const response = await invokeTauri<RawThreadRepliesResponse>(
    "get_thread_replies",
    {
      rootEventId,
      channelId: channelId ?? null,
      limit: options?.limit ?? null,
      depthLimit: options?.depthLimit ?? null,
      cursor: options?.cursor
        ? {
            created_at: options.cursor.createdAt,
            event_id: options.cursor.eventId,
          }
        : null,
    },
  );

  return {
    events: response.events,
    nextCursor: response.next_cursor
      ? {
          createdAt: response.next_cursor.created_at,
          eventId: response.next_cursor.event_id,
        }
      : null,
  };
}

export async function sendChannelMessage(
  channelId: string,
  content: string,
  parentEventId?: string | null,
  mediaTags?: string[][],
  mentionPubkeys?: string[],
  kind?: number,
  emojiTags?: string[][],
  mentionTags?: string[][],
  managedAudience?: import("@/features/messages/lib/managedAudience").ManagedAudienceIntentV1,
  responseSurface?: import("@/features/messages/lib/managedAudience").ManagedResponseSurface,
): Promise<SendChannelMessageResult> {
  const response = await invokeTauri<RawSendChannelMessageResult>(
    "send_channel_message",
    {
      channelId,
      content,
      parentEventId,
      mediaTags: mediaTags ?? null,
      emojiTags: emojiTags ?? null,
      mentionTags: mentionTags ?? null,
      mentionPubkeys: mentionPubkeys ?? null,
      kind: kind ?? null,
      managedAudience: managedAudience ?? null,
      responseSurface: responseSurface ?? null,
    },
  );

  return {
    eventId: response.event_id,
    parentEventId: response.parent_event_id,
    rootEventId: response.root_event_id,
    depth: response.depth,
    createdAt: response.created_at,
  };
}

export type BlobDescriptor = {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
  dim?: string;
  blurhash?: string;
  thumb?: string;
  duration?: number;
  image?: string;
  /** Original filename captured client-side. */
  filename?: string;
  /** Non-secret desktop-local reference for a managed resident attachment. */
  artifactHandleId?: string;
};

export async function uploadMedia(
  filePath: string,
  isTemp: boolean,
): Promise<BlobDescriptor> {
  return invokeTauri<BlobDescriptor>("upload_media", {
    filePath,
    isTemp,
  });
}

export async function pickAndUploadMedia(): Promise<BlobDescriptor[]> {
  return invokeTauri<BlobDescriptor[]>("pick_and_upload_media", {});
}

export async function uploadMediaBytes(
  data: number[],
  filename?: string,
  /** Correlation id for `media-upload-progress` events from the Rust side. */
  progressId?: string,
): Promise<BlobDescriptor> {
  return invokeTauri<BlobDescriptor>("upload_media_bytes", {
    data,
    filename,
    progressId,
  });
}

export async function editMessage(
  channelId: string,
  eventId: string,
  content: string,
  mediaTags?: string[][],
  emojiTags?: string[][],
  mentionPubkeys?: string[],
): Promise<void> {
  await invokeTauri("edit_message", {
    channelId,
    eventId,
    content,
    mediaTags: mediaTags ?? [],
    emojiTags: emojiTags ?? [],
    mentionPubkeys: mentionPubkeys ?? null,
  });
}

export async function deleteMessage(
  channelId: string,
  eventId: string,
): Promise<void> {
  await invokeTauri("delete_message", { channelId, eventId });
}

export async function addReaction(
  eventId: string,
  emoji: string,
  emojiUrl?: string,
): Promise<void> {
  await invokeTauri("add_reaction", { eventId, emoji, emojiUrl });
}

export async function removeReaction(
  eventId: string,
  emoji: string,
): Promise<void> {
  await invokeTauri("remove_reaction", { eventId, emoji });
}

export async function signRelayEvent(input: {
  kind: number;
  content: string;
  createdAt?: number;
  tags: string[][];
}): Promise<RelayEvent> {
  const eventJson = await invokeTauri<string>("sign_event", input);
  return JSON.parse(eventJson) as RelayEvent;
}

export async function createAuthEvent(input: {
  challenge: string;
  relayUrl: string;
}): Promise<RelayEvent> {
  const eventJson = await invokeTauri<string>("create_auth_event", input);
  return JSON.parse(eventJson) as RelayEvent;
}

function fromRawRelayAgent(agent: RawRelayAgent): RelayAgent {
  return {
    pubkey: agent.pubkey,
    name: agent.name,
    agentType: agent.agent_type,
    channels: agent.channels,
    channelIds: agent.channel_ids ?? [],
    capabilities: agent.capabilities,
    status: agent.status,
    respondTo: agent.respond_to ?? null,
    respondToAllowlist: agent.respond_to_allowlist ?? [],
  };
}

export function fromRawManagedAgent(agent: RawManagedAgent): ManagedAgent {
  return {
    pubkey: agent.pubkey,
    name: agent.name,
    personaId: agent.persona_id,
    teamId: agent.team_id ?? null,
    relayUrl: agent.relay_url,
    acpCommand: agent.acp_command,
    agentCommand: agent.agent_command,
    agentCommandOverride: agent.agent_command_override ?? null,
    agentArgs: agent.agent_args,
    mcpCommand: agent.mcp_command,
    turnTimeoutSeconds: agent.turn_timeout_seconds,
    idleTimeoutSeconds: agent.idle_timeout_seconds,
    maxTurnDurationSeconds: agent.max_turn_duration_seconds,
    parallelism: agent.parallelism,
    systemPrompt: agent.system_prompt,
    avatarUrl: agent.avatar_url ?? null,
    model: agent.model,
    provider: agent.provider ?? null,
    personaOutOfDate: agent.persona_out_of_date ?? false,
    personaOrphaned: agent.persona_orphaned ?? false,
    needsRestart: agent.needs_restart ?? false,
    envVars: agent.env_vars ?? {},
    status: agent.status,
    pid: agent.pid,
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
    lastStartedAt: agent.last_started_at,
    lastStoppedAt: agent.last_stopped_at,
    lastExitCode: agent.last_exit_code,
    lastError: agent.last_error,
    lastErrorCode: agent.last_error_code ?? null,
    logPath: agent.log_path,
    startOnAppLaunch: agent.start_on_app_launch,
    autoRestartOnConfigChange: agent.auto_restart_on_config_change ?? true,
    backend: agent.backend,
    backendAgentId: agent.backend_agent_id,
    nativeRuntimeBinding: agent.native_runtime_binding ?? null,
    documentsDir: agent.documents_dir ?? null,
    documentsHash: agent.documents_hash ?? null,
    // Fallbacks for pre-feature mocks/fixtures that don't carry these fields.
    // Real agent records always include them (defaulted server-side).
    respondTo: agent.respond_to ?? "owner-only",
    respondToAllowlist: agent.respond_to_allowlist ?? [],
  };
}

function fromRawAcpRuntimeCatalogEntry(
  entry: RawAcpRuntimeCatalogEntry,
): AcpRuntimeCatalogEntry {
  return {
    id: entry.id,
    label: entry.label,
    avatarUrl: entry.avatar_url,
    availability: entry.availability,
    command: entry.command,
    binaryPath: entry.binary_path,
    defaultArgs: entry.default_args,
    mcpCommand: entry.mcp_command,
    artifactMcpSupport: entry.artifact_mcp_support ?? "standard_session_new",
    modelEnvVar: entry.model_env_var ?? null,
    providerEnvVar: entry.provider_env_var ?? null,
    thinkingEnvVar: entry.thinking_env_var ?? null,
    installHint: entry.install_hint,
    installInstructionsUrl: entry.install_instructions_url,
    canAutoInstall: entry.can_auto_install,
    underlyingCliPath: entry.underlying_cli_path,
    nodeRequired: entry.node_required,
    authStatus: entry.auth_status,
    loginHint: entry.login_hint ?? null,
  };
}

function fromRawInstallRuntimeResult(
  raw: RawInstallRuntimeResult,
): InstallRuntimeResult {
  return {
    success: raw.success,
    steps: raw.steps.map((step) => ({
      step: step.step,
      command: step.command,
      success: step.success,
      stdout: step.stdout,
      stderr: step.stderr,
      exitCode: step.exit_code,
      hint: step.hint,
    })),
    restartedCount: raw.restarted_count,
    failedRestartCount: raw.failed_restart_count,
  };
}

function fromRawCommandAvailability(
  command: RawCommandAvailability,
): CommandAvailability {
  return {
    command: command.command,
    resolvedPath: command.resolved_path,
    available: command.available,
  };
}

// ── Relay Members ────────────────────────────────────────────────────────────

function fromRawRelayMember(raw: RawRelayMember): RelayMember {
  return {
    pubkey: raw.pubkey,
    role: raw.role as RelayMemberRole,
    addedBy: raw.added_by,
    createdAt: raw.created_at,
  };
}

export async function listRelayMembers(): Promise<RelayMember[]> {
  const response =
    await invokeTauri<RawListRelayMembersResponse>("list_relay_members");
  return response.members.map(fromRawRelayMember);
}

export async function getMyRelayMembership(): Promise<RelayMember | null> {
  try {
    const raw = await invokeTauri<RawRelayMember>("get_my_relay_membership");
    return fromRawRelayMember(raw);
  } catch (error) {
    // "relay returned 404 Not Found" = not a relay member — return null so
    // the UI hides the Members tab. Re-throw real errors (network, auth, 500)
    // so React Query surfaces them.
    if (
      error instanceof Error &&
      error.message.startsWith("relay returned 404")
    ) {
      return null;
    }
    throw error;
  }
}

export async function addRelayMember(
  targetPubkey: string,
  role: string,
): Promise<void> {
  await invokeTauri("add_relay_member", { targetPubkey, role });
}

export async function removeRelayMember(targetPubkey: string): Promise<void> {
  await invokeTauri("remove_relay_member", { targetPubkey });
}

export async function changeRelayMemberRole(
  targetPubkey: string,
  newRole: string,
): Promise<void> {
  await invokeTauri("change_relay_member_role", { targetPubkey, newRole });
}

export async function listRelayAgents(): Promise<RelayAgent[]> {
  return (await invokeTauri<RawRelayAgent[]>("list_relay_agents")).map(
    fromRawRelayAgent,
  );
}

export async function listManagedAgents(): Promise<ManagedAgent[]> {
  return (await invokeTauri<RawManagedAgent[]>("list_managed_agents")).map(
    fromRawManagedAgent,
  );
}
export async function createManagedAgent(
  input: CreateManagedAgentInput,
): Promise<CreateManagedAgentResponse> {
  const response = await invokeTauri<RawCreateLucaResidentResponse>(
    "create_luca_resident",
    {
      input: {
        name: input.name,
        personaId: input.personaId,
        teamId: input.teamId,
        relayUrl: input.relayUrl,
        acpCommand: input.acpCommand,
        agentCommand: input.agentCommand,
        harnessOverride: input.harnessOverride ?? false,
        agentArgs: input.agentArgs,
        mcpCommand: input.mcpCommand,
        turnTimeoutSeconds: input.turnTimeoutSeconds,
        idleTimeoutSeconds: input.idleTimeoutSeconds,
        maxTurnDurationSeconds: input.maxTurnDurationSeconds,
        parallelism: input.parallelism,
        systemPrompt: input.systemPrompt,
        avatarUrl: input.avatarUrl,
        model: input.model,
        provider: input.provider,
        envVars: input.envVars ?? {},
        spawnAfterCreate: input.spawnAfterCreate,
        startOnAppLaunch: input.startOnAppLaunch,
        backend: input.backend,
        nativeRuntimeBinding: input.nativeRuntimeBinding,
        respondTo: input.respondTo,
        respondToAllowlist: input.respondToAllowlist,
        relayMesh: input.relayMesh,
      },
    },
  );
  const agent = (await listManagedAgents()).find(
    (candidate) => candidate.pubkey === response.resident.residentPubkey,
  );
  if (!agent) {
    throw new Error(
      "Resident identity was created, but its public record could not be loaded. Refresh Agents before retrying.",
    );
  }

  return {
    agent,
    // Retained only for the legacy TypeScript response shape. Luca's safe
    // command never returns a resident secret to the renderer.
    privateKeyNsec: "",
    profileSyncError: response.profileSyncError,
    spawnError: response.spawnError,
    reused: response.reused,
    recoveryNotice: response.recoveryNotice,
  };
}

export async function deleteManagedAgent(
  pubkey: string,
  forceRemoteDelete?: boolean,
): Promise<void> {
  await invokeTauri("delete_managed_agent", {
    pubkey,
    forceRemoteDelete: forceRemoteDelete ?? null,
  });
}

export async function getManagedAgentLog(pubkey: string, lineCount?: number) {
  const response = await invokeTauri<RawManagedAgentLog>(
    "get_managed_agent_log",
    {
      pubkey,
      lineCount,
    },
  );

  return {
    content: response.content,
    logPath: response.log_path,
  };
}

export async function discoverGitBashPrerequisite(): Promise<GitBashPrerequisite | null> {
  const prerequisite = await invokeTauri<RawGitBashPrerequisite | null>(
    "discover_git_bash_prerequisite",
  );
  return (
    prerequisite && {
      available: prerequisite.available,
      path: prerequisite.path,
      installInstructionsUrl: prerequisite.install_instructions_url,
      installHint: prerequisite.install_hint,
    }
  );
}

export async function discoverAcpRuntimes(): Promise<AcpRuntimeCatalogEntry[]> {
  return (
    await invokeTauri<RawAcpRuntimeCatalogEntry[]>("discover_acp_providers")
  ).map(fromRawAcpRuntimeCatalogEntry);
}

/** Read-only enumeration of exact native Hermes/OpenClaw identities. */
export async function discoverNativeResidents(): Promise<NativeResidentDiscoveryOutcome> {
  return invokeTauri<NativeResidentDiscoveryOutcome>(
    "discover_native_residents",
    {},
  );
}

export async function installAcpRuntime(
  runtimeId: string,
): Promise<InstallRuntimeResult> {
  const raw = await invokeTauri<RawInstallRuntimeResult>(
    "install_acp_runtime",
    { runtimeId },
  );
  return fromRawInstallRuntimeResult(raw);
}

export async function discoverManagedAgentPrereqs(input: {
  acpCommand?: string;
  mcpCommand?: string;
}) {
  const response = await invokeTauri<RawManagedAgentPrereqs>(
    "discover_managed_agent_prereqs",
    {
      input: {
        acpCommand: input.acpCommand,
        mcpCommand: input.mcpCommand,
      },
    },
  );

  return {
    acp: fromRawCommandAvailability(response.acp),
    mcp: fromRawCommandAvailability(response.mcp),
  };
}

// ── Model discovery ───────────────────────────────────────────────────────────

export async function getAgentModels(pubkey: string) {
  return invokeTauri<AgentModelsResponse>("get_agent_models", { pubkey });
}

export async function getAgentConfigSurface(
  pubkey: string,
): Promise<RuntimeConfigSurface> {
  return invokeTauri<RuntimeConfigSurface>("get_agent_config_surface", {
    pubkey,
  });
}

export async function putAgentSessionConfig(
  pubkey: string,
  payload: unknown,
): Promise<void> {
  return invokeTauri<void>("put_agent_session_config", { pubkey, payload });
}

/** File-layer config for a runtime (e.g. `~/.config/goose/config.yaml`). */
export type RuntimeFileConfigSubset = {
  /** Provider set in the harness config file. */
  provider: string | null;
  /** Model set in the harness config file. */
  model: string | null;
  /** Credential env key names whose values are present in the file config. */
  satisfiedEnvKeys: string[];
};

/**
 * Get the file-layer config for a runtime so dialogs can show
 * "Set in goose config" instead of surfacing a false required-field marker.
 * Returns `null` when the runtime has no config file or it cannot be parsed.
 */
export async function getRuntimeFileConfig(
  runtimeId: string,
): Promise<RuntimeFileConfigSubset | null> {
  return invokeTauri<RuntimeFileConfigSubset | null>(
    "get_runtime_file_config",
    {
      runtimeId,
    },
  );
}

/**
 * Return the key names of all non-empty baked build env vars.
 *
 * Internal (Block) builds bake provider credentials into the binary at compile
 * time. This returns the *key names only* — never the values — so dialogs can
 * treat them as satisfied without exposing secrets to the frontend.
 *
 * OSS builds return an empty array (no baked env).
 */
export async function getBakedBuildEnvKeys(): Promise<string[]> {
  return invokeTauri<string[]>("get_baked_build_env_keys");
}

/**
 * A single baked build env entry.
 *
 * The value is already masked in Rust for secret keys (keys not in the
 * explicit safe-to-reveal allowlist: `BUZZ_AGENT_PROVIDER`, `BUZZ_AGENT_MODEL`,
 * `DATABRICKS_HOST`, `DATABRICKS_MODEL`). Non-allowlisted keys have their
 * values replaced with `••••••`. Non-secret values are shown as-is.
 * Empty-value keys are filtered out.
 */
export type BakedEnvEntry = {
  key: string;
  /** Display value — real value or `••••••` for masked keys. */
  value: string;
  /** `true` when the value was replaced by the mask placeholder in Rust. */
  masked: boolean;
};

/**
 * Return the baked build env entries with values shown (masked where
 * appropriate) for display in the Agent defaults card.
 *
 * Provider and model arrive as `BUZZ_AGENT_PROVIDER` / `BUZZ_AGENT_MODEL`
 * keys and are included in the list alongside other baked vars.
 *
 * OSS builds return an empty array — the baked-env section is hidden.
 */
export async function getBakedBuildEnv(): Promise<BakedEnvEntry[]> {
  return invokeTauri<BakedEnvEntry[]>("get_baked_build_env");
}

type RawUpdateManagedAgentResponse = {
  agent: RawManagedAgent;
  profile_sync_error: string | null;
};

export async function updateManagedAgent(
  input: UpdateManagedAgentInput,
): Promise<{ agent: ManagedAgent; profileSyncError: string | null }> {
  const response = await invokeTauri<RawUpdateManagedAgentResponse>(
    "update_managed_agent",
    { input },
  );
  return {
    agent: fromRawManagedAgent(response.agent),
    profileSyncError: response.profile_sync_error,
  };
}

// ── Backend provider discovery ────────────────────────────────────────────────

export async function discoverBackendProviders(): Promise<
  BackendProviderCandidate[]
> {
  return invokeTauri<BackendProviderCandidate[]>("discover_backend_providers");
}

export async function probeBackendProvider(
  binaryPath: string,
): Promise<BackendProviderProbeResult> {
  return invokeTauri<BackendProviderProbeResult>("probe_backend_provider", {
    binaryPath,
  });
}

// ── NIP-44 encrypt-to-self ───────────────────────────────────────────────────

export async function nip44EncryptToSelf(plaintext: string): Promise<string> {
  return invokeTauri<string>("nip44_encrypt_to_self", { plaintext });
}

export async function nip44DecryptFromSelf(
  ciphertext: string,
): Promise<string> {
  return invokeTauri<string>("nip44_decrypt_from_self", { ciphertext });
}

// ── NIP-AB device pairing ───────────────────────────────────────────────────

export async function startPairing(): Promise<string> {
  return invokeTauri<string>("start_pairing");
}

export async function confirmPairingSas(): Promise<void> {
  await invokeTauri("confirm_pairing_sas");
}

export async function cancelPairing(): Promise<void> {
  await invokeTauri("cancel_pairing");
}

export async function applyCommunity(
  relayUrl: string,
  nsec?: string,
  token?: string,
  reposDir?: string,
  agentManagedProfiles?: boolean,
): Promise<void> {
  await invokeTauri("apply_workspace", {
    relayUrl,
    nsec: nsec ?? null,
    token: token ?? null,
    reposDir: reposDir ?? null,
    agentManagedProfiles: agentManagedProfiles ?? false,
  });
}

// Validate a candidate repos dir without mutating the filesystem. Rejects
// with a human-readable reason; resolves for a valid or empty path.
export async function validateReposDir(dir: string): Promise<void> {
  await invokeTauri("validate_repos_dir", { dir });
}

export const setPreventSleepActive = (active: boolean) =>
  invokeTauri("set_prevent_sleep_active", { active });

export const setAgentManagedProfiles = (enabled: boolean) =>
  invokeTauri("set_agent_managed_profiles", { enabled });

/** Returns true on macOS, Windows, and Linux AppImage installs.
 *  Returns false on Linux non-AppImage packages (e.g. .deb) where
 *  Tauri's updater cannot swap the binary. */
export function isAutoUpdateSupported(): Promise<boolean> {
  return invokeTauri<boolean>("is_auto_update_supported");
}
