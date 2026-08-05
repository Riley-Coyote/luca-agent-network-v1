# K05D restart, hydration, and CAS contract

Status: implementation-ready read-only contract. This extends the active-head
projection into the complete state required to preserve K05 semantics after a
desktop restart.

## Complete pure snapshot

`RevisionLedgerSnapshotV1` contains deterministic, bounded, sorted records,
lineages, and every idempotency entry.

Each lineage snapshot contains:

- namespace and exact scope/source binding;
- root and explicit ordered record membership;
- exact retained lineage head and active-or-absent retrieval head;
- explicit lifecycle and pinned owner-correction state;
- record type and lineage envelope key version;
- exact sorted derived-artifact inventory;
- latest authority-mutation idempotency key.

Every retained encrypted `ContinuityRecordV1` is sorted by record ID. Archived
lineages retain their full history. A forgotten lineage may omit physically
purged envelopes only when explicit body-free membership and terminal purge
authority remain.

Every idempotency entry persists the key, exact canonical request bytes, and
original `RevisionReceipt`, sorted by key. Persisting only the newest key is
insufficient because replay of any historical operation must return its
original receipt without writing.

## Required pure APIs

- `export_snapshot() -> Result<RevisionLedgerSnapshotV1, ContinuityError>`;
- `from_snapshot(snapshot) -> Result<RevisionLedger, ContinuityError>`, which
  validates into a new ledger and never partially mutates an existing one;
- optional canonical snapshot fingerprint for desktop CAS/audit binding.

A safe first desktop transition can hydrate a temporary ledger, apply the
request, export the candidate, atomically CAS-persist it, and swap process state
only after commit. A crash after database commit is resolved by normal restart
hydration.

## Hydration validation

- enforce schema and aggregate/per-field bounds before large allocation;
- require stable sorted unique IDs, keys, and artifacts;
- validate every namespace, scope, envelope, AAD, durable type, and version;
- require global record-ID uniqueness and namespace/key-version/nonce
  uniqueness;
- require explicit lineage membership and validate its root/revision/
  predecessor chain against persisted authority without using it to choose a
  head;
- require retained head membership; active means active head equals retained
  head, while archived/forgotten means active head is absent;
- require pinned correction, artifacts, scope, type, and lineage envelope
  version to match the authority row;
- require the latest authority key to resolve to an idempotency entry whose
  receipt agrees with current root/lifecycle/head;
- validate every idempotency key against its domain-derived canonical request
  and receipt;
- reject extra records, missing members, cross-lineage membership, stale or
  mixed versions, and mixed authority generations.

Hydration failure disables continuity only. Messaging remains operational.

## Desktop authority schema and CAS

One owner-scoped meta row stores a random store epoch, generation counter,
authority schema, and active root-key version. The CAS token is `(epoch,
generation)` so restore cannot create an ABA collision.

SQLite authority includes:

- lineage state;
- ordered lineage membership;
- derived artifacts;
- full idempotency key/canonical-request/original-receipt rows;
- existing encrypted records and source mappings.

One `BEGIN IMMEDIATE` transaction compares epoch, generation, expected head,
and latest authority key; resolves exact replay before writing; inserts any
successor; replaces exact authority/membership/artifact/idempotency state;
advances the generation; and commits everything or nothing. Archive, Forget,
and artifact registration use the same transaction even when no successor
ciphertext exists.

## Immutable read generation

Under the single AppState lifecycle lock:

1. reject pending restore without key minting;
2. open one read transaction;
3. capture epoch, generation, and active key version;
4. select exact owner/namespace active authority plus matching ciphertext in
   stable order;
5. verify generation and version before release.

Decrypt and hydrate outside the lock. Any mismatch returns `stale` or a
fail-soft retry; mixed generations are never exposed.

## K06 integration

Backup contains the canonical pure snapshot, source mappings, and integrity
references. Confirmed restore writes ciphertext, mappings, lineage authority,
membership, artifacts, idempotency entries, and meta in one SQLite transaction
after keychain validation. It assigns a fresh local store epoch so pre-restore
CAS tokens are permanently stale.

Rotation atomically reconciles stored ciphertext versions, lineage envelope
versions, and authority generation. Pure hydration fails closed when those
versions disagree.

## Focused evidence

- create/revise/correction/archive close/reopen preserves history, head, pin,
  and every replay receipt;
- archived/forgotten reopen never resurrects a maximum revision;
- every historical exact replay is zero-write; key/request conflict fails;
- successor, authority, membership, and idempotency commit atomically across
  crash boundaries;
- stale epoch/generation/head/latest-key CAS leaves no partial state;
- export/import/export canonical bytes match and malformed authority is never
  visible;
- artifact replay, conflict, cumulative bounds, and Forget inventory survive
  restart;
- pending restore performs no write and does not mint a key;
- rotation/restore version mismatch fails closed;
- protected backup restores authority, mappings, and ciphertext exactly while
  changing the local store epoch.

