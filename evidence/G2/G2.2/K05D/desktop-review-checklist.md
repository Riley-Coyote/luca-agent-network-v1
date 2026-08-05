# K05D trusted-desktop final-review checklist

This pre-mortem is mandatory review scope for desktop persistence, CAS,
immutable reads, backup, and rotation integration. Source contracts remain
`desktop-map.md`, `restart-contract.md`, and decisions D29-D32.

## Migration and no-touch

- Validate exact v1-v4 schemas before classification.
- Upgrade only completely empty v1-v3 stores in one `BEGIN IMMEDIATE`.
- Nonempty legacy stores return `authority_migration_required` without
  authority inference or any key, entropy, file, SQLite, WAL, SHM, checkpoint,
  or sidecar write.
- Test every legacy-owned table and committed/uninspectable sidecar state with
  exact pre/post byte comparison.
- Fresh v4 creates the full schema but no authority row before first Create or
  confirmed restore.

## Schema, hydration, and bounds

- Validate exact tables, columns, SQL, checks, foreign keys, indexes, and
  partial-index predicates; reject all extra, missing, weakened, and mixed
  generation state.
- Bind every child row to the exact owner and generation.
- Preflight canonical typed JSON and every per-field, collection, aggregate,
  replay, membership, mapping, and snapshot bound before materialization.
- Require declared-count equality; never use truncating `LIMIT` as proof.
- Hydrate into temporary pure state, prove export-hydrate-export and fingerprint
  equality, and publish nothing on failure.

## Historical replay and CAS

- Resolve exact historical replay before current token/head/lifecycle checks and
  recheck after writer acquisition. Exact replay returns the original typed
  receipt with zero writes; changed digest/binding conflicts.
- Prove replay after restart, later mutation, Archive, Forget, purge, and
  rotation using the entry-bound original version.
- Compare owner, epoch, generation, schema, active key, fingerprint, lineage,
  retained head, lifecycle, latest domain, and latest key; reject active restore
  or rotation.
- Test every stale expected field independently, concurrent writers, SafeU53
  exhaustion, first-Create atomicity, and post-commit cache invalidation.

## Purge and crash atomicity

- Ordinary mutation never deletes ciphertext.
- Purge atomically deletes only its exact authenticated plan while retaining
  membership, replay, tombstones, nonce reservations, progress, and authority.
- Completion requires every planned item absent and tombstoned.
- Fault/SIGKILL tests around candidate persistence, CAS, purge, commit, and
  cache swap reopen to exactly the old or complete new generation.
- Purged IDs/nonces/artifacts remain permanently reserved; Archived and
  Forgotten lineages never regain active heads.

## Immutable reads

- Use one already-open AppState store and lifecycle lock; never open/migrate per
  turn or mint a key while checking pending restore.
- Capture a complete token/fingerprint in one exact-scope read transaction,
  prove count, order, bounds, and envelope agreement, then recheck journals and
  token before release.
- After decrypt/hydrate, reacquire the same lock and compare epoch, generation,
  key, fingerprint, restore, and rotation immediately before use. Mismatch
  zeroizes and retries once or returns stale.

## Backup and rotation compatibility

- Protected backup includes exactly one pure authority snapshot plus ciphertext
  and mappings, without replay ciphertext duplication. Reject pre-authority
  archives.
- Confirmed restore replaces the complete state atomically, preserves the
  portable fingerprint, and assigns a fresh local epoch.
- Rotation atomically updates retained ciphertext, applicable lineage versions,
  active key, generation, fingerprint, and terminal receipt while preserving
  historical replay/tombstone versions.
- Existing store, backup, rotation, and pure revision suites remain green.
