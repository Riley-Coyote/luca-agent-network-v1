# Luca program decision ledger

Decisions are append-only. Superseding a decision adds a new entry; it does not
erase the earlier rationale.

## PC-D001 — Audited program baseline

- Status: accepted
- Decision: program control is based on
  `f1f1eb3b135cae287c372c3210da635f324a1f81` from the canonical integration
  repository.
- Rationale: the user-opened checkout belongs to another Git registry and does
  not contain the audited commit.
- Consequence: product work targets
  `codex/conversation-communication-integration`; the dirty primary checkout is
  preserved as archaeology and user-owned material.

## PC-D002 — General substrate over mandatory workflow

- Status: accepted
- Decision: build identity, projects, rooms, messaging, permissions, Brain,
  files, artifacts, Activity, Inbox, provenance, recovery, and auditability as
  general primitives. Goals, plans, roles, rituals, and work decomposition are
  composed by people and agents.
- Consequence: task graphs and autonomy templates are optional artifacts, not
  mandatory state for every project.

## PC-D003 — Optional conductor reopened

- Status: accepted; long-range only
- Supersedes: treating all conductor behavior as hidden or rejected.
- Decision: a conductor may be implemented later as an ordinary,
  cryptographically identified project role with explicit owner grants.
- Constraints: no hidden router privilege; no bypass of signing, security,
  memory, filesystem, external-action, budget, or causal-depth policy; visible
  actions; replaceable role holder; durable project state.
- Dependencies: roles and membership, communication parity, bounded activation,
  owner Inbox, receipt-backed Activity, grants, budgets, approvals, recovery,
  and audit.
- Consequence: `orchestration.optional_conductor` is a staged P3 epic, not a P0
  feature and not the universal Luca product model.

## PC-D004 — Conversation remains independently reliable

- Status: accepted
- Decision: conversation delivery and final publication cannot depend on
  continuity, Brain retrieval, reflection, or orchestration.

## PC-D005 — Authority remains host-owned

- Status: accepted
- Decision: model/tool descendants never receive owner or resident private keys,
  signing-broker capabilities, provider credentials, or persistent authority.

## PC-D006 — Organization is not authorization

- Status: accepted
- Decision: project, room, role, invitation, and resident membership do not
  imply filesystem, Brain, MCP, provider, model, budget, or external-action
  grants.

## PC-D007 — Sole integration authority

- Status: accepted
- Decision: Program Integration & Release alone may alter the integration
  train, resolve shared-interface conflicts, promote installed verification,
  or publish release completion.

## PC-D008 — Six-state completion model

- Status: accepted
- Decision: planned, implemented in source, source-tested, integrated, installed
  verified, and release-complete/pushed remain distinct terminal observations.

## PC-D009 — P0 before expansion

- Status: accepted
- Decision: onboarding, communication parity, unified creation, Forge native
  proof, consolidation, publication, and one signed tester bundle precede P1–P3
  implementation. Later teams may prepare read-only evidence where safe.

## PC-D010 — Approval-gated topology

- Status: accepted
- Decision: this turn creates only the control worktree. Team worktrees and the
  P0 integration train are proposed, not created, until Riley approves.

## PC-D011 — PC-G0 conditional approval

- Status: accepted on 2026-08-12
- Decision: PC-G0 is approved after two bounded corrections.
- Release coordinate: the combined tester release is `luca/v1-beta`, with
  proposed worktree
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-release-v1-beta`.
  V1.2 and V1.2.1 remain the names of completed Brain milestones.
- Status sequencing: CTRL-001 remains `implemented_in_source` until the control
  package exists on an exact commit and every control validator passes against
  that commit. Only then may a documentation-only promotion record
  `source_tested`.
- Authorized next action: finalize the control commit, validate it, and create
  the five team branches/worktrees and initial team reports from that exact
  commit.
- Still prohibited: P0 integration-train creation, product implementation,
  shared-file writes, release publication, or tester-app construction.
