import { normalizePubkey } from "@/shared/lib/pubkey";

/** Undefined preserves ordinary mention behavior; fixed recipients never expand. */
export function resolveFixedAudience(
  pubkeys: readonly string[] | undefined,
): string[] | undefined {
  if (pubkeys === undefined) return undefined;
  const normalized = [...new Set(pubkeys.map(normalizePubkey))];
  if (
    !normalized.length ||
    normalized.some((key) => !/^[0-9a-f]{64}$/.test(key))
  )
    throw new Error("Choose a valid fixed recipient before sending.");
  return normalized;
}
