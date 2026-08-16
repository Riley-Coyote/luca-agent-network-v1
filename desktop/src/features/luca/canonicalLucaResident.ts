import type { ResidentRegistryEntry } from "./residents/api";

export const CANONICAL_LUCA_PERSONA_ID = "builtin:fizz";

/**
 * Resolve Luca's durable resident identity only when the owner registry has one
 * unambiguous canonical entry. Human-facing names and message copy are never
 * considered identity evidence.
 */
export function canonicalLucaResidentPubkey(
  residents: readonly ResidentRegistryEntry[] | undefined,
): string | null {
  const matches = (residents ?? []).filter(
    (resident) => resident.personaId === CANONICAL_LUCA_PERSONA_ID,
  );
  return matches.length === 1 ? matches[0].residentPubkey.toLowerCase() : null;
}
