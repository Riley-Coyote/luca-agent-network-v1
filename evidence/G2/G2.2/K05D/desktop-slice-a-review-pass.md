# K05D desktop persistence slice A — repair review pass

Date: 2026-08-05
Verdict: PASS for desktop persistence slice A
Implementation commit: `00ffef50`
Independent reviewer: Erdos

The authorized repair closed all five findings from
`desktop-slice-a-review-block.md`:

1. Normalized authority, restore, and rotation reads perform SQL-side storage
   class, per-field byte, row-count, aggregate, and replay bounds before
   allocating `String` or `Vec` values.
2. Versioned v1-v4 schema checks reject every extra application table, index,
   trigger, or view in addition to validating the expected DDL.
3. The complete-owner restore seam replaces ciphertext, source mappings, owner
   version, fresh epoch, and revision authority in one `BEGIN IMMEDIATE`;
   the legacy seam refuses authority-bearing owners.
4. Authority hydration uses one SQLite read transaction, consumes the exact
   preflight count manifest, and proves normalized export-hydrate-export plus
   fingerprint equality before returning a generation.
5. Ambiguous header-zero stores fail before entropy, temporary files, or
   SQLite recovery writes. Recognized empty legacy migration remains
   transactional and current v4 stores retain ordinary WAL recovery.

The independent source review also rechecked replay-before-CAS, exact
zero-write replay, owner-global tokens, purge/tombstone/no-resurrection, and
active-rotation refusal. No new findings were reported.

## Root verification

```text
continuity_revision_authority: 9 passed
continuity_store::tests: 24 passed
continuity_backup::tests: 11 passed
continuity_rotation::tests: 3 passed
cargo check --lib --locked: passed
rustfmt --check (owned files): passed
git diff --check (owned files): passed
```

Known deferred dead-code warnings are expected until the AppState runtime and
commands consume these seams.

This PASS does not claim K05D, A209, K06, A207, A208, or G2.2. The immutable
AppState read lease and authority-aware backup/rotation integration remain.
