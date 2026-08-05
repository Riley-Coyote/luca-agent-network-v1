# K05D trusted-desktop immutable-read map

Status: read-only map complete. Bind exact names only after desktop slice A
freezes its token and active-generation APIs.

## Runtime ownership

- `AppState` owns the sole process-lifetime `ContinuityLifecycleLock` and a
  `Mutex<ContinuityRuntimeState>` initialized as `Uninitialized`.
- A new narrow `continuity_runtime` module owns
  `Uninitialized | Ready(ContinuityRuntime) | Degraded(reason)` and exactly one
  already-open `ContinuityStore`. The store is never opened or migrated per
  turn, and the master key is never cached in AppState.
- Initialize after persisted identity/recovery state is known and before event
  sync or managed-agent restoration. Recovery failure degrades continuity while
  chat continues.
- Add a strict no-write/no-mint restore-status read and an existing-key-only
  custody read. Pending restore must not create entropy, keys, directories,
  SQLite state, WAL, or SHM.

## Global lock order

Freeze one order: AppState lifecycle guard, then keychain read, then continuity
runtime mutex, then SQLite transaction. Never acquire lifecycle while holding
runtime/store. Production backup/restore/rotation adapters need locked variants
or a typed lifecycle guard so they cannot double-lock or invert this order.

## Two-phase exact-scope lease

Attempt at most twice:

1. Under lifecycle authority, require restore clear, load an existing root key,
   access the already-open store, reject rotation, and capture the complete
   authority token/fingerprint in one read transaction. Select only exact-scope
   active heads through the authority index; prove sorted completeness, counts,
   byte caps, and envelope agreement; reread token and journals before release.
2. Outside locks, derive namespace keys, authenticate/decrypt, strict-decode,
   and hydrate temporary retrieval state. All root keys, namespace keys,
   decrypted bodies, decoded records, index records, and hits must zeroize.
3. Reacquire the same lifecycle authority, require restore clear, reload
   existing key authority, and compare owner, epoch, generation, schema, active
   key, fingerprint, and absence of restore/rotation. Keep the lifecycle guard
   through synchronous bounded context assembly; do not await while held.

Any mismatch zeroizes and retries once; a second mismatch returns `stale`. The
consumer closure runs exactly once only after successful second validation.
Async callers use `spawn_blocking`.

## Required K04 hardening before lease claim

Current retrieval inputs and stored records use cloneable `String` bodies.
Before immutable desktop reads can claim plaintext containment, add a zeroizing
body representation or consuming constructor from `DecryptedRecordBody`, and a
strict bounded decoded material schema. No cloned plaintext body or hit may
escape zeroization; desktop must not infer tags, confidence, or graph edges
from arbitrary bytes.

## Fail-soft mapping

- locked custody: `locked`;
- absent store/key or degraded runtime, including authority migration:
  `unavailable`;
- no authorized active material: `empty`;
- policy rejection: `denied`;
- token, journal, binding, or grant mismatch: `stale`;
- AEAD, schema, scope, or provenance corruption: `invalid` for that layer;
- deadline: `timeout`.

No result may block, reroute, cancel, or mutate chat.

## Focused proof

- initialize exactly once and reuse one store across reads;
- pending restore plus absent key causes zero key/file/SQLite writes;
- fixed lock order survives concurrent read/rotation/restore/Forget;
- mutation between phases retries once; two mutations return stale;
- every token field and either-phase journal mismatch fails closed;
- exact owner/resident/project/room/conversation isolation and sorted complete
  active heads, excluding archived/forgotten state;
- closure invocation exactly once after revalidation; database and sidecar bytes
  unchanged by reads;
- unavailable/stale/timeout preserve existing T01/T02 prompt and chat bytes;
- success, retry, error, and timeout all zeroize candidate keys, bodies, and
  memory-only index copies.
