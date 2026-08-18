import { useEffect, useSyncExternalStore } from "react";

import type { TimelineMessage } from "@/features/messages/types";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { ResidentRegistryEntry } from "./residents/api";
import { useLucaResidentsQuery } from "./residents/hooks";

export const CANONICAL_LUCA_PERSONA_ID = "builtin:fizz";

/**
 * Luca's identity glyph is the same for every owner. Luca is the resident
 * concierge of the application — the mark at the heart of the doorway's field
 * and the mark in the first conversation are one mark, wherever Polyphonic is
 * running — so the glyph is seeded from this constant rather than from the
 * per-install resident key. Each owner still shapes Luca's behaviour freely.
 */
export const LUCA_IDENTITY_SEED =
  "9dee6768a16dc99a2f399672eabffe3d1c2d30cd9daaeda8ae0c36074751b9f2";

/** The once-only greeting Luca publishes when the owner arrives. */
export const LUCA_GREETING_MARKER = "polyphonic-onboarding.luca-greeting.v1";
/** The line under Luca's name at the threshold of the owner's DM with Luca. */
export const LUCA_INTRO_ROLE = "Resident concierge";

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

// ---- who is Luca right now -------------------------------------------------
// Identity marks are drawn in many places that know only a public key. Rather
// than threading the persona through every caller, the resolved canonical Luca
// pubkey is kept here, and the mark renderers ask for it.

let canonicalLucaPubkey: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readCanonicalLucaPubkey(): string | null {
  return canonicalLucaPubkey;
}

export function setCanonicalLucaPubkey(pubkey: string | null) {
  const next = pubkey ? normalizePubkey(pubkey) : null;
  if (next === canonicalLucaPubkey) return;
  canonicalLucaPubkey = next;
  for (const listener of listeners) listener();
}

export function useCanonicalLucaPubkey(): string | null {
  return useSyncExternalStore(subscribe, readCanonicalLucaPubkey, () => null);
}

/** Mount once, high in the app: keeps the resolved Luca pubkey current. */
export function useRegisterCanonicalLuca() {
  const residents = useLucaResidentsQuery();
  const pubkey = canonicalLucaResidentPubkey(residents.data?.residents);
  useEffect(() => {
    if (residents.data) setCanonicalLucaPubkey(pubkey);
  }, [pubkey, residents.data]);
}

/**
 * The seed a resident's identity glyph is drawn from: Luca's fixed seed for
 * the canonical resident, the public key for everyone else.
 */
export function residentGlyphSeed(
  publicKey: string,
  lucaPubkey: string | null = readCanonicalLucaPubkey(),
): string {
  const key = normalizePubkey(publicKey);
  return lucaPubkey && key === lucaPubkey ? LUCA_IDENTITY_SEED : key;
}

// ---- the owner ⇄ Luca conversation ----------------------------------------

export function hasClientMarker(message: TimelineMessage, marker: string) {
  return message.tags?.some((tag) => tag[0] === "client" && tag[1] === marker);
}

export function isCanonicalLucaDm(
  channel: Channel | null,
  ownerPubkey: string | undefined,
  lucaPubkey: string | null,
) {
  if (channel?.channelType !== "dm" || !ownerPubkey || !lucaPubkey)
    return false;
  const participants = new Set(
    channel.participantPubkeys.map((pubkey) => normalizePubkey(pubkey)),
  );
  return (
    participants.size === 2 &&
    participants.has(normalizePubkey(ownerPubkey)) &&
    participants.has(lucaPubkey)
  );
}

export function isLucaGreeting(message: TimelineMessage, lucaPubkey: string) {
  return (
    message.depth === 0 &&
    normalizePubkey(message.signerPubkey ?? "") === lucaPubkey &&
    hasClientMarker(message, LUCA_GREETING_MARKER)
  );
}

/** True until the owner has said anything at all in this conversation. */
export function ownerHasSpoken(
  messages: readonly TimelineMessage[],
  ownerPubkey: string,
) {
  const owner = normalizePubkey(ownerPubkey);
  return messages.some(
    (message) =>
      message.depth === 0 &&
      !message.pending &&
      normalizePubkey(message.pubkey ?? "") === owner,
  );
}
