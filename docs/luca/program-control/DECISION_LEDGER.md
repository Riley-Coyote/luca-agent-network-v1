# Luca program decision ledger

## D-001 — Conversation plane is reused

- Decision: Buzz signed events, relay, rooms, membership, DMs/groups, replies,
  mentions, reactions, edits/deletion, attachments, search, unread/read, feed,
  Inbox projections, human UI, and host-managed runtime publication remain the
  conversation foundation.
- Consequence: P1 adds thin managed adapters and Luca presentation; it does not
  introduce a parallel message store, room model, signer, or universal broker.

## D-002 — Functional product precedes Mnemos and optional hardening

- Decision: P1–P3 close the visible installed beta; P4 builds felt continuity;
  P5 contains optional hardening and deferred expansion.
- Consequence: security-only architecture may not displace visible product
  work unless a concrete beta failure makes it indispensable.

## D-003 — Direct mode is the Phase 1 default

- Decision: authorized local resident communication publishes resident output
  verbatim without routine approval.
- Confirmation boundary: destructive deletion, external/unresolved recipient,
  authority or membership-policy change, broad broadcast, material data effect.
- Consequence: Guarded/Restricted modes are optional P5 work.

## D-004 — Restore Inbox and Activity before inventing replacements

- Decision: use existing events, owner Inbox projections, feed/activity data,
  and deep links first.
- Consequence: a resident-specific projection is allowed only when an accepted
  visible workflow cannot be supported by the existing data, and must remain
  minimal rather than becoming a new resident workflow architecture.

## D-005 — Communication commit reclassification

No commit is discarded. Candidate integration commits retain strict ancestry
requirements. Historical source/reference commits retain exact recorded
coordinates and content auditability without being misclassified as integrated.

The separate status commit has this binding:

| Field | Value |
|---|---|
| Exact commit | `f27bbce4d0366116ba34ad284eabceb35ed81dac` |
| Title | `Document complete Luca program status` |
| Role | `historical program-status source` |
| Preserved branch | `codex/communication-parity` |
| Integration status | `reference_only` |
| Ancestry requirement | `not_applicable` |
| Preservation requirement | Exact commit and branch remain reachable; eight recorded status/handoff files remain content-auditable |

| Classification | Commits | Decision |
|---|---|---|
| Directly reusable now | `1ef062b`, `4d1beb7`, `2ff32f9`, `f22d2f6`, `af8dd7c`, `11583e8`, `2029508`, `b304bc1`, `16b971d`, `21cac2c`, `732de70`, `0c53239` | Reuse Inbox projection, managed send/runtime, membership publication, retry/recovery, and fixtures |
| Preserve but do not expand in P1–P3 | `6b867cf`, `7dd9f9e`, `a822f8b`, `24fdc5e`, `9daf89d`, `6b2a532` | Keep exact-turn MCP/broker/vault/authority foundations; do not generalize them for every ordinary local action |
| Excessive for the present milestone | `199f0ac`, `95aac1f` | Preserve the action-outbox/reconciliation code, but do not make generalized outboxes a dependency for visible parity |
| Incomplete or still requiring installed proof | `11583e8`, `2029508`, `1ef062b`, `2ff32f9`, `f22d2f6`, `d2d5bf7` | Treat as foundations, not full communication parity or complete native Inbox proof |
| Superseded by existing-operation reuse | `e8659cb`, `b98f138` operation shapes for reactions, edits, deletion, invitations, room creation, and attachments | Retain contracts as design/negative-authority history; implement missing UX through existing builders/commands rather than a second protocol |
| Documentation/handoff retained in integrated ancestry | `d2d5bf7`, `b49ee31`, `a1ba589` | Preserve the communication checkpoint, handoff, and integration receipt; this ledger is the current prioritization authority |

The other 26 audited communication commits remain under their existing
classifications above and must be ancestors of the selected integration/release
coordinate before any integrated claim. The separate `f27bbce…` reference is
not part of that 26-commit ancestry set and must not be cherry-picked merely to
satisfy an ancestry check.

## D-006 — Mnemos authorship and identity

- Native profile/identity documents are authoritative and read through the
  exact bound runtime/model.
- Resident-authored identity and handoff text is stored verbatim with
  attribution, provenance, revisions, and corrections.
- Retrieved memory is supplemental context, never a substitute author.
- Crypto keys prove authorship/address continuity, not inner identity or
  semantic truth.
- Continuity failure never blocks ordinary conversation.

## D-007 — Existing protections remain

Stable cryptographic identity, host signing, key/credential isolation,
read-only native configuration, encrypted Brain/continuity, cancellation,
restart recovery, duplicate suppression, exactly-once final publication,
authority separation, and honest readiness remain mandatory constraints.

## D-008 — Tester release coordinate

- Proposed canonical combined tester branch: `luca/v1-beta`.
- Proposed worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-release-v1-beta`.
- It is not created during P0 and cannot be promoted before the P3 unchanged
  installed candidate and Riley approval.

## D-009 — Historical and revised control approvals are distinct

- Historical CTRL-001 remains tied to pre-promotion exact validation. CTRL-002
  records the bounded prior approval/corrections but remains
  `implemented_in_source` because the later promotion commit did not complete
  final validation.
- The functional-product-first revision creates CTRL-003. It remains
  `implemented_in_source` until a documentation commit exists and all control
  validators pass that exact commit.
- CTRL-004 is a new explicit Riley approval of the revised graph. The prior
  approval does not activate teams under this replacement graph.
- Until CTRL-004: no product team worktree, kickoff dispatch, integration
  train, product implementation, or shared-file write is authorized.

## D-010 — Revised P0–P5 graph approved and CTRL-004 authorized

- Decision date: 2026-08-12.
- Approver: Riley.
- Approved package: `codex/program-control` at exact
  `62589f445af524be0f9bac9a67570e593dd58558`.
- Approved release target: `luca/v1-beta`.
- Approved activation: P1 and safe disjoint P2 read-only reconciliation and
  bounded task capsules may begin after this receipt is committed and validated.
- P3 remains gated by accepted P1/P2 results; no integration train, release
  candidate, or release worktree is authorized now.
- P4 and every P5 task remain inactive. P5 requires separate future approval.
- Visible functionality may not be reduced. Reuse, Direct mode, and all
  existing identity/signing/credential/encryption/cancellation/restart/exactly-
  once protections remain binding.
- Status sequencing: CTRL-004 is `implemented_in_source` in the approval
  receipt and may become `source_tested` only after every control validator
  passes on the receipt's exact commit.
