import type { Community } from "@/features/communities/types";

/** The relay tenancy is an implementation detail in Luca V1. */
export const PERSONAL_HOME_TENANCY_ID = "luca-personal-home";
export const PERSONAL_HOME_TENANCY_NAME = "Luca";

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

export function isPersonalHomeTenancy(community: Community | null): boolean {
  return community?.id === PERSONAL_HOME_TENANCY_ID;
}
