import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";
import type {
  ManagedPermissionActivityKind,
  ManagedPermissionRequest,
  ManagedPermissionTense,
  ManagedPermissionResolvedEvent,
  PendingManagedPermission,
  PermissionOffer,
} from "@/shared/api/types";

type RawRuntimeManagedPermissionRequest = {
  protocol: "luca.managed.permission.v1";
  resident_pubkey: string;
  conversation_id: string;
  session_epoch: number;
  turn_id: string;
  acp_request_id: string;
  title: string;
  tool_call_id?: string | null;
  action_preview?: string | null;
  options: Array<{ option_id: string; name: string; kind: string }>;
  dispatch_receipt_id?: string | null;
  tool_kind?: string | null;
  activity_kind?: ManagedPermissionActivityKind | null;
  tool_name?: string | null;
  mcp_server?: string | null;
  mcp_tool?: string | null;
  command_token?: string | null;
  command_argv_prefix?: string[] | null;
  path?: string | null;
  domain?: string | null;
  write?: boolean | null;
};

/**
 * The native side serialises the offer camelCase; the beta.11 contract was
 * written snake_case. Accept both so a field name never silently turns a
 * remembered answer into "once only".
 */
type RawPermissionOffer = {
  once: boolean;
  task: boolean;
  always_here?: boolean;
  alwaysHere?: boolean;
  deny: boolean;
  project_label?: string | null;
  projectLabel?: string | null;
  note?: string | null;
};

/**
 * What a card offers when the native side said nothing: the owner may answer
 * for this one request or decline, and nothing is remembered.
 */
const FAIL_CLOSED_OFFER: PermissionOffer = {
  once: true,
  task: false,
  alwaysHere: false,
  deny: true,
  projectLabel: null,
  note: null,
};

type RawCapabilityManagedPermissionRequest = {
  protocol: "luca.managed.permission.v2";
  resident_pubkey: string;
  conversation_id: string;
  session_epoch: number;
  turn_id: string;
  request_id: string;
  capability: import("@/shared/api/types").CapabilityKind;
  risk: import("@/shared/api/types").CapabilityRisk;
  operation: string;
  operation_fingerprint: string;
  resource: {
    kind: string;
    resource_ref: string;
    display_name: string;
  };
};

type RawManagedPermissionRequest =
  | RawRuntimeManagedPermissionRequest
  | RawCapabilityManagedPermissionRequest;

type RawPendingManagedPermission = {
  pendingId: string;
  request: RawManagedPermissionRequest;
  offer?: RawPermissionOffer | null;
};

/** Convert the local broker wire shape into the desktop permission model. */
export function normalizeManagedPermissionRequest(
  request: RawManagedPermissionRequest,
): ManagedPermissionRequest {
  if (request.protocol === "luca.managed.permission.v2") {
    return {
      protocol: request.protocol,
      residentPubkey: request.resident_pubkey,
      conversationId: request.conversation_id,
      sessionEpoch: request.session_epoch,
      turnId: request.turn_id,
      requestId: request.request_id,
      capability: request.capability,
      risk: request.risk,
      operation: request.operation,
      operationFingerprint: request.operation_fingerprint,
      resource: {
        kind: request.resource.kind,
        resourceRef: request.resource.resource_ref,
        displayName: request.resource.display_name,
      },
    };
  }
  return {
    protocol: request.protocol,
    residentPubkey: request.resident_pubkey,
    conversationId: request.conversation_id,
    sessionEpoch: request.session_epoch,
    turnId: request.turn_id,
    acpRequestId: request.acp_request_id,
    title: request.title,
    toolCallId: request.tool_call_id ?? null,
    actionPreview: request.action_preview ?? null,
    options: request.options.map((option) => ({
      optionId: option.option_id,
      name: option.name,
      kind: option.kind,
    })),
    dispatchReceiptId: request.dispatch_receipt_id ?? null,
    toolKind: request.tool_kind ?? null,
    activityKind: request.activity_kind ?? null,
    toolName: request.tool_name ?? null,
    mcpServer: request.mcp_server ?? null,
    mcpTool: request.mcp_tool ?? null,
    commandToken: request.command_token ?? null,
    commandArgvPrefix: request.command_argv_prefix ?? [],
    path: request.path ?? null,
    domain: request.domain ?? null,
    write: request.write ?? null,
  };
}

function normalizeOffer(offer: RawPermissionOffer | null | undefined) {
  if (!offer) {
    return FAIL_CLOSED_OFFER;
  }
  return {
    once: offer.once,
    task: offer.task,
    alwaysHere: offer.alwaysHere ?? offer.always_here ?? false,
    deny: offer.deny,
    projectLabel: offer.projectLabel ?? offer.project_label ?? null,
    note: offer.note ?? null,
  };
}

/** Exported for tests: the pending shape the desktop hands the permission card. */
export function normalizePending(
  pending: RawPendingManagedPermission,
): PendingManagedPermission {
  return {
    pendingId: pending.pendingId,
    request: normalizeManagedPermissionRequest(pending.request),
    offer: normalizeOffer(pending.offer),
  };
}

export async function listPendingManagedPermissions(): Promise<
  PendingManagedPermission[]
> {
  const pending = await invokeTauri<RawPendingManagedPermission[]>(
    "list_pending_managed_permissions",
  );
  return pending.map(normalizePending);
}

/**
 * Answer one permission card. A V1 card sends the tense the owner chose and no
 * option id; the older capability card still names the exact runtime option.
 */
export async function resolveManagedPermission(
  pendingId: string,
  optionId?: string,
  tense?: ManagedPermissionTense,
): Promise<void> {
  await invokeTauri("resolve_managed_permission", {
    pendingId,
    optionId: optionId ?? null,
    tense: tense ?? null,
  });
}

export async function listenForManagedPermissionChanges(
  onChange: (resolution?: ManagedPermissionResolvedEvent) => void,
): Promise<UnlistenFn> {
  const unlistenPending = await listen("managed-permission-pending", () =>
    onChange(),
  );
  let unlistenResolved: UnlistenFn;
  try {
    unlistenResolved = await listen<ManagedPermissionResolvedEvent>(
      "managed-permission-resolved",
      (event) => onChange(event.payload),
    );
  } catch (error) {
    unlistenPending();
    throw error;
  }
  return () => {
    unlistenPending();
    unlistenResolved();
  };
}
