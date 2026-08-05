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
- latest authority-mutation idempotency key;
- explicit purge state, exact purge-plan fingerprint, progress receipt, record
  tombstones, nonce reservations, and artifact deletion tombstones.

Every retained encrypted `ContinuityRecordV1` is sorted by record ID. Archived
lineages retain their full history. A forgotten lineage may omit physically
purged envelopes only when explicit body-free membership and terminal purge
authority remain.

Revision and artifact idempotency remain separate domains. Every entry persists
the key, a domain-separated canonical request digest, a minimal typed body-free
replay binding including its original envelope version, and its correctly typed
immutable original receipt. Successor-bearing canonical request bytes are
never persisted because they duplicate encrypted memory and would defeat
Forget after physical purge. Persisting only the newest entry is insufficient:
historical exact replay recomputes the digest from the incoming request and
returns its original receipt without writing, even after rotation.

Forget uses an explicit authorized, in-progress, completed, or failed/retryable
purge state. Missing envelopes are valid only with authenticated completed
purge authority. Body-free tombstones permanently reserve purged record IDs and
namespace/key-version/nonce tuples; artifact tombstones prove deletion of every
planned artifact. Authority, membership, replay digests, purge receipts, and
tombstones are never physically purged.

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
  uniqueness across live records and tombstones;
- require explicit lineage membership and validate its root/revision/
  predecessor chain against persisted authority without using it to choose a
  head;
- require retained head membership; active means active head equals retained
  head and exists, archived means no active head and every envelope remains,
  and forgotten means no active head with any missing envelope justified by a
  completed purge tombstone;
- require pinned correction, artifacts, scope, type, and lineage envelope
  version to match the authority row;
- require the latest authority key to resolve to the correct typed revision or
  artifact replay entry whose receipt agrees with current authority;
- validate every idempotency key against its domain-separated request digest,
  original body-free binding/version, and typed receipt;
- validate historical replay against its entry-bound original version rather
  than current lineage version;
- reject unknown fields, mixed schemas, incomplete purge state, reused purged
  IDs/nonces, and artifact inventory without exact deletion status;
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
- separate revision/artifact replay key, digest, typed-binding, and typed-receipt
  rows;
- purge state/progress plus record, nonce, and artifact tombstones;
- existing encrypted records and source mappings.

One `BEGIN IMMEDIATE` transaction compares owner, epoch, generation, lineage,
expected retained head, lifecycle, latest authority key, active root-key
version, and absence of restore/rotation work. It resolves exact historical
replay before current-state checks, inserts any successor, replaces exact
authority/membership/artifact/replay/purge/tombstone state, advances the checked
owner-global generation, and commits everything or nothing. Archive, Forget,
purge progress, and artifact registration advance generation even without new
ciphertext. A committed database followed by a failed cache swap invalidates
the cache and forces hydration before another write.

## Immutable read generation

Under the single AppState lifecycle lock:

1. reject pending restore without key minting;
2. open one read transaction;
3. capture epoch, generation, and active key version;
4. select exact owner/namespace active authority plus matching ciphertext in
   stable order;
5. verify completeness rather than relying on `LIMIT`;
6. release the lock, decrypt and hydrate into temporary zeroizing state;
7. reacquire the same lifecycle lock and compare epoch, generation, active key
   version, and snapshot fingerprint immediately before plaintext can be used.

Any mismatch discards plaintext and permits at most one bounded retry before a
fail-soft `stale` result. A concurrent Forget, restore, or rotation therefore
cannot expose a stale decrypted snapshot. Active rotation blocks consumer reads
and writes; pending restore is rejected before key minting.

## K06 integration

Backup contains one normalized encrypted-record collection plus authority,
membership, typed replay digests/bindings/receipts, artifacts, purge state,
tombstones, source mappings, and integrity references. It never duplicates an
encrypted successor inside replay data. Confirmed restore replaces all current
state in one SQLite transaction after complete zero-write validation and assigns
a fresh local store epoch so pre-restore CAS tokens are permanently stale. The
portable content fingerprint excludes that local epoch; local CAS identity
includes it.

Rotation atomically reconciles the owner root-key version, every affected live
and archived envelope, applicable lineage envelope versions, authority
generation, and terminal journal/receipt state. Historical replay retains its
entry-bound original version. Already-purged Forgotten records retain historical
version/nonce tombstones and do not receive fabricated envelopes.

## Exact bounds

Checked pre-allocation limits cover total records (at most 100,000), aggregate
encrypted bytes (at most 128 MiB), lineages, total/per-lineage membership,
revision and artifact replay entries, purge/tombstone rows, aggregate replay
binding/receipt bytes, 256 artifacts per lineage, 16,384 artifacts per ledger,
source mappings, serialized snapshot bytes, and every variable-length field.
Declared counts must equal loaded counts; persistence never silently truncates.

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
- forgotten ciphertext is absent from records, replay rows, backup payloads,
  WAL/SHM, and logs while body-free tombstones prevent ID/nonce reuse;
- partial purge resumes or fails closed without resurrection;
- every historical replay survives rotation using its original binding;
- concurrent Forget/rotation during decrypt yields `stale`, not plaintext;
- pending restore performs no write and does not mint a key;
- rotation/restore version mismatch fails closed;
- protected backup restores authority, mappings, and ciphertext exactly while
  changing the local store epoch.
