# K06 rotation and backup/restore reconnaissance

Status: read-only map complete; implementation waits for K03D and K05.

K06 is continuity-storage recovery. It does not replace the existing owner
identity recovery system, export resident signing keys, copy native runtime
credentials, or create another plaintext master-key store.

## Owned implementation shape

New trusted-desktop modules:

- `luca/continuity_rotation.rs`
- `luca/continuity_backup.rs`

The integrator owns module registration, manifests/lockfiles, and any narrowly
required K02 visibility change. K06 consumes K03D store transactions and K05
revision/mapping authority; it must not duplicate their SQL or lifecycle logic.

Before K06 begins, K03D must expose writer-serialized rotation journal,
snapshot/batch, compare-and-swap replacement, completion verification,
active-version activation, and inactive restore staging/activation operations.
K05 must provide the current revision visibility set and stable body-free
identity/source mappings.

## A207 rotation state machine

1. Acquire one continuity lifecycle/write lock. Messaging remains available;
   continuity writes, backup, and restore are queued or denied.
2. Reconcile any prior journal. Persist `Prepared` with rotation ID,
   from/to versions, frozen snapshot boundary, and deterministic cursor before
   changing a record.
3. Protect the body-free journal with a separately domain-separated derived
   AEAD key. Canonical AAD binds schema, owner, rotation, versions, phase,
   cursor, and snapshot boundary. No body or key enters the journal.
4. For each bounded batch, authenticate/decrypt the old envelope into a
   zeroizing buffer, preserve the complete logical metadata except advancing
   key version, derive the new namespace key directly from the same root,
   encrypt with a fresh nonce, authenticate/read back, and transactionally
   compare-and-swap the expected envelope while advancing the cursor in the
   same commit.
5. Crash before commit leaves old row/cursor; crash after commit leaves new
   row/advanced cursor. Reads use each row's explicit key version, so physical
   mixed progress is never ambiguous.
6. Verify every frozen target is at the new version and decrypts under its
   exact namespace key. Atomically activate the namespace version, mark
   `Activated`, then `Complete`, and only then compact terminal journal state.
7. Startup resumes `Prepared/Reencrypting`, rechecks `Verifying`, and finalizes
   `Activated`. Journal auth failure makes continuity unavailable and never
   guesses or writes. Backup/restore cannot run during nonterminal rotation.

Record replacement is a K03D-specific CAS operation, not ordinary K03
`put_encrypted`, because the latter correctly treats a changed envelope under
the same record ID as a replay conflict.

## A208 age-protected backup

Reuse the pinned age 0.12.1 scrypt/passphrase and zero-write preview pattern
from existing owner recovery. Do not invent custom archive cryptography.

The strict canonical archive inside age contains:

- public Luca backup manifest and owner binding;
- continuity root wrapped by the age envelope;
- a consistent encrypted continuity snapshot;
- body-free resident/source identity mappings;
- schema/store versions, content/mapping references, and integrity hashes;
- only the established owner identity recovery payload/pointer if the final
  contract explicitly requires it.

It excludes resident signing secrets, coordinator credentials, native runtime
configuration, provider tokens, source paths, plaintext indexes, transcript
caches, memory bodies, and portable-Capsule authority claims.

Export uses a K03D consistent ciphertext snapshot rather than copying a live
WAL database. Existing-key load must not mint a root merely because backup was
requested. Passphrase, archive plaintext, and root buffers are zeroizing;
ciphertext output uses restricted temp permissions, fsync, atomic rename,
directory fsync, and finalized readback.

## Zero-write preview and confirmed restore

`preview_backup` has no keychain, AppState, store-write, or tempfile handle. It
bounded-reads age ciphertext, decrypts in zeroizing memory, enforces strict
canonical schema, validates owner/content/mapping hashes and encrypted envelope
references, then returns only backup ID/time, owner key, resident mapping
count/fingerprints, record count, and encrypted-file hash.

Confirmation re-reads and revalidates the exact archive and binds the preview
hash, backup ID, and confirmed owner key. After explicit confirmation it:

1. acquires the lifecycle lock;
2. writes/fsyncs a body-free restore journal and restricted inactive staging;
3. validates all records/mappings using the archive root in memory;
4. installs the root into keychain and constant-time verifies readback;
5. only then atomically activates the staged store;
6. independently decrypts active records and verifies mappings;
7. removes rollback/staging state and marks completion.

Existing-key replacement keeps a rollback entry in keychain, never on disk.
Failure before visibility restores/deletes the candidate root and staging.
Rollback failure leaves continuity unavailable with recoverable body-free
journal state; chat remains functional. Crash recovery validates an already
activated store or requires explicit user unlock/discard, never silently
restores or exposes partial data.

## Required failure evidence

- crash injection before/after every rotation batch, verification, activation,
  and cleanup;
- journal/AAD/nonce/ciphertext tamper, wrong keys, nonce/replay/CAS conflict,
  corrupt store, and locked/missing keychain;
- wrong passphrase, tampered/truncated/non-scrypt/oversized/noncanonical archive,
  schema/hash/owner/mapping mismatch, stale confirmation/TOCTOU;
- preview write counter equals zero across keychain, DB, filesystem, journals,
  caches, and native config;
- fresh-keychain restore decrypts real owner-brain and resident records;
- failures at staging, keychain, visibility, validation, cleanup, restart,
  discard, and rollback boundaries;
- before/after native-configuration hashes remain unchanged;
- DB/WAL/SHM, staging, backup, logs, crash/evidence, screenshots, and child
  environments contain no plaintext fixtures, passphrase, root/derived keys,
  titles/tags/context packets, or local source paths.

## Explicit omissions

No multi-install merge, multi-writer authority, remote storage/embeddings,
background daemon, resident signing-key or coordinator-epoch restoration,
native configuration mutation, credential copying, plaintext export/index,
automatic restore without confirmation, or broad UI redesign.
