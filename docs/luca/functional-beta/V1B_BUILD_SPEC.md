# V1B build specification

## Outcome

Ship an installed Luca desktop beta in which imported Hermes and OpenClaw
residents retain their native capabilities and stable identities, communicate in
DMs and mixed rooms, and carry a compact private handoff into fresh runtime
sessions.

## Existing accepted foundation

- G1 messaging/runtime matrix: import, DM, mixed room, restart, cancellation,
  permissions, attachment, search, and exactly-once publication.
- `luca-protocol` continuity contracts and fail-soft provider.
- Encrypted resident namespaces, keychain custody, revision/rollback lifecycle,
  in-memory retrieval, rotation, and protected backup.
- Read-only pre-turn `ContinuityPacketV1` integration.
- Typed trusted `PortableContinuityCapsuleV1` projection.

## Native-agent parity

Luca launches the exact imported native binding. It does not copy native memory
or configuration. The beta verifies, for each supported runtime, a profile-only
fact, a workspace read, a permission-gated tool action, relaunch under the same
resident key, and correctly attributed mixed-room participation. Unsupported
ACP capabilities are exposed as degraded or unavailable rather than simulated.

## Compact handoff

`ResidentHandoffV1` contains a summary, unresolved threads, commitments,
explicit preferences, exact signed source-event IDs, and an update timestamp.
It is bounded, encrypted in the resident namespace, revisioned, and never
published to the relay.

After a successful resident final is accepted and local publication authority is
finalized, an idempotent job waits for conversation idle. Mechanical gates skip
trivial traffic. The same resident's exact runtime/model then returns either
`no_change` or one validated handoff through a private tool-free cognition turn.
Runtime/model substitution is forbidden. A user turn preempts cognition.

The latest effective handoff is injected as untrusted reference data through
the existing pre-turn packet. Cancelled, failed, ambiguous, owner-authored, or
unfinalized events cannot create continuity. In groups, only residents that
publish a final author their own handoff; no observer mutation is created.

## User control

Continuity is enabled by default with import disclosure. The resident inspector
shows enablement, update time, current handoff fields, provenance, and body-free
job status. The owner can correct, remove one item, forget, disable, or retry one
failed job. Corrections are pinned owner-authored revisions.

Chat shows only compact `Continuity used` and `Handoff updated` indicators.
Activity exposes job state without private bodies.

## Interfaces

- `ResidentHandoffV1`
- `ResidentContinuityModeV1`
- `LocalContinuityCognitionRequestV1`
- `LocalContinuityCognitionResultV1`
- `PromptSource::Continuity(job_id)`
- Existing `ContinuityJobV1`, `ContinuityMutationV1`, `ContinuityPacketV1`, and
  encrypted revision store remain authoritative.

## Deferred

Universal-brain import and grants, imported-history archive, embeddings,
associative expansion, separate hypomnema/journal/reflection stores, personality
or conviction evolution, scheduled inner life, proactive DMs, background agent
society, concurrent multi-device writes, mobile, voice, and conductor behavior.

