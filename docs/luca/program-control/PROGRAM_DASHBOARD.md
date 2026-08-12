# Luca program dashboard

Snapshot: 2026-08-12

Control baseline: `f1f1eb3`

Program state: **PC-G0 passed; team worktree initialization authorized**

## P0 outcome

Produce one honest tester release that combines production onboarding, complete
communication parity, unified project/resident/source creation, and installed
Agent Forge acceptance, then publish one canonical source line and install one
unambiguously named signed application.

| Workstream | Current truth | Next gate | Owner |
|---|---|---|---|
| Program control | `source_tested` on exact commit `63900cd2…` | Initialize five team worktrees | Program Integration & Release |
| Production onboarding | Source-tested input is unmerged | Reconciliation plan, then combined source | Experience & Onboarding |
| Communication parity | Secure send foundation integrated; broad parity planned | Frozen operation contracts | Communications & Collaboration |
| Unified creation | Basic creation integrated; unified flow planned | Creation/grant contract freeze | Projects, Brain & Connections |
| Agent Forge | Source-tested; installed provisioning matrix open | Disposable signed native acceptance | Agent Platform |
| Canonical release | Fragmented and local | P0 integration train and unchanged-commit release gate | Program Integration & Release |

## Team activation

| Team | On approval | Product writes | Blocked on |
|---|---|---|---|
| Program Integration & Release | Active immediately | Control docs and integration-only files | Riley approval before train activation |
| Experience & Onboarding | Start immediately, read-only | After conflict map and shared-shell lease | `IF-01`, onboarding reconciliation plan |
| Communications & Collaboration | Start immediately | Disjoint communication contracts/native modules after freezes | Shared shell and registries remain leased |
| Projects, Brain & Connections | Start immediately with contracts/fixtures | Disjoint project/Brain UI after freezes | Onboarding shell seams and grant invariants |
| Agent Platform | Start immediately, acceptance-first | Only an evidence-backed repair after failed native acceptance | Signed disposable test setup |
| Clients & Creative Surfaces | Read-only preparation | No P0 product code | P0 release candidate |

## Critical path

`Approval → interface freeze → onboarding reconciliation → shared-shell tail →`
`P0 candidate integration → unchanged-commit security/QA → canonical push →`
`signed tester install`

Communication native contracts, project fixtures, and Forge acceptance run in
parallel before they join the critical path. Communication activation and
project membership/grant work cannot bypass the security freezes.

## Release gates

| Gate | Pass condition | Status |
|---|---|---|
| PC-G0 Control approval | Graph, charters, ownership, prompts approved | Passed |
| PC-G1 Contract freeze | Shared interfaces versioned; no unresolved overlap | Waiting |
| PC-G2 Team source receipts | Focused checks and independent reviews on exact commits | Waiting |
| PC-G3 Integrated candidate | All P0 commits merged through the train; no unresolved P0/P1 finding | Waiting |
| PC-G4 Installed candidate | Clean/upgraded profiles, native runtimes, restart, privacy, accessibility pass | Waiting |
| PC-G5 Release | Canonical branch pushed and signed tester app tied to same commit | Waiting |

## Highest risks

1. Onboarding changes overlap 88 files and the newer conversation/project shell.
2. Communication activation can create causal loops or false delivery claims.
3. Project membership can accidentally become filesystem or Brain authority.
4. Shared registries and app-shell files can produce silent cross-team drift.
5. Forge acceptance may mutate native runtime state unless disposable fixtures
   and before/after hashes are enforced.
6. Two independent local Git registries make branch names alone insufficient;
   every report must include exact repository path, branch, and SHA.

## Approved PC-G0 decisions

- The operating system and five team worktrees are approved after the bounded
  release-name and CTRL-001 sequencing corrections.
- The combined tester release branch is `luca/v1-beta`.
- Team worktree creation is approved. Product implementation, shared-file
  writes, the P0 integration train, and deferred P2/P3 work remain unapproved.
