# Luca program reconciliation log

## Scope

The audit answered four different questions for every item:

1. Was it discussed?
2. Was a durable plan or contract written?
3. Was product source implemented and integrated?
4. Was the behavior verified in the installed signed app?

Those questions were intentionally not collapsed into one “done” flag.

## Sources inspected

- the six task IDs supplied by Riley;
- the current main Luca build task;
- additional root tasks found by searching Codex session metadata/content for
  Luca repository coordinates;
- root Git worktrees, branches, ancestry, logs, and remote tracking state;
- functional-beta, V1.1, V1.2, V1.2.1, G2.0–G2.2, Settings, Agent Library,
  project-navigation, Operator Forge, and communication verdicts/handoffs;
- the current communication acceptance matrix;
- the divergent onboarding branch;
- installed-app paths and recorded executable hashes;
- the dirty primary checkout's untracked Unified Brain, Artifact, mobile,
  design, and evidence material.

## Session discovery method

Codex session files were searched for the repository name and relevant
worktree/branch coordinates. Results were filtered to root user tasks. Subagent
lanes, generated Luca resident/continuity turns, and unrelated repositories
were excluded. This found the Unified Brain and original main build tasks that
were absent from the supplied list.

## Contradictions resolved

### “Communication complete” versus acceptance

The integrated branch and signed app prove the secure communication foundation.
They do not implement or prove every operation in the original parity plan.
The unchecked acceptance matrix and explicit cross-session handoff are the
controlling evidence. Status: `INTEGRATED_SOURCE`, not full parity.

### “Installed rebuild deferred” versus promoted signed app

The integration receipt contains stale wording in its deferred section. Later
sections and evidence commit `5cd754e` record the signed branch-specific app,
installed hash, relaunch, relay health, and protected native-state hashes.
Status: installed promotion occurred.

### Formal G1 incomplete versus later beta verdicts

Older `HANDOFF.md` and G1 checklist text predates later candidate review and
functional-beta/native acceptance. The runtime foundation should not be
retested from zero unless source drift invalidates a specific proof. Status:
historical G1 documentation is stale; current capability status is derived from
later exact verdicts.

### G2 acceptance rows versus later beta releases

The original G2 task graph was intentionally narrowed into Functional Beta and
V1.1–V1.2.1. Some G2.3 concepts are now shipped through handoff/Notebook/Brain,
while the original broad G2.3–G2.6 matrices remain unclaimed. Status: partially
superseded, not wholly complete or wholly absent.

### Project creation versus unified project flow

Basic project creation, first-room creation, and existing Brain source linking
are integrated. The later unified flow—source picker, resident choice/creation,
empty states, later editing, and broader access requests—was designed but not
finished. Status: basic creation built; unified flow `NOT_STARTED`.

## Confidence and limitations

High confidence:

- Git ancestry and branch divergence;
- exact verdicts tied to commits and installed hashes;
- communication acceptance omissions;
- onboarding branch being unmerged;
- untracked artifact/mobile packets existing outside the integration branch.

Medium confidence:

- whether every exploratory visual artifact should eventually ship;
- exact prioritization among mobile, artifacts, connectors, and V1.3;
- whether hidden Buzz product surfaces should remain permanently closed.

Those are product choices, not missing evidence. The backlog keeps them
separate from required beta repairs.

## Maintenance rule

When a task changes state:

1. update `STATUS_LEDGER.yaml`;
2. update the matching row in `MASTER_STATUS.md`;
3. attach exact commit/test/installed evidence;
4. move or close the corresponding `BACKLOG.md` item;
5. never mark a broad capability complete from a narrower sub-slice.
