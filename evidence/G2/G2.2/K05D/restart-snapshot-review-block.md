# K05D restart snapshot review — repair ceiling reached

Status: BLOCK. The pure snapshot implementation passes all focused checks, but
the independent adversarial review found restart-authority defects that prevent
desktop persistence from safely building on this interface.

## Passing evidence

- all 65 `luca-continuity` tests pass;
- strict Clippy with warnings denied passes;
- formatting and scoped diff checks pass;
- snapshot replay persists domain-separated digests and typed body-free
  bindings/receipts, never successor ciphertext;
- exact historical replay is zero-write and binds the original entry version;
- purge state, record/nonce tombstones, lifecycle, pinning, lineage, unknown
  field, deterministic round-trip, and fingerprint checks are present.

## Blocking findings

1. Retained active or archived envelopes cannot hydrate after authenticated
   rotation. Historical bindings may retain their original version, but the
   validator still requires their old nonce and encrypted-record reference to
   equal the re-encrypted retained record. Rotation necessarily changes those
   fields.
2. Artifact deletion authority is ambiguous across lineages. The same live
   artifact reference can be registered in multiple lineages, while completed
   purge creates a globally keyed tombstone. Hydration does not reject that
   tombstoned reference remaining live elsewhere.
3. Aggregate allocation bounds are incomplete. Nested membership, tombstone,
   replay receipt, and purge-plan collections can exceed the intended total
   before the final canonical-byte check runs.
4. Historical artifact receipts do not prove the exact ordered inventory
   transition. A malformed snapshot can repeat a newly-registered artifact or
   let an older receipt claim an artifact introduced later.
5. Live mutation paths do not explicitly reject a key already present in the
   opposite idempotency domain. Hydration rejects overlap and the domain hashes
   are distinct, but the mutation contract should fail explicitly.

## Required next repair

- add an authenticated replacement mapping for retained-envelope rotation, or
  compare the original envelope only when its version is unchanged;
- make artifact authority lineage-scoped or enforce global live uniqueness in
  both mutation and hydration;
- enforce aggregate collection and replay-receipt bounds before allocation,
  including a bounded serialized snapshot decoding entrypoint;
- validate historical artifact inventory as an exact ordered transition;
- reject opposite-domain idempotency keys on both live mutation paths;
- add focused active/archived rotation, cross-lineage artifact, aggregate cap,
  ordered-receipt, and cross-domain mutation tests.

No K05D, A209, K06, or G2.2 pass claim is authorized. K05D already consumed
its planned repair, so this additional security repair requires Riley's
explicit approval under the G2 control rules.
