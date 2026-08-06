# Luca V1.1-V1.3 roadmap control

Status: V1.1 backend implementation active

Implementation branch: `agent/v1.1-resident-notebook`

Product baseline: `36472636af120cb3213dcae84b3ff5827a7c8e93`

The accepted functional-beta implementation and evidence live under
`docs/luca/functional-beta/`.

This directory is the implementation authority for the next three incremental
continuity releases. It deliberately replaces the breadth of the original G2
task graph with three bounded product slices. The original
`docs/luca/continuity-g2/` package remains the long-range roadmap and evidence
archive; it is not the active task graph for V1.1-V1.3.

## Read order

1. `00_START_HERE.md`
2. `PRODUCT_CONTRACT.md`
3. `V1_1_BUILD_SPEC.md`
4. `V1_1_FROZEN_INTERFACES.md`
5. `ROADMAP.md`
6. `ARCHITECTURE_CONTRACTS.md`
7. `TASK_GRAPH.yaml`
8. `ACCEPTANCE.md`
9. `FRONTEND_INTEGRATION_HANDOFF.md`
10. `DEMO_SCENARIOS.md`
11. `DECISION_LEDGER.md`
12. `RUN_LOG.md`

## Three-release promise

- **V1.1 — Resident Notebook and Living Journal:** retain selective,
  source-backed continuity notes and add manually requested Markdown pages
  authored by the resident. Journal pages never become automatic chat context.
- **V1.2 — Scoped Brain Sources:** let the owner add a narrow local corpus and
  grant read-only recall to specific residents with visible provenance.
- **V1.3 — Resident Reflection:** let a resident intentionally review and
  consolidate its own notebook through its exact configured runtime and model.

These releases do not add a conductor, scheduled inner life, proactive outreach,
automatic personality evolution, broad imports, or background agent society.

## Backend-first sequence

Riley explicitly chose to continue the V1.1 backend while Claude's frontend
work remains isolated. Protocols, view models, and deterministic fixtures are
frozen first. Accepted frontend work is integrated only after the backend gate;
the installed release gate remains pending until that integration is complete.

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
