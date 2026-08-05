# K05D pure authority projection re-review

Verdict: PASS for the pure-crate projection slice. K05D and A209 remain open
until desktop persistence, hydration, CAS, immutable reads, and K06 backup
integration are complete.

## Closed findings

- Public Create rejects the 4,097th lineage before records, lineages, or
  idempotency state can mutate. Exact replay remains available at capacity.
- Derived-artifact authority is capped at 256 references per lineage and
  16,384 per ledger, with checked cumulative bounds before clone or extend.
- Artifact registration now uses a domain-separated canonical idempotency
  binding over namespace, scope, type, lineage envelope version, root, expected
  head, request reference, and exact sorted artifacts.
- Exact replay returns the original receipt even after later artifact
  mutations; conflicting reuse fails; no-op new registrations are rejected.
- The projected authority-mutation key advances only for a real accepted
  revision, archive, forget, or artifact mutation.
- Key-version state is explicitly the lineage envelope version, not K06's
  global active-root version. Projection and reconciliation fail closed on a
  mismatch and never infer a rekey.

## Verification

- focused revision unit tests: 7 passed;
- complete `luca-continuity` suite: 59 passed;
- strict Clippy with warnings denied: passed;
- exact formatting and scoped diff check: passed;
- independent re-review: no P0, P1, or P2 findings.

