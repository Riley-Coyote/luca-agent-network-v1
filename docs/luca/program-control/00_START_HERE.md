# Luca program control — start here

Updated: 2026-08-21

> **Active override:** Riley authorized the consolidation program on
> 2026-08-21. `CONSOLIDATION_PLAN.md` and `CONSOLIDATION_LEDGER.yaml` supersede
> the historical branch coordinates and activation state below while retaining
> this package's evidence, ownership, exact-SHA, review, and stop rules.

This package controls the next Luca delivery sequence. The governing order is:

1. complete the visible, functional product;
2. build Mnemos felt continuity and identity on that working product;
3. add optional production/security hardening only where it remains useful.

The historical package was documentation and status only. The active override
authorizes only the bounded consolidation lanes and train described in
`CONSOLIDATION_PLAN.md`; it does not authorize unrelated product work.

## Current consolidation coordinate

- Train: `codex/v1-beta-consolidation`
- Train worktree: `/Volumes/LaCie/Luca-Development/worktrees/luca-v1-beta-consolidation`
- Starting source: `codex/visits` at `9c9ef0df48ed5a45b2a17a136a94c8cdb7cdf048`
- Candidate proof branch: `luca/v1-beta`
- Integrated release authority after proof: `luca/v1.1`
- Rollback ref: `origin/archive/luca-v1.1-pre-consolidation-2026-08-21`
- Large build root: `/Volumes/LaCie/Luca-Development/build/consolidation/`

The consolidation ledger records each exact source, candidate, review, gate,
installed bundle, promotion, and rollback coordinate.

## Read order

1. `PROGRAM_CHARTER.md`
2. `PROGRAM_DASHBOARD.md`
3. `PROGRAM_GRAPH.md` and `PROGRAM_GRAPH.yaml`
4. `ACCEPTANCE_MATRIX.md`
5. `TEAM_CHARTERS.md` and `OWNERSHIP_MAP.md`
6. `INTERFACE_FREEZES.md`
7. `WAVE_PLAN.md`
8. `INTEGRATION_PROTOCOL.md`
9. `RISK_REGISTER.md` and `SECURITY_QA_TOPOLOGY.md`
10. `MODEL_ROUTING.md`
11. `TEAM_KICKOFF_PROMPTS.md`
12. `DECISION_LEDGER.md` and `RUN_LOG.md`
13. `docs/luca/program-status/00_START_HERE.md`

## Task categories

Every graph task has exactly one category:

- `product requirement`
- `existing architectural constraint`
- `recommended safety measure`
- `optional hardening`
- `deferred enhancement`

The category is a prioritization rule. A recommended safety measure may be
necessary for a usable beta; optional hardening may not displace a visible
product requirement.

## Delivery states

1. `planned`
2. `implemented_in_source`
3. `source_tested`
4. `integrated`
5. `verified_in_installed_application`
6. `release_complete_and_pushed`

No task can become `source_tested` until its source is committed and its named
validators pass on that exact commit. Team branches may claim at most
`source_tested`; Program alone may claim integration, installed verification,
or release completion.

## Current gate

Wave 0 is active. Local-only production candidates are preserved remotely, the
train starts from the reviewed visits head, dirty worktrees remain frozen, and
new feature development remains paused. Artifact Canvas may not enter the train
until its native GA5 verdict is `PASS` on an exact SHA.
