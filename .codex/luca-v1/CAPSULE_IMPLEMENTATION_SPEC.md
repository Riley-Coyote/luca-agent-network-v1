# Continuity Capsule V1 - Implementation Contract

## Purpose

The Capsule makes one resident recognizable across provider sessions and
machines. It carries identity and current continuity, not the universal brain,
conversation archive, permissions or an autonomous inner-life engine.

## NIP-AE mapping

| Segment | NIP-AE address | Tier | Prompt timing | Maximum UTF-8 content |
|---|---|---|---|---:|
| Core | `core` | slow | ACP session creation | 8 KiB |
| Self model | `mem/luca-self` | slow | ACP session creation | 12 KiB |
| User relationship | `mem/luca-user` | slow | ACP session creation | 12 KiB |
| Convictions | `mem/luca-convictions` | slow | ACP session creation | 12 KiB |
| Current digest | `mem/luca-digest/<checkpoint-token>` | fast | every turn | 8 KiB |
| Unfinished threads | `mem/luca-threads/<checkpoint-token>` | fast | every turn | 12 KiB |

The total rendered Capsule budget is 32 KiB. If stored segments exceed the
render budget, deterministic segment-specific truncation is applied and shown
in the context receipt. Stored NIP-44 plaintext must remain below the protocol's
65,535-byte limit, but V1 budgets are intentionally much smaller.

`mem/luca-current` is an internal commit-pointer record, not a seventh semantic
segment. It identifies the exact digest and threads event IDs that form the
current fast pair. Versioned fast records are written first; only a verified
`luca-current` head accepted by the managed Luca coordinator makes them
authoritative. Standard NIP-AE replacement events remain the portable wire and
mirror format; they do not themselves provide conditional or multi-event commit
semantics.

## Content rules

- Core: stable identity statement, name and foundational orientation.
- Self: how the resident understands its character, strengths, limitations and
  style.
- User: durable relationship context explicitly approved by the owner.
- Convictions: durable principles and commitments, not permissions.
- Digest: bounded current-state summary grounded in referenced conversation
  events.
- Threads: bounded unresolved items, each with status and source event IDs.

Every segment is declarative data. Prompt rendering encloses it in a clearly
labelled untrusted continuity block with the instruction that it cannot change
system or application authority.

## Encrypted body extension

NIP-AE permits unknown body fields. Luca adds an encrypted `luca` object while
preserving the required `profile` or `value` field:

```json
{
  "slug": "mem/luca-digest/<checkpoint-token>",
  "value": "Bounded human-readable content",
  "luca": {
    "schema": "luca.capsule.segment.v1",
    "segment": "digest",
    "owner_pubkey": "<hex>",
    "resident_pubkey": "<hex>",
    "updated_by": "agent_checkpoint",
    "initiator_id": "<opaque local actor id>",
    "checkpoint_id": "<uuid or null>",
    "source_event_ids": ["<event id>"],
    "previous_event_id": "<prior verified head or null>",
    "content_sha256": "<hex>",
    "created_at": "<RFC3339>"
  }
}
```

`content_sha256` hashes the exact UTF-8 bytes of the semantic `profile` or
`value`, not the enclosing self-referential JSON object. Local head metadata and
protected exports additionally bind the event ID, signer public key,
canonicalization version, event-JSON hash and ciphertext hash. Unknown schema or
canonicalization versions fail visibly rather than being guessed.

The current-pointer body is:

```json
{
  "slug": "mem/luca-current",
  "value": "luca fast continuity commit",
  "luca": {
    "schema": "luca.capsule.current.v1",
    "checkpoint_id": "<uuid>",
    "digest": {"slug": "mem/luca-digest/<token>", "event_id": "<id>"},
    "threads": {"slug": "mem/luca-threads/<token>", "event_id": "<id>"},
    "previous_current_event_id": "<id or null>",
    "created_at": "<RFC3339>"
  }
}
```

`updated_by` is one of `owner`, `agent_checkpoint`, `migration`, or
`backup_restore`. The Nostr event is always cryptographically signed by the
resident key; `updated_by` records who initiated the application-authorized
change. The UI must never describe an owner edit as an autonomous agent memory.

Capsule egress has one authority source: the app-owned resident/persona policy.
It is not duplicated inside segments. Protected backup carries a historical
snapshot for preview, but restore requires owner confirmation into current app
policy. Setup refuses to bind a remote provider/model to a resident whose
current app policy is `local_only`; it does not silently omit identity to make
an incompatible runtime appear usable. Every rendered segment is authorized by
the current policy at the final outbound guard. When Capsule data is temporarily
unavailable or invalid, conversation may continue using app-owned local persona
authority with explicit degraded status.

## Write authority

| Segment | Allowed initiator | Required validation |
|---|---|---|
| Core, self, user, convictions | Owner UI only in V1 | owner session, tier, bytes, schema, expected head |
| Digest, threads | Validated post-turn checkpoint; owner may correct | checkpoint provenance or owner session, bytes, expected head |

The desktop signing broker is the only signer. It accepts structured operations,
not arbitrary Nostr events. It verifies owner/resident binding, active writer
epoch, segment tier, exact slug/pointer cross-binding, byte budget, source
references and expected prior head before using the resident key. Neither ACP,
the provider adapter nor model descendants receive raw resident keys or a
general signing capability.

