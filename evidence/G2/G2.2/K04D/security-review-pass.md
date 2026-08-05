# K04D — Zeroizing retrieval security review

Date: 2026-08-05
Verdict: PASS for the pure retrieval ownership slice
Acceptance impact: A210 remains open until the desktop read lease proves
success, retry, error, and timeout cleanup.

## Implemented boundary

- `RetrievalText(Zeroizing<String>)` is the sole owner for decrypted retrieval
  bodies, tags, cues, stored records, hits, and returned results.
- Clones remain zeroizing; public accessors borrow and no `Display`, serde, or
  ordinary-string extraction API exists.
- Authenticated decrypted bytes move into the UTF-8 allocation without a
  plaintext copy. Invalid UTF-8 retains its original allocation in a
  zeroizing owner before returning a body-free error.
- Each in-memory lexical index generates a fresh random 256-bit HMAC-SHA256
  key held in zeroizing memory.
- SQLite receives only record identifiers, keyed opaque term hashes, and
  numeric body/tag frequencies. Bodies, tags, and cues never cross its bind or
  row boundary.
- Exact scope, deterministic score ordering, graph activation, hydration
  limits, and punctuation-only record behavior remain intact.

## Root verification

```text
cargo test -p luca-continuity --locked -q
75 passed; 0 failed

cargo clippy -p luca-continuity --all-targets --locked -- -D warnings
PASS

rustfmt --check --edition 2021 <K04D files>
PASS

git diff --check -- <K04D files>
PASS
```

## Independent review

Reviewer: Sagan

The reviewer audited ownership, invalid-UTF-8 cleanup, SQLite parameters and
rows, per-index key generation, exact-scope selection, ranking, bounds,
redacted diagnostics, and public escape paths. No blocking or non-blocking
finding remained. The reviewer independently repeated the retrieval-vector,
FTS, complete crate, strict Clippy, and scoped diff gates successfully.

## Deferred proof

K04D deliberately does not claim the complete A210 contract. K05D must still
wire these owners through the desktop two-phase immutable read lease and prove
zeroization on lease success, retry, error, and timeout.
