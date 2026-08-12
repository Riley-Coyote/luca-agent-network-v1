# Luca integration and release protocol

## 1. Task admission

Program admits a task only when its dependencies are terminally passed and its
capsule records objective, exact branch/worktree/SHA, owned and forbidden
paths, frozen interfaces, acceptance, evidence path, reviewer, repair limit,
and intended terminal status. `PROGRAM_GRAPH.yaml` supplies the durable
baseline; the task receipt narrows it.

No team begins a source change from chat-only instructions.

## 2. Branch discipline

- Team branches start from the exact approved control commit recorded after PC-G0;
  that commit must descend from audited product base `f1f1eb3` and contain
  documentation/status changes only.
- One bounded task commit owns named files. Evidence remains uncommitted until
  Program intentionally curates it.
- Teams do not merge each other, the canonical integration branch, or dirty
  worktree material.
- Teams report exact SHAs; branch names alone are insufficient because two
  independent local Git registries exist.
- Product teams never commit directly to
  `codex/conversation-communication-integration`.

## 3. Ready-for-review receipt

A team marks a commit ready only when:

1. the diff contains only owned or leased files;
2. focused formatting, lint/typecheck, unit, and relevant E2E checks pass;
3. authority/privacy negative tests pass where applicable;
4. evidence is redacted and scanned;
5. the team report names risks and unresolved limitations;
6. an independent reviewer returns PASS;
7. the exact commit is unchanged after review.

The team may say `source_tested`; it may not say integrated or installed.

## 4. Review and repair

Review verdicts are PASS, FAIL, or NEEDS_REPAIR. A failed task gets at most one
evidence-based repair within its original scope, followed by independent
re-review. A second repair or scope expansion returns to Program for a new task
or blocked decision. Reviewers do not silently fix the implementation they
review.

## 5. Shared-file resolution

Program issues one writer lease at a time. The owning team proposes the
semantic change; affected teams review it. Program applies or delegates the
smallest registration/adapter diff. Conflicts that change a frozen interface
require a decision-ledger entry before resolution.

## 6. Integration train

Program creates `codex/p0-integration-train` only after PC-G1. It integrates exact
ready commits in the order in `WAVE_PLAN.md`, using cherry-pick or a deliberately
reviewed bounded merge. After each carriage:

- inspect the staged/named diff;
- run the focused checks for the affected seam;
- record conflicts and resolution ownership;
- confirm prior receipts still refer to unchanged source or mark them stale.

No blanket merge, bulk staging, wholesale onboarding merge, or wholesale
`agent/vision-demo` merge is allowed.

## 7. Candidate freeze

When all P0 carriages pass, Program records the exact train SHA and creates
`codex/p0-release-candidate`. Product source freezes. Security and QA run the
complete matrix and one formal `just ci` on that exact SHA. A repair produces a
new SHA and restarts candidate verification; evidence never floats between
commits.

## 8. Status promotion authority

| Promotion | Required authority and evidence |
|---|---|
| `planned` → `implemented_in_source` | Team lead; named diff on exact SHA |
| `implemented_in_source` → `source_tested` | Independent reviewer; focused receipts |
| `source_tested` → `integrated` | Program; accepted integration-train SHA |
| `integrated` → `verified_in_installed_application` | Program + independent QA/Security; signed installed receipt |
| `verified_in_installed_application` → `release_complete_and_pushed` | Riley/Program; canonical remote SHA/tag and reproducibility receipt |

Team reports may preserve a narrower source-tested foundation while the broader
epic remains planned.

## 9. Evidence protocol

- Team report: `docs/luca/program-control/team-reports/<team>.yaml`.
- Task receipt: `docs/luca/program-control/task-receipts/<task>.yaml`.
- Raw redacted evidence: `evidence/program-control/<task>/`.
- Raw evidence contains no secrets, protected bodies, or absolute local paths.
- Reports may include the exact worktree coordinate required for coordination.
- Logs identify command, exit code, environment version, commit, and timestamp.
- Screenshots identify state, viewport, commit, and subject; distinct states must
  have distinct image hashes.
- Use repository evidence templates/scanners and run the applicable Luca
  contract validator before review.

## 10. Release and publication

After PC-G4, Riley confirms the final release branch name. Program promotes the
exact candidate, pushes without force, records remote SHA/tag, builds from a
clean published coordinate, signs and deep-verifies the app, installs it under
one unambiguous tester name, launches it, and records executable hash and
profile/relay identity. Program then updates status, backlog, handoff,
dashboard, and graph.

Nothing is release-complete if source is only local or the installed bundle
cannot be tied to the published commit.
