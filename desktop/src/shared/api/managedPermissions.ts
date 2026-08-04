import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";
import type {
  ManagedPermissionRequest,
  PendingManagedPermission,
} from "@/shared/api/types";

type RawManagedPermissionRequest = {
  protocol: "luca.managed.permission.v1";
  resident_pubkey: string;
  conversation_id: string;
  session_epoch: number;
  turn_id: string;
  acp_request_id: string;
  title: string;
  tool_call_id?: string | null;
  options: Array<{ option_id: string; name: string; kind: string }>;
};

type RawPendingManagedPermission = {
  pendingId: string;
  request: RawManagedPermissionRequest;
};

function normalizeRequest(
  request: RawManagedPermissionRequest,
): ManagedPermissionRequest {
  return {
    protocol: request.protocol,
    residentPubkey: request.resident_pubkey,
    conversationId: request.conversation_id,
    sessionEpoch: request.session_epoch,
    turnId: request.turn_id,
    acpRequestId: request.acp_request_id,
    title: request.title,
    toolCallId: request.tool_call_id ?? null,
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
    request: normalizeRequest(pending.request),
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
  onChange: () => void,
): Promise<UnlistenFn> {
  const unlistenPending = await listen("managed-permission-pending", onChange);
  let unlistenResolved: UnlistenFn;
  try {
    unlistenResolved = await listen("managed-permission-resolved", onChange);
  } catch (error) {
    unlistenPending();
    throw error;
  }
  return () => {
    unlistenPending();
    unlistenResolved();
  };
}
