# K05D immutable desktop lease security review

Verdict: PASS for A209 and the desktop half of A210.

## Accepted behavior

- AppState owns the continuity lifecycle guard and runtime state.
- Boot probes the main database, WAL, and SHM without opening or creating the
  store. Existing encrypted state requires existing key custody; only a truly
  new store path may acquire a new root.
- One exact owner/namespace/scope revision snapshot is captured under the
  lifecycle guard with complete active-lineage and canonical encrypted-head
  validation.
- The lease permits at most two attempts. It releases the guard only for
  bounded decrypt, strict decode, and in-memory retrieval, then reacquires it
  and revalidates restore state, key/root identity, epoch, generation, key
  version, and authority fingerprint.
- The borrowed plaintext consumer runs exactly once while the second guard is
  held. Stale and failure paths invoke it zero times, and the public outcome is
  body-free.
- Invalid and unavailable authority conditions remain typed and fail soft, so
  continuity failure cannot block messaging.

## Focused evidence

- Continuity runtime tests: 7 passed.
- Revision-authority tests: 12 passed.
- Key-bootstrap read-only/no-mint probe passed.
- Exact Rust formatting and scoped diff validation passed.
- Independent security review found no blocker in plaintext ownership,
  lifecycle ordering, restart authority, scope isolation, no-mint behavior, or
  callback execution.

Accepted implementation commit: `226a91c5`.
