# K06 independent security review — blocked repair

Status: BLOCK. The focused tests passed, but the first independent review
found recovery and authority defects that prevent an A207/A208 or G2.2 claim.
No K06 receipt is terminal until this repair and K05D integration pass review.

## Passing focused evidence before review

- rotation tests: 2/2;
- backup tests: 5/5;
- encrypted-store tests: 14/14;
- key-custody tests: 10/10;
- scoped formatting and diff checks: pass.

These tests did not exercise a real process crash/reopen or the partial-state
combinations below.

## P1 findings

1. Existing WAL/SHM files are rejected before SQLite can perform normal crash
   recovery, so a real relaunch may never reach the authenticated rotation or
   restore journal.
2. A crash between rollback-slot and candidate-slot keychain writes leaves a
   partial state the restore recovery code cannot complete or roll back. Some
   ordinary error paths also delete the recovery journal before rollback is
   verified.
3. Restore accepts a valid but different existing owner/root and replaces only
   the archive owner's rows, which can strand prior-owner ciphertext under a
   discarded root.
4. Import/source mappings are returned in memory but not persisted in the same
   SQLite restore transaction, so a crash can lose them after store/keychain
   finalization.
5. Rotation deletes its only authenticated terminal state. A later request
   targeting the current version can replay with a different rotation ID and
   receive a fabricated zero-record result.
6. `ContinuityLifecycleLock` is freely constructible and not owned by AppState;
   independent instances do not serialize backup, restore, rotation, and read
   generations.

## P2 and evidence gaps

- archive and snapshot limits are checked too late and do not prove that a
  truncated row was not omitted;
- store path helpers follow symlinks instead of rejecting them;
- no ciphertext byte-flip test;
- no valid decrypted-manifest tamper/re-encryption test;
- no integrated restore with both identity and continuity active slots absent;
- no subprocess kill/reopen proof.

## One bounded repair contract

- wire one AppState-owned lifecycle lock and prove real SQLite crash recovery;
- retain authenticated terminal rotation receipts bound to the exact request;
- make restore recovery handle every partial keychain-slot combination and
  retain its journal until rollback or finalization is verified;
- require an empty or exact same-owner/root destination;
- persist mappings and K05D authority in the same SQLite restore transaction;
- enforce all bounds before cloning, canonicalizing, or writing and reject
  symlinked store paths;
- add tamper, fresh-keychain, wrong-owner/root, partial-write, overflow,
  truncation, and real process-crash tests.

