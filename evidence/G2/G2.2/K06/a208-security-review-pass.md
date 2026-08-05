# A208 protected-backup security review pass

Date: 2026-08-05  
Commit: `cc715962`  
Reviewer: `g2_k05_review`  
Verdict: PASS

## Accepted behavior

- Preview, wrong-passphrase, tamper, and exact-confirmation failures occur
  before product state writes.
- A confirmation mismatch leaves keychain slots, SQLite authority, mappings,
  staging files, and durable database/WAL bytes unchanged.
- The age staging file contains only the original ciphertext and uses `0600`
  permissions.
- Fresh-keychain recovery before store activation returns to a verified empty
  destination.
- Fresh-keychain recovery after store activation retains the exact candidate
  owner identity, root, authority, records, and mappings; restored records
  authenticate and decrypt under the installed root.
- Recovery chooses old or new authority from the exact persisted snapshot
  reference rather than trusting an assumed journal phase.
- Diagnostics remain body-free and disclose neither continuity plaintext nor
  secret keys.

## Focused verification

- `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml continuity_backup --lib -q`
  - 14 passed; 0 failed.
- `git show --check cc715962`
  - clean.
- Independent source review
  - no blocking findings.

No broad repository CI was run at this slice boundary.
