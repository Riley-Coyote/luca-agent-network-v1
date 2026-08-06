# Functional beta continuation handoff

## Source coordinate

- Branch: `agent/v1-functional-beta`
- Approved baseline: `dc1c2e63891ab0a53b2c4c948e0e7eed801d6f89`
- Build authority: this directory
- Long-range continuity roadmap: `docs/luca/continuity-g2/`

Read `00_START_HERE.md`, `V1B_VERDICT.md`, `RUN_LOG.md`, and
`ACCEPTANCE_V1B.md` before changing beta behavior.

## What is ready

- Exact native Hermes/OpenClaw import and binding revalidation.
- Stable resident keys across runtime changes and relaunch.
- G1 messaging/runtime functionality, including mixed rooms, permissions,
  cancellation, recovery, attachments, search, and exactly-once finals.
- Compact same-resident encrypted handoff generation and injection.
- Owner inspect, correction, item removal, disable, forget, and one-time retry.
- Body-free Activity and compact chat status.
- Signed installed development application and passing repository gate.

## Important implementation seams

- Protocol contracts: `crates/luca-protocol/src/continuity.rs`
- Encrypted lifecycle: `desktop/src-tauri/src/luca/continuity_runtime.rs`
- Durable job ledger: `desktop/src-tauri/src/luca/continuity_jobs.rs`
- Post-publication scheduling:
  `desktop/src-tauri/src/luca/managed_message_publisher.rs`
- Crash-safe publication transfer:
  `desktop/src-tauri/src/luca/managed_message_outbox.rs`. An accepted row is
  not compactable until its idempotent handoff job is durably recorded.
- Private cognition bridge: `desktop/src-tauri/src/luca/managed_cognition.rs`
  and `crates/buzz-acp/src/local_cognition.rs`
- Pre-turn injection: `desktop/src-tauri/src/luca/managed_continuity.rs`
- Owner commands: `desktop/src-tauri/src/commands/continuity.rs`
- Inspector: `desktop/src/features/profile/ui/ResidentContinuityPanel.tsx`

## Non-negotiable boundaries

- Never write native Hermes/OpenClaw configuration, credentials, memory, or
  schedules.
- Never substitute a runtime/model for handoff authorship.
- Never schedule from owner, cancelled, failed, ambiguous, or unfinalized
  events.
- Never mark a publication-to-handoff transfer complete before the idempotent
  job exists; startup reconciliation owns repair of that crash boundary.
- Never place handoff bodies in relay events, logs, evidence, job metadata, or
  child environments.
- Never let continuity failure block chat.
- Do not grow this beta into the deferred G2 roadmap without a new approved
  scope.

## Next product work

Integrate the separately approved design lane component by component without
replacing the runtime or continuity architecture. After beta feedback, select
the next bounded capability from the preserved G2 roadmap rather than enabling
all deferred memory features at once.
