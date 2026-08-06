# Luca V1.1-V1.3 roadmap control

Status: planning complete; implementation not started

Planning branch: `agent/v1.1-v1.3-roadmap`

Planning baseline: `36472636af120cb3213dcae84b3ff5827a7c8e93`

Product baseline: Luca V1 Functional Beta, whose accepted implementation and
evidence live under `docs/luca/functional-beta/`.

This directory is the implementation authority for the next three incremental
continuity releases. It deliberately replaces the breadth of the original G2
task graph with three bounded product slices. The original
`docs/luca/continuity-g2/` package remains the long-range roadmap and evidence
archive; it is not the active task graph for V1.1-V1.3.

## Read order

1. `00_START_HERE.md`
2. `PRODUCT_CONTRACT.md`
3. `ROADMAP.md`
4. `ARCHITECTURE_CONTRACTS.md`
5. `TASK_GRAPH.yaml`
6. `ACCEPTANCE.md`
7. `FRONTEND_INTEGRATION_HANDOFF.md`
8. `DEMO_SCENARIOS.md`
9. `DECISION_LEDGER.md`
10. `RUN_LOG.md`

## Three-release promise

- **V1.1 — Resident Notebook:** turn the current handoff into a selective,
  source-backed hypomnema that can retain, revise, supersede, archive, and
  recall a small number of meaningful notes.
- **V1.2 — Scoped Brain Sources:** let the owner add a narrow local corpus and
  grant read-only recall to specific residents with visible provenance.
- **V1.3 — Resident Reflection:** let a resident intentionally review and
  consolidate its own notebook through its exact configured runtime and model.

These releases do not add a conductor, scheduled inner life, proactive outreach,
automatic personality evolution, broad imports, or background agent society.

## Implementation-start rule

This planning branch does not become the product branch. Before implementation:

1. integrate the accepted frontend/design work with the functional-beta branch;
2. run an overlap review against the continuity surfaces named in
   `FRONTEND_INTEGRATION_HANDOFF.md`;
3. create a clean implementation branch and worktree from that accepted
   integration checkpoint;
4. record the exact checkpoint in `DECISION_LEDGER.md` and `RUN_LOG.md`;
5. complete task C01 before any product-code task begins.

## Non-negotiable invariants

- Signed Luca conversation events remain canonical chronology and authorship.
- Resident public keys remain canonical identity.
- A resident can read only its own private continuity namespace.
- The owner brain is a separate namespace and requires an explicit grant per
  resident and source.
- Retrieved text is untrusted reference material and cannot change tools,
  permissions, routing, signing, runtime, model, or system instructions.
- Same-resident cognition uses the resident's exact configured runtime and
  model. No substitution or impersonation is allowed.
- Messaging, cancellation, permissions, restart recovery, and final publication
  remain usable when continuity is disabled, locked, corrupt, slow, or absent.
- Private bodies and keys never appear in logs, receipts, relay events, child
  environments, or body-free metadata.

## Delivery discipline

- Freeze contracts and deterministic fixtures before frontend implementation.
- Codex owns protocol, encryption, storage, runtime integration, Tauri commands,
  and native acceptance.
- Claude may own React/CSS and visual fixtures inside the boundaries in
  `FRONTEND_INTEGRATION_HANDOFF.md`.
- A shared file has one writer at a time. Do not merge a design branch wholesale.
- Run focused checks while building. Run the expensive full repository and
  installed-native gate once per release after focused checks and visual review.
- A release is complete only after the installed macOS app passes its acceptance
  demonstration; source tests alone are insufficient.
