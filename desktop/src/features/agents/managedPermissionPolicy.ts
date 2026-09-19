import type {
  CapabilityManagedPermissionRequest,
  ManagedPermissionTense,
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

/** One button on an unstructured (v1) permission card. */
export type VisiblePermissionTense = "deny" | "once" | "always";

/** The wire tense each visible button actually sends when pressed. */
export const PERMISSION_TENSE_WIRE_VALUE: Record<
  VisiblePermissionTense,
  ManagedPermissionTense
> = {
  deny: "deny",
  once: "once",
  always: "always_here",
};

/**
 * Which buttons an unstructured permission card shows, in the fixed visual
 * order Deny · Once · Always (beta.13 P3) — doors included, since a door
 * offers the very same three buttons as anything else once it can be
 * remembered.
 *
 * "For this task" is retired from the card entirely: the ledger never sets
 * `offer.task`, and this never reads it, so a stray `task: true` on an old or
 * malformed payload can never resurrect the fourth button.
 */
export function visiblePermissionTenses(
  offer: PermissionOffer,
): VisiblePermissionTense[] {
  const tenses: VisiblePermissionTense[] = [];
  if (offer.deny) tenses.push("deny");
  if (offer.once) tenses.push("once");
  if (offer.alwaysHere) tenses.push("always");
  return tenses;
}
