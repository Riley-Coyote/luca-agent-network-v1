# Luca integration protocol

## Activation

CTRL-004 must record Riley's approval before any product team worktree exists.
After approval, Program creates all five team branches from the same exact
control commit and initializes each report from
`team-reports/TEMPLATE.yaml`. Creating teams does not create the integration
train and does not authorize shared-file writes.

## Task capsule

Before a write, Program records:

- task ID/category/milestone and dependency proof;
- repository/worktree/branch/base/full HEAD;
- exact owned and forbidden files;
- consumed freezes and any shared-file lease;
- focused tests and acceptance rows;
- reviewer, evidence paths, and one bounded repair allowance.

## Reuse-first review

For every visible capability, the team reports one classification before code:

1. functional;
2. hidden or disconnected;
3. reusable with Luca presentation;
4. thin managed-agent adapter required;
5. genuinely missing.

A new domain, protocol, store, receipt system, or approval layer must show why
the existing operation cannot satisfy the accepted visible requirement.

## Commit and status rules

- One bounded task commit at a time; no broad staging.
- Team commits may reach `source_tested` only after named tests pass on that
  exact commit.
- Program reviews ancestry, scope, diff, status, evidence, interface drift, and
  security/QA findings before accepting a commit manifest.
- Team status never becomes integrated/installed/released by assertion.

## Commit-coordinate validation classes

- **Candidate integration commits:** must be ancestors of the selected
  integration or release coordinate before any integrated claim.
- **Historical source/reference commits:** must exist as exact commits, remain
  reachable from their recorded branches, retain their recorded role/title,
  and be content-auditable. They do not need to be ancestors of the control,
  integration, or release branch and are never made integrated by reference.

`f27bbce4d0366116ba34ad284eabceb35ed81dac` is a `reference_only`
historical program-status source on `codex/communication-parity`; its eight-file
content inventory is recorded in `PROGRAM_GRAPH.yaml`.

## Integration train

Program creates `codex/p1-p3-integration-train` only after all required P1/P2
team gates. Commits are cherry-picked/replayed in the order in `WAVE_PLAN.md`;
blanket branch merges are disallowed. A semantic conflict returns to the owner;
Program may write only a minimal recorded adapter.

Focused checks run after each carriage. Full repository checks run on the
assembled train. Any failure creates a new task/repair commit and a new train
candidate.

## Installed candidate

The release-candidate branch starts at the accepted train SHA. Product source
is frozen. QA builds/signs/installs and records source SHA, bundle ID,
signature, executable hash, launch receipt, profile type, real runtime, and
acceptance evidence. Any source change invalidates all installed proof.

## Evidence

- Team report: `docs/luca/program-control/team-reports/<team>.yaml`
- Task receipt: `docs/luca/program-control/task-receipts/<task>.yaml`
- Raw redacted evidence: `evidence/program-control/<task>/`

Evidence must omit secrets, protected message/continuity bodies, credentials,
and absolute local paths. Status documents may record exact source/worktree
coordinates where required for reproducibility.

## Stop conditions

Stop the affected activation/integration immediately on unknown required
candidate ancestry, missing/unreachable/mismatched historical reference,
dirty or mismatched worktree, unexpected path, missing dependency, validator
failure, interface drift, secret/body leak, duplicate final publication,
native-config mutation, implicit authority, or source/bundle mismatch.
