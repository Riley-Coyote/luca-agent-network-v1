# Swarm Operating Model and Recursive Verification

## Operating shape

The build uses one persistent Sol-high lead plus at most three active workers.
Spawn depth is one. Ultra is never the ambient build mode: it receives a compact
evidence package only for an explicit milestone-gate verdict. Parallelism is
used for disjoint implementation, tests and review—not for unbounded recursive
planning.

| Role | Default model/effort | Responsibility |
|---|---|---|
| Persistent lead/integrator | Sol, high | sequencing, shared-file integration, compact dispatch and escalation |
| Authority/protocol worker | Sol, high | only the 25 frozen key, policy, egress, concurrency and restore tasks named in the graph |
| Implementation worker | Terra, medium/high | 53 bounded delivery, migration, fixture and release tasks |
| Independent reviewer | Terra, high | 26 executable review/proof tasks plus per-task adversarial review, with no implementation ownership |
| Gate judge | Sol, Ultra | seven short post-G0 verdicts from compact diffs, receipts and open findings |

Terra may implement a critical task only when the complete contract, owned
paths, vectors and objective tests are frozen in its capsule. It never invents
cryptography, key custody, authorization, event kinds, IPC trust, migrations,
causal budgets, checkpoint state or canonical ownership. Any contradiction
returns to the Sol-high lead before more code is written.

## Cost-optimized session budget

Task IDs remain the evidence unit; the following are the context/session unit.
Each milestone uses at most one Terra delivery session, one Sol authority
session when that milestone has a named Sol task, and one independent Terra
review session. The review session reviews every high/critical implementation
receipt in that milestone and also executes the named review/proof task IDs in
the table; it owns no implementation diff. G0 is already complete.

| Milestone | Terra delivery session | Sol authority session | Independent review session | Ultra gate |
|---|---|---|---|---|
| M1 | Terra-routed non-review F tasks | `F13 F14 F19` | `F11 F16 F17 F12` | G1 |
| M2 | Terra-routed non-review C tasks | `C02 C15 C13 C07` | `C10 C11 C14 C12` | G2 |
| M3 | Terra-routed non-review B tasks | `B02 B05 B06 B21 B23 B10 B14 B15` | `B11 B19 B17 B18` | G3 |
| M4 | Terra-routed non-review R tasks | `R02 R03 R04 R06` | `R08 R09` | G4 |
| M5 | Terra-routed non-review P tasks | `P01 P12 P06` | `P10 P11` | G5 |
| M6 | Terra-routed non-review L tasks | `L03 L04 L05` | `L08 L09 L10` | G6 |
| M8 | Non-human Terra-routed non-review D tasks | none | `D01 D03 D05 D06 D07 D08 D10` | G8 |

This is 20 future lane sessions plus seven bounded Ultra gate sessions, not 112
new agent conversations. Within a session, the lead releases one compact task
capsule at a time and the worker returns the task's separate result/review
receipt before receiving the next capsule.

## Worktree and ownership rules

1. Lead creates one worktree/branch per write lane.
2. Every task capsule names owned files, forbidden shared files, dependencies,
   acceptance and evidence path.
3. Only the lead/integrator edits workspace manifests, lockfiles, database
   migrations, event registries, global protocol schemas and release identity.
4. Workers never clean or reset unrelated changes.
5. One bounded commit per task; no opportunistic refactor.
6. Integration order follows `TASK_GRAPH.yaml`, not completion time.
7. A worker that discovers a contract conflict stops its write, records evidence
   and returns a decision request. It does not invent a new architecture.

## Compact task capsule

Each worker receives only:

```text
Task ID and one-sentence objective
Frozen decisions/invariants (maximum 10 bullets)
Exact source references needed for this task
Owned and forbidden file globs
Required tests/evidence
Dependencies already proven
Stop/escalation conditions
```

Do not send the complete planning kit to every worker. The lead extracts the
relevant contract sections and requires the worker to return:

