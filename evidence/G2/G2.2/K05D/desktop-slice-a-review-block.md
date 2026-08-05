# K05D desktop slice A — independent review block

Date: 2026-08-05
Verdict: BLOCKED before commit
Reviewer: Erdos

The implementation passed its focused source tests, but independent review
found five contract gaps that the test matrix did not yet exercise.

## Blocking findings

1. Authority hydration bounds row counts and selected BLOBs, but normalized
   scalar TEXT values can still be allocated before SQL-side per-field and
   aggregate bounds run.
2. Exact DDL validation verifies the expected named objects but does not reject
   extra application tables, indexes, triggers, or views in v1-v4 stores.
3. The whole-owner replacement seam cannot yet atomically compose ciphertext,
   source mappings, owner version, and v4 revision authority. The legacy
   replacement path can otherwise leave an authority-bearing owner
   inconsistent.
4. Generation hydration spans multiple SQLite read snapshots and lacks an
   explicit preflight-count equality plus normalized export/hydrate/export
   proof.
5. Ambiguous header-zero databases with WAL are classified through a UUID
   temporary copy before their version is known, violating the literal
   no-entropy/no-file legacy preflight rule.

## Verified sound in the blocked checkpoint

- Historical revision and artifact replay execute under `BEGIN IMMEDIATE` and
  return the transaction-current token.
- Complete owner-global CAS, global idempotency, artifact ownership,
  purge/tombstone/no-resurrection, and active-rotation refusal were sound in
  the reviewed paths.
- Recognized v1-v3 fixtures, including WAL-backed fixtures, remained
  byte-identical on degradation.

## Focused checks at review

```text
continuity_revision_authority: 6 passed
continuity_store::tests: 20 passed
```

Passing tests did not override the five source-level findings. No slice-A
commit or acceptance claim was made. Riley authorized one surgical repair pass
for these findings.
