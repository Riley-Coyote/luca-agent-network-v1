# F09 Exact Relay Idempotency Amendment — 2026-07-30

Status: approved security and compatibility correction

## Problem

F09 freezes one exact resident-signed kind-9 event before relay I/O and must
reuse those bytes after response loss. The original amendment assumed that an
access-filtered `POST /query` by event ID was an authoritative acceptance
oracle. It is not:

- current relay or channel membership can hide a previously accepted event;
- an exact event that was never accepted becomes too old for Buzz's 15-minute
  freshness gate;
- re-signing a fresh timestamp would violate the frozen at-most-once identity
  contract.

Desktop code therefore cannot distinguish "accepted but no longer readable"
from "never accepted" using `/query` alone.

## Decision

Buzz's existing `POST /events` bridge is the authoritative exact-event
idempotency oracle. No endpoint or database schema is added. A closed
`?mode=probe` query selects probe mode:

- exact stored match: return the existing successful duplicate acknowledgment;
- absent event: return a constant not-present result and perform no ingest;
- corrupt, ambiguous, colliding, or nonexact storage: fail closed.

The query is part of the exact URL in the fresh NIP-98 `u` tag, while the
payload tag binds the exact submitted body; an intermediary cannot switch an
authorized probe into an ingesting request. Unknown or repeated query
parameters fail closed. Without probe mode, an exact stored match receives the same early duplicate
acknowledgment and an absent event continues through the ordinary ingest path.

After host-derived tenant binding, fresh NIP-98 verification, HTTP admission,
NIP-98 replay protection, strict event parsing, event ID/signature validation,
and proof that the NIP-98 signer is the event author, the relay may acknowledge
an already-stored exact kind-9 event before current relay membership, channel
membership, or freshness checks only when all of these hold:

1. the lookup is scoped to the host-bound community;
2. the stored event ID equals the submitted event ID;
3. the stored author equals the authenticated NIP-98 signer;
4. every reconstructed Nostr event field is structurally equal;
5. canonical stored bytes equal the submitted canonical event bytes.

The fresh NIP-98 authorization must contain a payload tag bound to the exact
submitted HTTP body. The strict database lookup distinguishes absence from
corrupt or ambiguous storage and fails closed on the latter. "Exact" means
equality of every canonical signed Nostr event field, including the signature;
raw JSON whitespace and object-key order are not Nostr event identity.

The response is the existing successful duplicate shape with the same event ID.
It reveals no content or event not already supplied and signed by that author.
An absent, noncanonical, differently authored, or nonexact event receives no
early acknowledgment and continues through all existing membership, freshness,
channel, and ingest policy. An ID collision with nonexact bytes fails closed.
The acknowledgment performs no insert, resurrection, fan-out, thread-counter
update, search write, owner materialization, or other ingest side effect; it
emits only the existing duplicate conformance trace.

Desktop reconciliation exact-resubmits the retained bytes. It does not use an
access-filtered query as proof of absence and never re-signs a new final. It
first uses probe mode. Only an active, noncancelled dispatch whose probe proves
absence may make the ordinary ingesting request.

## Cancellation and durable recovery

- Relay acceptance is the publication linearization boundary.
- A cancellation that persists before proven relay acceptance must be honored.
  For an ambiguously submitted row, probe mode decides the race: exact presence
  becomes Published; proven absence becomes Cancelled and is never resubmitted.
- Prepared cancelled work publishes nothing. Submission and cancellation are
  serialized so cancellation cannot persist immediately before an ingesting
  request that ignores it.
- Cancelled, rejected, and published dispatch/outbox halves use durable
  cross-store finalization before either half becomes retention-eligible.
- Expired unbound pending dispatches are retention-eligible; active or submitted
  authority is not.
- A bounded periodic broker tick reconciles encrypted outbox work even when ACP
  produces no additional frames.

The oracle uses a purpose-specific, tenant-scoped strict database read that
fetches at most two rows including tombstones and fails closed on duplicate IDs
or corrupt event reconstruction. It does not reuse a convenience lookup that
collapses corrupt rows into absence. This requires no schema change.

## Narrow ownership

F09 additionally owns:

- `crates/buzz-relay/src/api/bridge.rs`
- `crates/buzz-db/src/event.rs`
- `crates/buzz-db/src/lib.rs`
- `crates/buzz-test-client/tests/e2e_relay.rs`
- `desktop/src-tauri/src/luca/signing_transport.rs`
- `desktop/src-tauri/src/managed_agents/types.rs`
- `desktop/src-tauri/src/managed_agents/runtime/tests.rs`

`crates/buzz-relay/src/handlers/ingest.rs` may be edited only if a small shared
exact-event validation helper is demonstrably required. Prefer keeping the
branch in `api/bridge.rs`. Database ownership is limited to the strict
idempotency read and its tests. No migration, generic authorization change, new
endpoint, event kind, query bypass, or unrelated relay behavior is authorized.
Desktop transport/type/test ownership is limited to a timed single-owner broker
event loop plus a private shutdown/join handle that prevents two brokers from
mutating one resident outbox.

## Required proofs

- exact stored kind-9 retry succeeds after the freshness window;
- exact stored kind-9 retry succeeds after current relay/channel membership is
  removed;
- probe mode reports an absent exact event without inserting or fanning it out;
- a cancelled ambiguously submitted row probes exact presence, records
  Published if present, and records Cancelled without resubmission if absent;
- absent stale event remains rejected;
- absent event from a removed member remains rejected;
- same ID with any nonexact field or canonical byte difference fails closed;
- corrupt or ambiguous stored rows fail closed rather than becoming "absent";
- another authenticated key cannot probe or acknowledge the event;
- NIP-98 without an exact payload binding cannot use the oracle;
- soft-deleted exact history acknowledges without resurrection or fan-out;
- the same event in another tenant is not acknowledged;
- fresh ordinary `/events` behavior remains membership/freshness gated;
- desktop reconciliation uses exact `/events` replay and never `/query` as an
  absence oracle;
- periodic idle reconciliation, cancellation linearization, terminal
  cross-store crash recovery, and bounded retention have executable tests.
- partial-frame trickle cannot starve periodic reconciliation; every serve-loop
  exit invalidates the broker session; runtime replacement joins the old broker
  before a new outbox owner starts.
