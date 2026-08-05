# Luca G2 continuity build control

Status: G2.0 PASS; G2.1 implementation authorized  
Branch: `agent/continuity-g2`  
Approved baseline: `4781dca6`  
Product authority: Riley's approved G2 plan, captured in this directory

This directory is the active execution authority for G2. The completed source
audit in [`../continuity-audit`](../continuity-audit/README.md) is immutable
source evidence. The older `.codex/luca-v1` M2 material is useful supporting
design history, but it is not the active task graph.

## Read order

1. This file.
2. [`G2_BUILD_SPEC.md`](G2_BUILD_SPEC.md).
3. [`DECISION_LEDGER.md`](DECISION_LEDGER.md).
4. [`TASK_GRAPH.yaml`](TASK_GRAPH.yaml).
5. [`ACCEPTANCE_G2.md`](ACCEPTANCE_G2.md).
6. [`RUN_LOG.md`](RUN_LOG.md).
7. [`G2_0_VERDICT.md`](G2_0_VERDICT.md).
8. The relevant receipt under [`receipts/`](receipts/README.md).

Before changing product code, run:

```bash
. ./bin/activate-hermit
python3 scripts/luca/validate_g2_control.py
git status --short --branch
```

## Non-negotiable boundaries

- Buzz/Luca signed events remain canonical conversation chronology and
  authorship. Resident public keys remain canonical identity.
- There is no conductor. The owner talks directly to residents in DMs and
  multi-agent rooms.
- Chat, final publication, cancellation, and permission handling must work when
  continuity is locked, absent, corrupt, slow, or disabled.
- Resident-private continuity never crosses residents. Room membership never
  grants memory access. Owner-brain access requires a persisted grant.
- Retrieved and imported content is untrusted reference material and cannot
  alter tools, permissions, routing, signing, or system instructions.
- Private continuity may update automatically with full revision history and
  rollback. Owner-shared brain writes are proposals only.
- Native Hermes/OpenClaw configuration and credentials remain read-only.
- Scheduled inner life is opt-in, bounded, disabled by default, and runs only
  while Luca is open (including sleep/catch-up rules in the spec).
- No source test, simulation, or browser-only proof is sufficient to claim G2.

## Execution discipline

- Advance one gate at a time: G2.0 through G2.6.
- At most three concurrent write lanes with disjoint ownership.
- Every task records dependencies, files, checks, evidence, reviewer, repair
  count, commit, and terminal status.
- Use focused tests during construction. Run the full repository/native gate
  once after focused checks and UX approval.
- After one evidence-based repair, an identical environment failure is recorded
  and escalated instead of retried in a loop.
- Reference repositories and live memory data are read-only. Tests use synthetic
  owners, residents, keys, memories, imports, and malicious fixtures.

## Gate sequence

| Gate | Outcome |
|---|---|
| G2.0 | Validated control plane and frozen contracts |
| G2.1 | Protocol/history parity and continuity-absent regressions |
| G2.2 | Encrypted local continuity kernel |
| G2.3 | Pre-turn continuity and durable post-publication metabolism |
| G2.4 | Universal brain, imports, grants, archive, and onboarding |
| G2.5 | Bounded scheduled inner life and proactive DMs |
| G2.6 | Installed-app acceptance and signed verdict |

G2 is complete only when every required acceptance row is backed by evidence
and G2.6 records an explicit PASS.
