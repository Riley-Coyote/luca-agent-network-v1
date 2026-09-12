/**
 * Actually check the signatures the provenance surface displays.
 *
 * Showing a `sig` field without verifying it is decoration: it looks like
 * proof and carries none. Every record here is checked twice — the event id
 * must be the hash of its own serialised contents (so the body cannot have
 * been edited under a valid signature), and the signature must verify against
 * the author's key.
 *
 * Verification is deliberately three-valued. "Unverifiable" is not a failure:
 * a record can reach the UI without checkable cryptography (a malformed
 * signature, an id that was never a hash) and saying so plainly is more honest
 * than either a green tick or a red alarm.
 */

import { getEventHash, verifyEvent } from "nostr-tools/pure";

import type { RelayEvent } from "@/shared/api/types";

export type VerificationStatus = "verified" | "failed" | "unverifiable";

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

/** Results are immutable per event id, so one check per record is enough. */
const cache = new Map<string, VerificationStatus>();

function shapeIsCheckable(event: RelayEvent): boolean {
  return (
    HEX_64.test(event.id.toLowerCase()) &&
    HEX_64.test(event.pubkey.toLowerCase()) &&
    HEX_128.test(event.sig?.toLowerCase() ?? "")
  );
}

/**
 * Verify one record, memoised by event id.
 *
 * Two independent checks, in this order:
 *
 * 1. the id must equal the hash of the event's own fields, so a body edited
 *    after signing cannot ride along under a valid signature;
 * 2. the schnorr signature must verify against the author's key.
 *
 * The event is rebuilt from its fields before either check rather than passed
 * through as-is. `nostr-tools` memoises a passing result on the object itself
 * (`verifiedSymbol`), and that marker survives an object spread — so handing
 * it a copy of an already-verified event returns `true` without re-checking,
 * even when the copy's content has been changed. A verifier that trusts that
 * cache is not a verifier. Proven by the tamper cases in the sibling test.
 */
export function verifyProvenanceEvent(event: RelayEvent): VerificationStatus {
  const cached = cache.get(event.id);
  if (cached) return cached;

  let status: VerificationStatus;
  if (!shapeIsCheckable(event)) {
    status = "unverifiable";
  } else {
    const clean = {
      content: event.content,
      created_at: event.created_at,
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      sig: event.sig,
      tags: event.tags,
    };

    try {
      status =
        getEventHash(clean) === clean.id && verifyEvent(clean)
          ? "verified"
          : "failed";
    } catch {
      // A malformed key or curve point that survived the shape check still
      // means "we could not check this", not "this is forged".
      status = "unverifiable";
    }
  }

  cache.set(event.id, status);
  return status;
}

export function resetProvenanceVerificationCache(): void {
  cache.clear();
}

export type VerificationTally = {
  verified: number;
  failed: number;
  unverifiable: number;
};

export function tallyVerifications(
  events: RelayEvent[],
): VerificationTally {
  const tally: VerificationTally = {
    verified: 0,
    failed: 0,
    unverifiable: 0,
  };
  for (const event of events) {
    tally[verifyProvenanceEvent(event)] += 1;
  }
  return tally;
}
