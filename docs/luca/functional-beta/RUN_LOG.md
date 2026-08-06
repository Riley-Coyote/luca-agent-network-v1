# V1B run log

Evidence records commands, body-free results, commits, and reviewers. It never
contains keys, credentials, native memory, handoff bodies, prompts, or decrypted
continuity records.

## 2026-08-05 — V1B.0 start

- Created `agent/v1-functional-beta` from committed `dc1c2e63` in a separate
  worktree.
- Left `agent/continuity-g2` and its uncommitted files unchanged.
- Began the smaller functional-beta control package. No product code changed.
- `python3 scripts/luca/validate_v1b_control.py`: PASS.
- Verified the G2 worktree still contains the same eight modified files and one
  untracked `metabolism.rs`; none were touched from this worktree.
- C00, A001, and A002: PASS.

## 2026-08-05 — C01 independent G1 review

- Independently reviewed candidate `e7aad47f5d0debc6681ceef55b7c74fff42b7f6c`
  and runtime-control commit `99410d36d0971bbedcc6cf0b532582f484b5b847`.
- Confirmed that the recorded cancellation, permission, isolation, and security
  fixtures are substantive; no unresolved product P0/P1 was found.
- Did not overstate the historical record as formally closed. Four narrow
  evidence gaps remain: repeated OpenClaw import, OpenClaw post-relaunch recall,
  binding-change key stability, and a complete body-free evidence scan.
- Moved those targeted checks into V1B native-parity and installed-beta work.
  The full historical G1 matrix does not need to be repeated.
- Frozen beta memory promise: native runtime memory remains authoritative; Luca
  adds only a compact encrypted resident handoff and bounded signed history.
- C01, A003, and A004: PASS.

## 2026-08-05 — V1B.1 native binding hardening

- Audited the sole native binding-to-process path for Hermes and OpenClaw.
- Confirmed Hermes launches the exact canonical profile home and OpenClaw the
  exact agent ID and gateway identity; user environment cannot redirect either.
- Added canonical workspace validation at discovery and launch. Missing or
  changed workspaces now report degraded/failed readiness instead of silently
  running in a different directory.
- Added deterministic fixtures for exact profile, agent, workspace, binding
  refresh, secret exclusion, and unavailable workspace behavior.
- Focused test command: `cargo test --manifest-path desktop/src-tauri/Cargo.toml
  native_runtime --lib`: PASS (13 tests).
- Live native-memory, tool, DM/restart, and mixed-room observations remain in
  R01, where the installed app and real runtimes can prove them honestly.
- N01, N02, A101, A102, and A105: PASS.

## 2026-08-05 — V1B.2 compact private handoff

- Added strict bounded handoff, cognition-request, and result contracts with
  body-redacted debug behavior.
- Added a conservative deterministic salience gate: obvious trivial traffic
  ends as `no_change`; only explicit unresolved work, commitments, carry
  requests, or preferences enter resident cognition.
- Reused the accepted encrypted resident namespace, revision authority,
  provenance, pre-turn packet, and Capsule projection. No parallel memory store
  or plaintext index was introduced.
- Added an inherited local cognition channel to the resident's existing managed
  ACP process. It opens a fresh, tool-free session and rejects runtime/model,
  resident, source-event, binding, deadline, and result mismatches.
- Added a body-free durable job ledger. Work is scheduled only after exact relay
  publication, dispatch finalization, and encrypted outbox finalization; startup
  recovery preserves the retry ceiling and source-event idempotency.
- Added user-turn preemption, one automatic retry, and fail-soft disabled,
  missing, locked, corrupt, timeout, and runtime-unavailable behavior.
- Focused Rust contract, cognition, job, encryption, replay, resident-isolation,
  pinned-correction, and fail-soft tests passed. Existing dead-code warnings in
  deferred continuity modules remain non-blocking.
- Checkpoints: `4425006c`, `9734870d`.
- H01-H04, A201, A203-A207, A209, and A210: PASS. A208 remains an installed
  Hermes/OpenClaw demonstration in R01.

## 2026-08-05 — V1B.3 owner control and status surfaces

- Added trusted owner-only read, correction, forget, enable/disable, and one-time
  retry commands for managed residents.
- Corrections are new pinned owner revisions. Item removal uses that same
  revision path rather than mutating ciphertext in place.
- Forget first preempts matching pending/running work, then physically purges
  every encrypted handoff revision while retaining only body-free lifecycle
  metadata.
- Added default-on import disclosure and a per-candidate continuity toggle.
- Added a restrained resident Continuity inspector with source-event links,
  correction, individual item removal, forget confirmation, and failed-job
  retry.
- Added body-free Activity status and recent-only compact chat indicators. The
  Activity command never serializes handoff text.
- Verification: three continuity-job tests, encrypted create/revise/replay,
  resident isolation and pinned correction, physical purge, nine profile-tab
  tests, three activity-presentation tests, TypeScript typecheck, focused Biome,
  Rust formatting/check, production frontend build, and `git diff --check` all
  passed.
- The broad inherited frontend suite still has five pre-existing stale Luca
  branding/order expectations. They are recorded for R02 rather than changed in
  the continuity checkpoint.
- Checkpoint: `0cdeedae`.
- U01, U02, A202, and A301-A304: PASS.
