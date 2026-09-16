import type {
  CapabilityManagedPermissionRequest,
  PendingManagedPermission,
  PermissionOffer,
} from "@/shared/api/types";

/** Keep the renderer's durable option aligned with native fail-closed policy. */
export function canRememberCapabilityPermission(
  request: CapabilityManagedPermissionRequest,
): boolean {
  return (
    request.risk !== "high_impact" &&
    ![
      "external_communication",
      "destructive_action",
      "credential_use",
    ].includes(request.capability)
  );
}

/**
 * What this card is allowed to offer. The desktop decides it; a card that
 * arrives without an offer gets the fail-closed one — answer for this one
 * request or decline, and nothing is remembered.
 */
const FAIL_CLOSED_OFFER: PermissionOffer = {
  once: true,
  task: false,
  alwaysHere: false,
  deny: true,
  projectLabel: null,
  remembers: [],
  note: null,
};

export function runtimePermissionOffer(
  pending: PendingManagedPermission,
): PermissionOffer {
  return pending.offer ?? FAIL_CLOSED_OFFER;
}
