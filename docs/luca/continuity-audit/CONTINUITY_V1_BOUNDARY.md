# Recommended next continuity boundary

Status: audit recommendation; awaiting Riley's product approval.

## Outcome

The next milestone should make a resident feel continuous across fresh runtime
sessions without attempting the entire Polyphonic autonomous-cognition suite.

> Any imported resident returns under the same cryptographic identity,
> automatically receives a small private notebook of what it intentionally
> carried forward, can recall explicitly authorized parts of the owner's brain,
> and leaves inspectable, correctable, source-backed continuity after meaningful
> conversations.

The direct-message and multi-agent product remains fully usable when every
continuity component is absent, locked, slow, corrupted, or disabled.

## Four separate data planes

```text
signed conversation events
  canonical chronology, authorship, room/reply structure

resident continuity store
  encrypted private hypomnema, handoff, reflection, resident beliefs

portable Capsule projection
  encrypted identity/self/relationship/current digest/open-thread state

owner universal brain
  governed shared knowledge, projects, sources, provenance, recall policy
```

No plane silently grants access to another.

## Included

### 1. Conversation continuity parity

- Extend bounded signed-history rehydration from DMs/thread replies to ordinary
  multi-agent rooms.
- Preserve honest fresh-session behavior; do not claim native ACP transcript
  restoration unless a runtime proves it.
- Keep one canonical relay transcript and the existing exactly-once final
  publication/restart semantics.

### 2. Resident continuity kernel

- Bind one continuity namespace to owner public key plus resident public key.
- Provide an encrypted-at-rest local store and encrypted backups; include DB,
  WAL, temporary, and recovery paths in the protection claim.
- Port standalone Mnemos handoff/hypomnema revisions, exact scope, provenance,
  correction, supersession, archive/forget, and bounded startup-packet behavior.
- Attempt to load a small first-person handoff and active hypomnema before a
  resident turn when authorized and available, subject to owner/resident/provider
  policy, failure state, and token budget.
- Treat resident-global, relationship, project, and room scopes explicitly.

### 3. Fail-soft pre-turn packet

- One typed call site per responding resident.
- Layers: bounded signed history references, portable Capsule state, resident
  handoff/hypomnema, authorized engrams, optional owner-brain recall.
- Each layer returns `ready`, `empty`, `denied`, `stale`, `unavailable`, `timeout`,
  or `invalid` plus safe diagnostics.
- Retrieved bodies are labelled untrusted reference data and never enter system
  authority, logs, crash reports, general caches, or relay receipts.
- Turn-time retrieval does not mutate memory.

### 4. Durable post-publication continuity

- Start only after the exact final signed event is accepted and the local outbox
  is finalized.
- Use a durable idempotent job keyed by owner, resident, conversation, final event,
  session epoch, scope, and operation.
- Apply a conservative salience gate and allow `no_change`.
- Create primary continuity for the responding resident and shorter observer
  continuity only for agents that actually participated.
- Preserve exact source event IDs and authorship.
- Resident-authored reflections run through that resident's managed runtime;
  deterministic/sidecar output is labelled as a system proposal.
- Slow identity/relationship/conviction changes require review. High-churn
  handoff/digest/open-thread changes use a bounded policy with visible history.

### 5. Portable encrypted projection

- Reuse NIP-AE encryption, blinded addressing, signatures, and owner-readable
  records through typed desktop broker operations.
- Keep the Capsule a compact projection of rich continuity, not the full Mnemos
  store or conversation archive.
- Load stable segments on fresh session and current digest/open threads per turn.
- Preserve versions locally and expose change history/diffs.
- Limit public claims to the conflict/restore behavior actually proven.

### 6. Owner universal brain, narrow first scope

- Create or select an explicit owner-brain profile, or import one approved local
  corpus into it. A resident continuity namespace must never be reused as the
  owner's universal-brain namespace.
- Create three explicit policies: resident-private, owner-shared-to-agents, and
  explicit project/room scope.
- Authorize every responding resident independently before retrieval and before
  provider egress.
- Return provenance and a body-free context receipt.
- Default to local FTS plus bounded graph activation. Embeddings are optional and
  policy-bound.
- Background inference may create reviewable memory candidates; it does not write
  the owner's durable shared brain directly.

### 7. Inspectable notebook and controls

- Per-resident notebook showing the continuity fields permitted by the approved
  owner-visibility policy, plus continuity-job status and body-free provenance.
- Owner correction, archive/forget, and direct hypomnema visibility remain
  conditional on the explicit visibility/write-authority decision. Candidate
  review, scope inspection, and context-use receipts remain owner-visible.
- User-facing states distinguish absent, empty, denied, stale, unavailable,
  pending, failed, and committed.

## Explicitly deferred

- proactive outreach and self-initiated conversation;
- broad dreaming, wandering, emotional drift, social-drive modulation, and
  dialectic identity revision;
- automatic transcript indexing;
- implicit sharing between resident stores;
- a global interaction-count-based trust score;
- native ACP session-resume claims;
- mobile/multi-device concurrent writing unless the chosen commit design proves
  it;
- unreviewed remote embeddings or background model calls;
- complete Polyphonic UI or its hosted infrastructure;
- continuous folder watching;
- public claims of full autonomous inner life.

## Acceptance demonstration

1. Import one Hermes and one OpenClaw resident; both retain their current public
   keys and runtime bindings.
2. In a DM, complete a meaningful exchange and let its post-publication job
   commit a source-backed handoff/hypomnema entry.
3. Quit and relaunch. A fresh ACP session answers from that carried-forward state
   without claiming native transcript resume.
4. In a mixed room, both residents receive bounded room history. Only actual
   participants receive observer continuity; neither receives the other's private
   notebook.
5. Ask a question whose answer exists only in an authorized owner-brain source.
   Two authorized residents can use it with separate receipts; a denied resident
   cannot surface it.
6. Open the notebook, inspect source event IDs and revision history, correct one
   entry, and forget/archive another.
7. Kill or lock every continuity component. Messaging, cancellation, permissions,
   restart recovery, and final publication still work.
8. Restart during a continuity job. It resumes or terminates exactly once and
   never duplicates a resident response or memory mutation.
9. Capture the outbound provider request and prove private/denied/local-only
   bodies and local paths are absent.
10. If Capsule portability is included in the milestone claim, perform the exact
    relocation test supported by the selected commit model and state its
    single-writer or multi-device limitation truthfully.

## Build-order recommendation

1. Group-history parity and shared protocol vectors.
2. Private continuity child/fake provider with failure matrix.
3. Resident-key-bound encrypted local store and migration plan.
4. Read-only pre-turn packet with handoff/hypomnema.
5. Typed NIP-AE desktop broker path and portable projection.
6. Durable post-publication primary/observer jobs.
7. Narrow owner-brain profile/corpus import and authorized retrieval.
8. Notebook, receipts, correction/forget, and review queue.
9. Deterministic maintenance under Luca-owned scheduling.
10. Installed-app acceptance demonstration and independent security review.

## Not included in this recommendation without a decision

The current planning kit specifies a managed server-side conditional Capsule
commit coordinator with writer epochs, installation-attestation credentials,
and transactional multi-event heads. That design supports stronger multi-device
claims but is a major server/operations milestone. Before implementation, Riley
should choose between:

- **single-installation first:** serialize writes in the desktop, use a simpler
  portable snapshot/head rule, and explicitly defer concurrent multi-device
  authority; or
- **managed multi-device from the start:** retain the full coordinator and accept
  the additional relay, authentication, operations, and recovery work.

The audit does not silently choose this tradeoff.
