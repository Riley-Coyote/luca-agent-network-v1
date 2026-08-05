# K06 bounded-repair re-review — repair ceiling reached

Verdict: BLOCK. No G2.2 claim. The one planned repair closed most of the first
review, but two defects remain and no further K06 edit is authorized under the
current task repair ceiling.

## Closed findings

- a parent-killed subprocess left real WAL/SHM state and SQLite recovered the
  committed record on reopen;
- lifecycle-lock construction is AppState-only outside tests;
- deterministic partial identity/master slot combinations reconcile while the
  restore journal is retained;
- restore requires an empty destination or exact same owner/root authority;
- encrypted rows, source mappings, and key version restore atomically;
- terminal rotation receipts are authenticated and exact-request-bound;
- snapshot completeness/truncation, symlink rejection, ciphertext tamper,
  re-encrypted manifest tamper, and fresh-keychain restore have focused proof;
- K06's restore transaction can accept later K05D authority integration.

Focused verification passes: 10 custody, 17 store, 3 rotation, and 9 backup
tests, plus exact formatting and scoped diff checks.

## Remaining P1

When candidate master-key `store_raw` returns an error, the code deletes the
verified rollback slot. The macOS SecretStore rewrites a single Keychain blob,
and a `set_password` error is commit-ambiguous: the candidate may actually have
persisted. Deleting rollback can then leave the old SQLite snapshot encrypted
under a lost prior key. Recovery authority must remain until active-key
read-back determines which key committed and the restore journal reconciles
that exact state.

## Remaining P2

Backup decryption currently parses and canonicalizes a complete JSON value up
to the global 136 MiB limit before record/mapping collection caps run. The
global limit bounds damage, but it does not meet the contract to reject
collection overflow before full value cloning/canonicalization. Structural
streaming or an equivalent bounded preflight is required.

## Next authorized repair, if approved

1. Treat every candidate-key write error as commit-ambiguous: retain rollback
   and restore journal, read back active authority, then complete or roll back
   deterministically.
2. Add an injected committed-write/error test for both old and absent roots.
3. Preflight top-level backup structure and exact record/mapping counts before
   materializing/canonicalizing the complete archive.
4. Add over-cap fixtures that prove early rejection under the intended memory
   bound.

