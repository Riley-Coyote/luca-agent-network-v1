import {
  CANONICAL_LUCA_PERSONA_ID,
  canonicalLucaResidentPubkey,
} from "@/features/luca/canonicalLucaResident";
import type { ResidentRegistryEntry } from "@/features/luca/residents/api";

/** A saved selection cannot bypass the registry's primary-resident identity. */
export function resolveQuickChatSelection(
  registry: readonly ResidentRegistryEntry[] | undefined,
  available: readonly { pubkey: string }[],
  saved: string | null,
) {
  const primaryPubkey = canonicalLucaResidentPubkey(registry);
  const ambiguous =
    (registry?.filter((r) => r.personaId === CANONICAL_LUCA_PERSONA_ID)
      .length ?? 0) > 1;
  const selectedPubkey =
    !registry || ambiguous
      ? null
      : available.some((r) => r.pubkey === saved)
        ? saved
        : primaryPubkey;
  return { primaryPubkey, selectedPubkey, ambiguous };
}
