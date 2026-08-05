# K05D trusted-desktop persistence map

Status: read-only implementation map complete. Desktop persistence must wait
for the pure snapshot, purge/tombstone, and fingerprint contracts to pass.

## V4 migration and degraded behavior

- Freeze SQLite versions v1-v4 explicitly.
- Preflight returns `CurrentV4`, `UpgradeEmptyLegacy(version)`,
  `Degraded(AuthorityMigrationRequired)`, or incompatible.
- Validate legacy schemas exactly before classifying them.
- Empty v1-v3 means zero rows in every table that version owns and no
  nonterminal rotation state. It may upgrade in one `BEGIN IMMEDIATE`.
- Any non-empty legacy store remains byte-for-byte untouched and continuity
  degrades with `authority_migration_required` under D30. No head, lifecycle,
  epoch, or version may be inferred.
- Non-empty or uninspectable legacy WAL/SHM also fails closed. Read the SQLite
  header and use immutable read-only validation where required to preserve
  bytes.
- Fresh v4 creates all tables directly. No owner meta/epoch exists until a
  successful first Create or confirmed whole-state restore.

## V4 authority schema

All counters remain within `SafeU53`. Typed JSON BLOBs are canonical,
strict-deserialized, and bounded before allocation. Child rows carry owner and
authority generation and defer to the exact owner/generation meta pair.

### Authority meta

`continuity_authority_meta` owns owner pubkey, random local store epoch,
generation, authority schema, active root-key version, and portable snapshot
fingerprint. `(owner,generation)` is unique.

### Lineage and membership

`continuity_revision_lineages` owns the complete namespace and scope tuples,
root, retained and active heads, lifecycle, pin, record type, lineage envelope
version, and latest mutation domain/key. Checks enforce owner/resident and
scope/namespace coherence plus active/head lifecycle rules.

`continuity_revision_membership` owns ordered immutable record membership.
Membership survives physical purge. Record IDs are globally unique and may
belong to only one lineage.

### Artifacts and replay

`continuity_revision_artifacts` owns the complete immutable inventory.

`continuity_idempotency_keys` is the cross-domain registry keyed by owner and
idempotency key, with exactly one `revision` or `artifact` domain.

Separate revision and artifact replay tables persist canonical request digest,
typed body-free original binding, and correctly typed original receipt. They
never persist canonical successor bytes or duplicate ciphertext.

### Purge and tombstones

`continuity_revision_purges` owns explicit authorized, in-progress, completed,
or failed/retryable state, purge-plan fingerprint, progress receipt, and
authorizing revision key.

Record tombstones retain body-free chain/envelope authority: record ID,
revision, predecessor, author kind, encrypted-record reference, AAD reference,
namespace reference, historical key version, nonce, and purge-plan reference.

Nonce reservations exist for every accepted live or purged record and are
never deleted. Artifact tombstones bind each deletion to its purge plan and
receipt. Forget completes only when all planned records/artifacts are absent
and tombstoned.

### Required indexes

- exact full-scope partial index for active lineages;
- unique active-head index;
- idempotency-by-lineage/domain index;
- purge-state index;
- lineage tombstone indexes;
- nonce reservation primary lookup;
- preserve exact existing encrypted-record index validation.

## Pure dependency before desktop writes

The pure snapshot must first provide:

- coherent `RevisionLedgerSnapshotV1` with lineages, membership, digest-only
  typed replay entries, purge state, record/nonce/artifact tombstones;
- domain-separated portable `snapshot_fingerprint()` excluding local epoch;
- strict complete validation and export-hydrate-export equality;
- global cross-domain idempotency-key uniqueness;
- aggregate collection and byte bounds;
- completed-purge-only envelope omission;
- authenticated rotation reconciliation that changes live/archived lineage
  versions while preserving entry-bound historical replay and completed-purge
  historical tombstones.

The desktop does not persist a partial or transient pure schema.

## CAS API

Local types:

- `RevisionAuthorityTokenV1`: owner, epoch, generation, schema, active key,
  fingerprint;
