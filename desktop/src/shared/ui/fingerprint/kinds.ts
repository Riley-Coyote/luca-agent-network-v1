import { residentGlyphSeed } from "@/features/luca/canonicalLucaResident";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { FINGERPRINT_KINDS, type FingerprintKind } from "./growth";

/** 32-bit FNV-1a over a string's characters (the study's `seeds.py`). */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Whose print: FNV-1a of the resident's glyph seed, so Luca's comes from
 * Luca's fixed seed (the same for every owner) and every other agent's from
 * its key. A model or runtime change never touches it.
 */
export function fingerprintSeed(
  publicKey: string,
  lucaPubkey?: string | null,
): number {
  return fnv1a(
    lucaPubkey === undefined
      ? residentGlyphSeed(publicKey)
      : residentGlyphSeed(publicKey, lucaPubkey),
  );
}

/** A print's kind when nothing else is known: its seed's own. */
export function kindFromSeed(seed: number): FingerprintKind {
  return FINGERPRINT_KINDS[seed % FINGERPRINT_KINDS.length];
}

export type FingerprintResident = {
  publicKey: string;
  /** When the agent arrived: an ISO date or epoch milliseconds. */
  arrivedAt?: string | number | null;
};

function arrival(value: FingerprintResident["arrivedAt"]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Each of the owner's agents' kind, keyed by its normalized key. Taken in
 * order, Luca first and then by arrival, a later agent steps past a kind an
 * earlier one holds, so the first five differ; past five, kinds repeat (each
 * its seed's own), though a print never does.
 */
export function assignFingerprintKinds(
  residents: readonly FingerprintResident[],
  lucaPubkey: string | null,
): Map<string, FingerprintKind> {
  const luca = lucaPubkey ? normalizePubkey(lucaPubkey) : null;
  const seen = new Set<string>();
  const order = residents
    .map((resident, index) => ({
      key: normalizePubkey(resident.publicKey),
      at: arrival(resident.arrivedAt),
      index,
    }))
    .filter((resident) => {
      if (!resident.key || seen.has(resident.key)) return false;
      seen.add(resident.key);
      return true;
    })
    .sort((a, b) => {
      if (a.key === luca) return -1;
      if (b.key === luca) return 1;
      return a.at - b.at || a.index - b.index;
    });
  const taken = new Set<number>();
  const kinds = new Map<string, FingerprintKind>();
  for (const { key } of order) {
    const seed = fingerprintSeed(key, luca);
    let j = seed % FINGERPRINT_KINDS.length;
    if (taken.size < FINGERPRINT_KINDS.length) {
      while (taken.has(j)) j = (j + 1) % FINGERPRINT_KINDS.length;
      taken.add(j);
    }
    kinds.set(key, FINGERPRINT_KINDS[j]);
  }
  return kinds;
}
