import type { Community } from "@/features/communities/types";

/** The relay tenancy is an implementation detail in Luca V1. */
export const PERSONAL_HOME_TENANCY_ID = "luca-personal-home";
export const PERSONAL_HOME_TENANCY_NAME = "Luca";
export const PERSONAL_HOME_TENANCY_STORAGE_KEY =
  "luca-personal-home-tenancy.v1";

export function createPersonalHomeTenancy(
  relayUrl: string,
  ownerPubkey: string,
  now = new Date(),
): Community {
  return {
    id: PERSONAL_HOME_TENANCY_ID,
    name: PERSONAL_HOME_TENANCY_NAME,
    relayUrl,
    pubkey: ownerPubkey,
    addedAt: now.toISOString(),
  };
}

export function readPersonalHomeTenancyId(
  storage: Storage = localStorage,
): string | null {
  const value = storage.getItem(PERSONAL_HOME_TENANCY_STORAGE_KEY);
  return value?.trim() || null;
}

export function persistPersonalHomeTenancyId(
  id: string,
  storage: Storage = localStorage,
): void {
  storage.setItem(PERSONAL_HOME_TENANCY_STORAGE_KEY, id);
}

/**
 * A prior Luca marker wins. The deterministic ID migrates pre-marker personal
 * homes without treating the active legacy community as the Luca home.
 */
export function resolvePersonalHomeTenancyId(
  communities: readonly Community[],
  recordedId: string | null,
): string | null {
  if (
    recordedId &&
    communities.some((community) => community.id === recordedId)
  ) {
    return recordedId;
  }
  return communities.some(
    (community) => community.id === PERSONAL_HOME_TENANCY_ID,
  )
    ? PERSONAL_HOME_TENANCY_ID
    : null;
}

export function isPersonalHomeTenancy(
  community: Community | null,
  storage: Storage = localStorage,
): boolean {
  if (!community) return false;
  return (
    community.id === PERSONAL_HOME_TENANCY_ID ||
    community.id === readPersonalHomeTenancyId(storage)
  );
}