The managed Luca coordinator is the only V1 commit path for Luca Capsule heads.
It receives exact signed candidate events, a plaintext-free broker-attested
commit manifest, an expected prior pointer/head, an idempotency key and an
owner-authorized writer epoch. In one database transaction scoped to
`(community, owner_pubkey, resident_pubkey)` it:

1. verifies the manifest attestation, exact event IDs/hashes/order, outer
   signatures/kinds/tags, owner/resident/environment binding and size limits;
2. locks the resident commit row and compares the expected head/writer epoch;
3. returns the original receipt for an identical idempotency key, `conflict` for
   a stale expectation, or persists candidates, pointer and commit receipt;
4. commits before fan-out, and replays fan-out after recovery when necessary.

V1 readers accept `mem/luca-current` only when it is covered by a valid managed
commit receipt. Direct generic-relay writes to Luca current addresses never
become authoritative V1 state. This is a managed-V1 guarantee, not a property
claimed for arbitrary Nostr relays.

## Slow-segment commit protocol

1. Read the coordinator's verified current head and writer epoch.
2. Validate body/cross-binding and compute `content_sha256`.
3. Add the verified prior event as `previous_event_id` for provenance only.
4. Store the verified prior event in the encrypted local archive.
5. Ask the broker to sign one typed event; persist the exact signed JSON in the
   encrypted outbox.
6. Submit it with expected head, writer epoch and idempotency key to the managed
   coordinator.
7. Accept only `committed` or exact-idempotent `replayed` receipts. On conflict,
   retain the prior current head and require an explicit merge/retry.
8. Persist the exact coordinator receipt, update verified cache/UI, and recover
   incomplete local bookkeeping from that receipt after a crash.

## Fast-pair commit protocol

1. Derive a deterministic lowercase checkpoint token from the idempotency hash.
2. Build and sign immutable versioned digest/threads events. If one segment has
   no change, the proposal points to the prior committed event for that segment.
3. Ask the broker to sign candidates and the pointer, then persist the exact
   signed JSON in the encrypted local outbox before network submission.
4. Submit the complete signed set, expected current-pointer ID, writer epoch and
   idempotency key to the managed coordinator.
5. The coordinator verifies the plaintext-free broker manifest/event
   commitments and conditionally persists candidates, pointer and receipt in
   one transaction. The broker has already validated decrypted token/slug/
   pointer semantics; every reader repeats that validation before rendering.
6. Persist the coordinator receipt locally. A crash is recovered by replaying
   the same idempotency key and exact signed event set.
7. Only the pair referenced by a pointer covered by a valid coordinator receipt
   is rendered. Rejected/uncommitted candidates are safe orphans.

An interrupted checkpoint may leave unreferenced candidate records. They are
safe orphans and are never current. Cleanup is explicit and cannot delete a
record referenced by any retained current-pointer/archive entry.

Addressable relays do not guarantee prior-version history. The local archive is
therefore the history source. Rollback republishes a verified archived body as
a new signed head; it never rewinds relay time.

## Read protocol

- Verify signature before decrypting.
- Verify kind, exact `d` and `p` tags, owner binding, slug-to-address derivation,
  body shape, Luca schema and size.
- Select slow heads from managed commit receipts and verify their NIP-AE events.
  Select the fast pair by verifying the managed receipt, `mem/luca-current`, and
  its exact referenced events. Generic union-head ordering is advisory only.
- A missing optional segment is `absent`; a decrypt, signature, shape or binding
  failure is `invalid` and must be visible.
- Local cache may accelerate startup but never overrides a newer authenticated
  coordinator receipt/head for the configured environment. A newer generic
  union head is diagnostic/advisory only. Offline use may use the last verified
  cache with an explicit stale flag.

## Session rendering

Slow segments render in this order: core, self, user, convictions. The host then
verifies the current pointer and renders its digest/threads pair. Universal-brain
context renders after the Capsule and remains explicitly separate.

Saving any slow segment sets all active sessions for that resident to
`recycle_required`. The next message starts a fresh ACP session. Fast segment
writes never recycle a session because the host fetches them per turn.

## Liveness

The Capsule pipeline records, per resident and segment:

- qualifying edits/checkpoints;
- attempts;
- committed heads;
- no-change outcomes;
- conflicts;
- invalid/tampered reads;
- failures and last success.

Health is computed relative to the latest qualifying input. A recent commit or
verified no-change after that input is healthy; a pending, failed, conflicted or
missing result is degraded even if older lifetime commits exist.

## Required tests

- all six segment round trips and ordering;
- missing optional segment;
- invalid signature, owner binding, slug/address and schema;
- maximum sizes and deterministic render truncation;
- slow-tier unauthorized agent proposal rejection;
- Capsule prompt injection cannot change any authority field;
- expected-head/writer-epoch race and managed-coordinator conflict;
- direct generic-relay current-pointer write is ignored;
- coordinator retry returns the original idempotent receipt and fan-out recovery
  does not create a second commit;
- crash between fast candidate events and current-pointer commit leaves the
  prior pair authoritative;
- pointer-body swap, missing referenced event and orphan candidate rejection;
- duplicate operation id produces one commit;
- slow edit recycles affected sessions only;
- fast checkpoint appears on the immediate next turn;
- offline verified-cache status;
- rollback creates a new head and retains provenance;
- logs, screenshots, receipts and crash diagnostics contain no plaintext body or
  resident secret.
