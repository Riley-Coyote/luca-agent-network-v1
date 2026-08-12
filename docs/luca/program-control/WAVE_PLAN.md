# Luca branch, worktree, and wave plan

## Proposed coordinates — all inactive

No row except Program control exists as an activated delivery worktree. The
five team branches/worktrees may be created only after CTRL-004 records Riley's
approval on a final exact control commit. The integration train and release
worktrees remain later gates.

| Owner/train | Proposed branch | Proposed worktree | Required base |
|---|---|---|---|
| Program control | `codex/program-control` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-program-control` | Existing audited descendant |
| Experience & Onboarding | `codex/team-experience-onboarding` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-experience-onboarding` | Exact Riley-approved control commit |
| Communications & Collaboration | `codex/team-communications-collaboration` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-communications-collaboration` | Exact Riley-approved control commit |
| Projects, Brain & Connections | `codex/team-projects-brain-connections` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-projects-brain-connections` | Exact Riley-approved control commit |
| Agent Platform | `codex/team-agent-platform` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-agent-platform` | Exact Riley-approved control commit |
| Clients & Creative Surfaces | `codex/team-clients-creative-surfaces` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-team-clients-creative-surfaces` | Exact Riley-approved control commit |
| Functional-beta integration train | `codex/p1-p3-integration-train` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-p1-p3-integration-train` | Exact accepted P1/P2 team commits; do not create at team activation |
| Functional-beta release candidate | `codex/v1-beta-release-candidate` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-v1-beta-release-candidate` | Accepted unchanged train SHA |
| Canonical tester release | `luca/v1-beta` | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-release-v1-beta` | Accepted installed candidate after Riley promotion approval |

## Wave 0 — P0 control truth

1. Commit the documentation-only revision with CTRL-003 still
   `implemented_in_source`.
2. Run every control validator against that exact commit.
3. Record exact results and promote CTRL-003 only after all pass.
4. Validate the final promotion commit without modifying it.
5. Ask Riley to approve or revise the P0–P5 graph (CTRL-004).

No teams, train, product implementation, or shared product writes occur in
Wave 0.

## Wave 1 — P1 messaging and A2A

After CTRL-004, create the five team worktrees from the same exact approved
control commit and initialize reports from the template. Begin with read-only
source reconciliation and file-level task capsules.

Communications closes P1 by reuse order:

1. prove existing owner/resident DM, group, reply, mention, search, unread,
   attachment, reaction, edit/delete, room, membership, feed, and Inbox paths;
2. reconnect hidden/disconnected human functionality in Luca presentation;
3. add thin managed-agent adapters for missing operations;
4. add the smallest explicit mention/invite activation seam needed for visible
   A2A;
5. prove Direct mode, cancellation, restart, offline, duplicate, and
   exactly-once behavior.

No generalized receipt system, resident Inbox architecture, causal graph,
Guarded/Restricted mode, or NIP-17 work is activated.

## Wave 2 — P2 product experience

Safe disjoint lanes may run after CTRL-004:

- Experience reconciles onboarding and owns combined shell/accessibility UX.
- Agent Platform closes native import, creation, lifecycle, Library, Settings,
  runtime health, and MCP presentation.
- Projects closes unified creation, sources/Brain Setup, details/recovery, and
  project-room navigation.
- Clients verifies pairing presentation and compact client-consumer contracts.
- Communications lands Inbox/Activity and messaging UI tails only under shared
  file leases.

P2 integration waits for a frozen P1 communication acceptance commit when a
shared timeline/sidebar surface depends on it.

## Wave 3 — P3 integration and installed beta

Program creates the train only after all required P1/P2 tasks are
`source_tested`. Ordered carriages:

1. onboarding/current shell;
2. native agent lifecycle and settings;
3. project/source domain and navigation;
4. communication adapters and activation;
5. Inbox/Activity and shared presentation tails;
6. minimal Program-owned registrations/adapters;
7. status, evidence, and demo language.

After focused and full gates pass on one train SHA, create the release
candidate, freeze source, build/sign/install, and run the complete real-agent
demo. Any source repair creates a new candidate and reruns the installed gate.
Promotion to `luca/v1-beta` requires Riley approval.

## Wave 4 — P4 Mnemos continuity

Build on the accepted functional beta. Start with native identity document
loading and exact-runtime authorship, then handoffs, notes/notebooks/journal,
reflection, hypomnema, provenance/revisions/corrections, fail-soft behavior,
and richer creative notebooks. Continuity remains supplemental to conversation.

## Wave 5 — P5 optional work

Each security-hardening or deferred-expansion task needs separate Riley
activation, its own contract, and evidence that it does not regress Direct-mode
usability or the functional beta. P5 is not a bundled backlog dump.
