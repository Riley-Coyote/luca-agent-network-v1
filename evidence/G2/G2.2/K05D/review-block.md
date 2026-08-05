# K05D pure authority projection review — blocked repair

Status: BLOCK. Deterministic lifecycle projection is correct, but public
mutation paths can create authority state the projection cannot safely or
uniquely persist.

## Passing behavior

- stable root-ID ordering;
- explicit active, archived, and forgotten lifecycle state;
- archived and forgotten lineages never expose an active head;
- pinned owner-correction state and exact retained head are projected;
- head selection never depends on revision order;
- projected data is body-free;
- focused tests, all 56 continuity tests, strict Clippy, formatting, and diff
  checks pass.

## Blocking findings

1. `apply(Create)` can add more than 4,096 lineages, while `active_heads()`
   refuses any projection above that count. One valid extra create can
   therefore make the complete authority projection unavailable. Capacity must
   be enforced before mutation or served through authenticated pagination.
2. Repeated derived-artifact registration is unbounded. It also changes the
   authoritative inventory without a new canonical idempotency binding, so two
   different authority states can project the same transition key. Artifact
   registration needs fixed bounds and exact replay/conflict semantics.
3. The projected key version must not be described or consumed as globally
   active after K06 rotates stored envelopes. Hydration/rotation needs an
   explicit authenticated rekey seam or a fail-closed version check.

## One bounded repair contract

- reject lineage capacity before public mutation and prove no-mutation at the
  boundary;
- cap per-lineage and aggregate artifact authority before clone/extend;
- domain-separate artifact mutation idempotency and preserve original receipts
  for exact replay while rejecting conflicts;
- make key-version semantics precise and require authenticated rotation or
  hydration reconciliation;
- add public-API capacity, cumulative-artifact, replay/conflict, and projection
  sensitivity tests.

