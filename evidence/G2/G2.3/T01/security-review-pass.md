# T01 security review — PASS

Date: 2026-08-05

## Accepted boundary

- The complete canonical packet, not only memory bodies, is capped at 48 KiB.
- A `ready` layer either contributes one complete item or fails explicitly;
  no partial UTF-8, record, or provenance is emitted.
- Input count and body size are bounded before canonicalization.
- Retrieved text is rendered only inside a fixed untrusted-reference envelope
  and cannot alter tools, permissions, routing, signing, or system authority.
- Plaintext packet bytes are available only through a consuming callback and
  are zeroized on drop.
- The trusted desktop adapter validates exact owner and resident-private scope
  before acquiring one immutable read lease.
- Invalid requests return `invalid`; authorization mismatches return `denied`.
- Missing, locked, stale, corrupt, timed-out, and budget-failed reads produce
  body-free fail-soft receipts without calling a continuity write path.
- A sink panic is caught while the lifecycle guard is held. It neither retries
  the consumed sink nor poisons the lifecycle authority for the next request.

## Focused evidence

- `cargo test -p luca-continuity` — 91 passed, 0 failed.
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml continuity_context --lib --locked`
  — 7 passed, 0 failed.
- `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check` — PASS.
- Scoped `git diff --check` — PASS.

## Review result

Independent review accepted the pure builder after one repair and the desktop
adapter after one repair. No remaining blocker exists within T01 scope.

Chat-level fail-soft behavior remains deliberately unclaimed until T02 wires
this adapter into the real ACP pre-turn seam.
