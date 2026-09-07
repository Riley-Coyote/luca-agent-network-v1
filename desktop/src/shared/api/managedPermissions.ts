import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";
import type {
  ManagedPermissionRequest,
  ManagedPermissionResolvedEvent,
  PendingManagedPermission,
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
  };
}

function normalizePending(
  pending: RawPendingManagedPermission,
): PendingManagedPermission {
  return {
    pendingId: pending.pendingId,
    request: normalizeManagedPermissionRequest(pending.request),
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

export async function resolveManagedPermission(
  pendingId: string,
  optionId?: string,
): Promise<void> {
  await invokeTauri("resolve_managed_permission", {
    pendingId,
    optionId: optionId ?? null,
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
