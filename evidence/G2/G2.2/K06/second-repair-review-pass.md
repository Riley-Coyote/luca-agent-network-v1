# K06 authorized second repair — independent re-review

Verdict: PASS for the two authorized residual defects. K06 remains in progress
until protected backup and rotation include the accepted K05D authority state.

## Closed findings

- Candidate master-key writes that return an error are treated as
  commit-ambiguous. Verified rollback authority is retained on both write and
  read-back failure, and the restore journal remains authoritative until exact
  old/new active-state reconciliation completes.
- Regression coverage proves deterministic recovery for both a pre-existing
  root key and an initially absent root key.
- Decrypted archive structure is streamed through a bounded serde visitor
  immediately after bounded decryption and before canonicalization or typed
  materialization.
- The preflight enforces the exact top-level fields, rejects duplicates,
  unknown fields, missing fields, and stops at record/mapping cap plus one
  without parsing an intentionally malformed tail.
- Typed collection counts are checked against preflight counts after strict
  canonical parsing.

## Verification

- Root and independent reviewer: custody tests 11/11.
- Root and independent reviewer: backup tests 11/11.
- Exact-file Rust formatting check: PASS.
- Scoped diff check: PASS.
- Independent review found no P0/P1/P2. Sentinel-string classification for the
  private bound error was noted as non-blocking because every mismatch remains
  fail-closed.

No A207, A208, K06, or G2.2 completion claim is made until K05D authority is
included in protected backup/restore and rotation and re-reviewed as one
integrated generation.
