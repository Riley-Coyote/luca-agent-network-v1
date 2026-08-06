# Luca V1 Functional Beta build control

Status: V1B.0 in progress  
Branch: `agent/v1-functional-beta`  
Baseline: `dc1c2e63891ab0a53b2c4c948e0e7eed801d6f89`

This directory is the active implementation authority for the functional beta.
The completed G1 evidence and accepted G2.1/G2.2/T01-T03D work remain valid
inputs. `docs/luca/continuity-g2/` is the long-range continuity roadmap, not the
active beta task graph.

## Read order

1. `00_START_HERE.md`
2. `V1B_BUILD_SPEC.md`
3. `TASK_GRAPH.yaml`
4. `ACCEPTANCE_V1B.md`
5. `DECISION_LEDGER.md`
6. `RUN_LOG.md`

## Product boundary

The beta is a dependable personal home for native agents. Hermes and OpenClaw
remain authoritative for their own profiles, workspaces, tools, credentials,
projects, and native memory. Luca adds stable cryptographic identity, signed
conversation history, and one small encrypted resident-authored handoff.

There is no conductor. Messaging must keep working when continuity is disabled,
locked, absent, corrupt, slow, or unavailable.

## Execution discipline

- Preserve the dirty `agent/continuity-g2` worktree unchanged.
- Preserve native configuration and credentials byte-for-byte.
- Run focused checks during implementation and the full repository/native gate
  once at V1B.4.
- One focused implementation attempt and one evidence-based repair per failure.
- Never claim native memory, tool, or session parity that the runtime does not
  expose and the installed app has not demonstrated.
- Receipts contain body-free commands and results only.

