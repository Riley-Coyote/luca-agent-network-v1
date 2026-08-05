# A207 atomic rotation security review

Verdict: PASS for A207 and K06.

## Accepted behavior

- Rotation preparation uses an exact-generation compare-and-swap journal bound
  to the authenticated request.
- Every retained envelope is authenticated with its exact old namespace key,
  re-encrypted with a fresh nonce under the exact new namespace key, read-back
  verified, and linked through authenticated replacement authority.
- Lineage, namespace, envelope versions, historical replay authority,
  purge/tombstone state, artifact state, and nonce reservations advance as one
  complete revision generation. Source mappings remain unchanged.
- Final activation is one SQLite transaction containing the retained encrypted
  records, complete authority state, generation increment, unchanged epoch,
  new root version and fingerprint, terminal receipt, and exact journal
  deletion.
- Crash recovery therefore exposes a complete old generation plus a prepared
  journal or a complete new generation. Mixed-key authority cannot become
  visible.
- Migration-required, stale, tampered, failed-receipt, and version-mismatch
  paths perform zero activation writes. Exact terminal receipt replay is
  idempotent.
- The new authority path does not use the legacy in-place batch rotation API.

## Focused evidence

- Continuity rotation tests: 6 passed.
- Atomic complete-owner replacement test: passed.
- Historical replay/reload test: passed.
- Exact Rust formatting and scoped diff validation passed.
- Independent security review found no blocker in CAS, crash recovery,
  encryption, replacement chains, replay, purge, mappings, lock order, or
  zeroization.

Accepted implementation commit: `226a91c5`.