```text
status: complete | blocked | needs_decision
commit: <sha or none>
changed: <short file list>
verified: <commands and pass/fail>
evidence: <paths>
risks: <maximum five bullets>
```

Raw logs stay in evidence files rather than being repeated through agent
context.

## Parallel waves

Each wave is sub-scheduled to at most three workers plus the lead. The bullets
name logical lanes, not simultaneous slots.

### Wave A - M1 foundation

- Lead/integrator: F01-F02 and F13 shared protocol vectors.
- Shell lane: F03-F07.
- Security/runtime lane: F08, then F14 signing broker and F19 protected owner
  recovery before F09/F15/F16.
- Quality reviewer: F11, F16-F17 and F12 after integration.

### Wave B - Capsule and service foundations

- Capsule lane: C01, C03-C04.
- Relay lane: C16 migration, then C13-C14 managed conditional coordinator.
- Brain lane: B01, B04, B07 plus B20 packaging and B21/B23 overlay/snapshot.
- Integrator/security: C02, B02, B24 then B05-B06.
- Runtime lane joins at C05-C06 and B15 only after contracts freeze.

### Wave C - Brain, rooms and checkpoint

- Ingestion/brain: B08-B13.
- Security/runtime: B14-B15 and fault matrix.
- Rooms: R01, R10 migration, then R02-R07, with R06 waiting on B15.
- Checkpoint: P13 migration then P01-P05 can begin after Capsule gate; P12 owns
  guarded provider dispatch, and P06-P10 wait on signer, service and fast-head
  contracts.

### Wave D - Identity backup/restore and release

- Backup crypto/schema: L01-L02, L11 migration, then L03-L04.
- Integrator: L05.
- UX/relay: L06-L07.
- Independent security/proof: L08-L10.
- Release lanes D03-D06 run in parallel against the same installed candidate;
  D07-D12 remain gated.

## Recursive verification loop

Every implementation task uses this bounded loop:

```text
frozen objective
  -> implementation
  -> focused tests
  -> evidence capture
  -> independent review for high/critical risk
  -> repair cycle 1
  -> focused + regression tests
  -> repair cycle 2 if necessary
  -> complete or lead decision
```

The implementer does not review its own critical security claim. A reviewer
checks both code and executable evidence, then categorizes findings:

- P0/P1: gate remains closed; repair required.
- P2: repair now unless explicitly accepted in known limits.
- P3: record for later; cannot contradict an acceptance claim.

After two failed repair cycles, the lead narrows the task, changes the approach,
or records a written decision. Agents do not loop indefinitely.

## Gate-level recursion

At every milestone:

1. Integrator assembles the exact candidate commit.
2. Verification lane reruns focused and upstream regression suites.
3. Independent reviewer receives the frozen contracts, diff, evidence index and
   attack checklist—not the implementer's narrative.
4. Lead reconciles every finding to a commit or written accepted limitation.
5. Reviewer reruns only affected proofs plus the milestone smoke set.
6. Lead publishes pass/fail with immutable commit and evidence hashes.

No milestone is passed by consensus language. It passes through artifacts and
observed behavior.

## Token-efficiency controls

- Exact source maps prevent repeated archaeology.
- Contracts freeze judgment before parallel writing.
- Task capsules replace full-history prompts.
- Raw outputs go to files; agents return structured summaries.
- Deterministic fixtures replace repeated live exploratory testing.
- Targeted suites run before full suites; full suites run only at gates.
- Reviewer prompts contain diffs and claims, not entire repositories.
- Failed approaches are recorded once in the evidence index so later agents do
  not repeat them.
- The persistent lead stays at High; no routine orchestration token is spent at
  Ultra.
- One milestone worker identity consumes sequential compact capsules instead of
  reopening the repository for every task.
- Terra gets one focused repair cycle. Sol escalation occurs only after an
  objective failure or contract conflict; Ultra is a gate verdict, not a repair
  worker.

These controls reduce duplicated reading and reasoning without reducing test,
security or product quality.
