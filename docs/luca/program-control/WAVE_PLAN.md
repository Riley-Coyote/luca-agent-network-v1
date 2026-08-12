# Luca wave plan

## Proposed branch and worktree topology

The five team branches below were approved at PC-G0 and must start from the
final validated control commit. The integration train and release-candidate
branches remain uncreated and gated.

| Team/train | Branch | Worktree | Base |
|---|---|---|---|
| Program control | `codex/program-control` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-program-control` | `f1f1eb3` |
| Experience | `codex/team-experience-onboarding` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-experience-onboarding` | approved control commit descending from `f1f1eb3` |
| Communications | `codex/team-communications-collaboration` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-communications-collaboration` | approved control commit descending from `f1f1eb3` |
| Projects | `codex/team-projects-brain-connections` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-projects-brain-connections` | approved control commit descending from `f1f1eb3` |
| Agent Platform | `codex/team-agent-platform` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-agent-platform` | approved control commit descending from `f1f1eb3` |
| Clients | `codex/team-clients-creative-surfaces` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-clients-creative-surfaces` | approved control commit descending from `f1f1eb3` |
| P0 integration train | `codex/p0-integration-train` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-p0-integration-train` | approved control commit descending from `f1f1eb3` |
| P0 release candidate | `codex/p0-release-candidate` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-p0-release-candidate` | accepted train SHA |
| Canonical P0 tester release | `luca/v1-beta` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-release-v1-beta` | accepted candidate; name approved at PC-G0 |
| P1 integration train | `codex/p1-integration-train` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-p1-integration-train` | exact P0 release; create only after P1 activation |
| P2 integration train | `codex/p2-integration-train` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-p2-integration-train` | exact accepted P1/P0 base; create only after P2 activation |

The integration target remains
`codex/conversation-communication-integration`. It is updated only after the
train passes PC-G3 and Riley approves promotion. `luca/v1-beta` is the approved
canonical combined tester-release branch.

## Wave 0 — Control and approval

- Build and validate this package.
- Riley approves or revises graph, ownership, freezes, topology, and prompts.
- Program creates the five team worktrees and team-report files.
- Program records one approved control commit; team and train branches start
  from that documentation-only commit so every session sees the same graph.
- No product code is written.

Exit: PC-G0 passes.

## Wave 1A — Parallel read-only and disjoint preparation

Starts immediately after PC-G0:

- **Experience:** read-only eight-commit reconciliation and 88-file conflict
  map. No product writes.
- **Communications:** freeze typed operation, receipt, activation, Inbox, and
  Activity contracts; may write tests/fixtures and disjoint protocol/native
  modules after each relevant freeze is approved.
- **Projects:** freeze creation transaction and grant invariants; may write
  deterministic fixtures and disjoint picker/detail components after approval.
- **Agent Platform:** prepare and run disposable signed Forge acceptance. No
  product repair unless a row fails and a repair capsule is approved.
- **Clients:** read-only mobile/artifact reconciliation. No product writes.
- **Program:** adjudicate interfaces, grant shared-file leases, and prepare the
  integration train without merging incomplete slices.

Exit: PC-G1 passes and every active task has a file-level capsule.

## Wave 1B — P0 implementation

Run safe lanes concurrently:

1. Experience reconciles onboarding on its branch.
2. Communications implements mutations, rooms/invitations, attachments, Inbox,
   and native activation in disjoint lanes; shared UI waits for the onboarding
   shell checkpoint.
3. Projects implements source entry repairs and unified creation domain logic;
   shared onboarding/shell connection waits for the checkpoint.
4. Agent Platform performs at most one evidence-driven Forge repair.
5. Security reviews authority-sensitive commits before they become ready.

Each task ends at `source_tested`; no team labels it integrated.

## Wave 2 — Shared-shell tails and team gates

- Experience publishes the reconciled shell checkpoint.
- Communications and Projects rebase or replay only their shared-UI tails onto
  that checkpoint under Program-issued leases.
- Teams close browser/native/installed acceptance applicable to their scope.
- Independent QA and Security publish PASS/FAIL/NEEDS-REPAIR verdicts.

Exit: all P0 team gates have exact ready commits and receipts.

## Wave 3 — Integration train

Program assembles commits in this order:

1. onboarding reconciliation;
2. communication native/protocol foundation and mutations;
3. unified project/source domain and UI;
4. communication shared UI, Inbox, Activity, and activation;
5. Forge repair, only if required;
6. minimal Program-owned adapters/registrations;
7. documentation and curated evidence.

Focused checks run after each carriage. Conflicts return to the owning team
unless the resolution is a documented minimal adapter. No blanket merges.

Exit: PC-G3 passes on one exact train SHA.

## Wave 4 — Unchanged-commit candidate and installed proof

- Create `codex/p0-release-candidate` from the accepted train SHA.
- Freeze product source.
- Run security, full QA, clean/upgraded profiles, Hermes/OpenClaw, restart,
  offline, accessibility, desktop/mobile-width, packaging, and evidence scans.
- Build/sign/install the candidate from that same SHA.
- Any source repair invalidates the candidate and restarts Wave 4 from a new SHA.

Exit: PC-G4 passes.

## Wave 5 — Publish

- Promote the candidate to the approved canonical release branch.
- Push the exact branch and required tags.
- Install one clearly named tester bundle and record bundle ID, source SHA,
  signature, executable hash, and launch receipt.
- Update program status and handoff.

Exit: both P0-REL-001 and P0-REL-002 reach
`release_complete_and_pushed`/installed proof as applicable.

## Later waves

- P1 may begin only after the P0 release, except read-only mobile architecture
  preparation that consumes frozen interfaces.
- P2 needs separate Program activation and a frozen contract per epic.
- P3/deferred work needs an explicit Riley reopen. Optional conductor work also
  needs all graph dependencies, threat-model review, and owner-role acceptance.

## Riley launch instructions

After approving PC-G0:

1. Create five new top-level Codex tasks, one per product team.
2. Paste the matching complete prompt from `TEAM_KICKOFF_PROMPTS.md`; do not
   combine prompts or ask one task to simulate multiple teams.
3. Keep this Program Lead task open as the permanent control center.
4. Tell teams to communicate only through exact commits, team reports, task
   receipts, and evidence paths; they may use up to three bounded subagents.
5. Return here for interface leases, merge decisions, blockers, and gate
   promotion. Team tasks must not coordinate merges among themselves.
