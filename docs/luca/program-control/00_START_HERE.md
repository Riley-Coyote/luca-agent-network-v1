# Luca program control — start here

Updated: 2026-08-12

This package controls the next Luca delivery sequence. The governing order is:

1. complete the visible, functional product;
2. build Mnemos felt continuity and identity on that working product;
3. add optional production/security hardening only where it remains useful.

The package is documentation and status only. It does not authorize product
implementation, shared-file writes, team activation, an integration train, or
release publication.

## Current coordinate

- Branch: `codex/program-control`
- Worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-program-control`
- Audited ancestor: `f1f1eb3b135cae287c372c3210da635f324a1f81`
- Canonical integration source: `codex/conversation-communication-integration`
- Proposed combined tester release: `luca/v1-beta`
- Proposed release worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-release-v1-beta`
- Exact pre-promotion revised-control validation commit:
  `b63d7ca8f41f9c46e71c07dae364ab0aa4f70e8b`

The exact revised-control validation commit is recorded in `RUN_LOG.md` after
the documentation commit exists and every validator passes against that
commit. Riley approval of the revised graph remains a separate gate.

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

The prior control package and its corrected release name remain historical
facts. CTRL-003 is `source_tested` on the exact pre-promotion commit above.
Riley explicitly approved the revised graph and authorized CTRL-004 on
2026-08-12. The approval receipt passed the full validator set at exact commit
`7cc3bc54278eba8300b7c02bd94bd07a4b39e2f3`; CTRL-004 is `source_tested` and
team activation is authorized from that common base. Until the team worktrees
are created and verified:

- all five product teams are inactive;
- all proposed team worktrees and branches remain uncreated;
- the P1 integration train remains uncreated;
- no product code or shared product file may be written.