- `AuthorityExpectationV1`: uninitialized owner or existing exact token;
- `StoredRevisionGenerationV1`: token plus pure ledger snapshot;
- `ActiveRevisionGenerationV1`: token, exact scope, sorted active heads.

Store operations load a generation, apply revision/artifact mutation by CAS,
advance purge state, read one exact active scope, and replace a complete owner
state for protected restore.

### Write algorithm

1. Resolve typed historical replay before current token/head/lifecycle checks.
   Exact digest/binding returns the original receipt with zero writes; same key
   plus different digest conflicts. Recheck after writer acquisition.
2. `BEGIN IMMEDIATE`; reject restore or rotation; load and hydrate a temporary
   pure ledger.
3. For a new mutation compare owner, epoch, generation, schema, active key,
   fingerprint, root, retained head, lifecycle, and latest mutation domain/key.
4. Apply to the temporary ledger and export/validate/fingerprint the candidate.
5. Persist exact successor, nonce reservation, lineage, membership, artifacts,
   typed replay, purge, and tombstones at the next generation. Ordinary
   mutation may not delete ciphertext. Authenticated purge deletes only its
   exact plan and retains authority/tombstones.
6. CAS-update meta using every expected field, require one affected row, and
   commit. Cache swap follows commit; failure invalidates cache and forces
   rehydration before another write.
7. First Create asserts every owner authority table is empty, generates an
   epoch, and inserts complete state plus generation one in the same transaction.

All mutations use the owner-global checked generation and stop at `SafeU53`
maximum. Existing direct encrypted-row writes are restricted to tests/legacy
internals; production records require authority plus nonce reservation.

## Immutable exact-scope read

AppState owns one already-open continuity runtime store and one lifecycle lock.
Opening the store per turn is prohibited because open may migrate/write.

Under the lifecycle lock:

1. read pending restore through a strict no-mint seam;
2. load an existing master key only;
3. reject rotation;
4. capture token/fingerprint in one read transaction;
5. select exact active scope through the partial index joined to the encrypted
   head;
6. prove count/completeness/caps and envelope/authority agreement;
7. reread token/journals before transaction release.

Decrypt and hydrate into temporary zeroizing state, then reacquire the same
lock and compare epoch, generation, key version, fingerprint, and absence of
restore/rotation immediately before use. On mismatch, discard and retry once or
return `stale`. A narrow closure/read-lease keeps the second guard through
context assembly so unguarded plaintext is not returned.

## K06 integration boundary

Protected backup must contain one pure snapshot plus mappings and active key;
replay data contains no ciphertext. Old pre-authority archives are rejected.
Restore validates with zero writes, creates a fresh local epoch, and replaces
records, mappings, meta, authority, replay, purge, and tombstones in one
transaction. It never unions current state. The portable fingerprint remains
stable while local CAS identity changes.

Rotation's final transaction re-encrypts live/archived records, updates
applicable lineage versions, meta key/generation/fingerprint, and terminal
journal/receipt. Historical replay bindings and completed-purge tombstones keep
their original versions.

## Focused proof matrix

- exact empty legacy migrations and byte-identical non-empty degraded stores;
- close/reopen preservation for create, revise, correction, archive, artifact,
  Forget, purge, pin, inventory, and every historical replay receipt;
- no max-revision resurrection and no envelope omission before completed purge;
- permanent record-ID/nonce/artifact reservation after purge;
- zero-write exact replay after restart and rotation; cross-domain collision;
- stale epoch/generation/head/lifecycle/latest key/domain/active key/fingerprint
  produces no partial state;
- SIGKILL before/after every transaction boundary reopens to exactly old or
  complete new state;
- malformed, orphaned, cross-lineage, mixed-generation, oversized, and partial
  purge candidates never become visible;
- exact-scope reads are isolated, sorted, complete, and exclude archived/
  forgotten lineages;
- concurrent Forget/rotation during decrypt returns `stale` and zeroizes;
- pending restore plus absent key performs zero entropy, key, store, or file
  writes;
- backup/restore preserves the portable fingerprint and all authority while a
  fresh epoch invalidates every old token;
- rotation advances one complete authority generation and rejects mixed state.

