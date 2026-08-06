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
- Five stale Luca branding/order expectations found by the broad frontend suite
  were updated to the current Luca/Vektor/Anima contract. The complete suite
  subsequently passed with 3,377 tests.
- Checkpoint: `0cdeedae`.
- U01, U02, A202, and A301-A304: PASS.

## 2026-08-06 — R01 installed Hermes/OpenClaw beta matrix

- Rebuilt, signed, installed, and relaunched `Luca Agent Network Dev` from the
  functional-beta source. Bundle identity and Developer ID signature verified.
- A meaningful Hermes turn produced one encrypted, source-backed handoff. A
  fresh Hermes runtime then recovered the opaque test marker and unresolved
  next step from the Luca handoff while explicitly avoiding a native-session
  restoration claim.
- A meaningful OpenClaw turn produced one encrypted, source-backed handoff. A
  fresh OpenClaw runtime recovered its distinct opaque marker and unresolved
  next step under the same limitation.
- The existing mixed room produced one correctly attributed Hermes response and
  one correctly attributed OpenClaw response under the same owner turn. Each
  responding resident completed only its own handoff job.
- Fresh native discovery resolved OpenClaw `main` back to one existing imported
  resident and one stable resident key. No duplicate was created.
- Owner correction produced a pinned revision. Per-item removal produced a new
  revision. Disabling Hermes continuity prevented both generation and injection
  while messaging continued normally; continuity was re-enabled afterward.
- The one pre-fix failed handoff job accepted exactly one manual retry and then
  completed. The defect was a fractional timestamp in the private cognition
  instruction; the protocol requires whole-second canonical `Z` timestamps.
  The prompt and regression fixture were corrected before the final rebuild.
- The installed forget action displayed a permanent-purge confirmation that
  clearly excludes native memory. The confirmation was cancelled to preserve
  the live profile. Focused encrypted-store tests proved physical purge and
  replay behavior using disposable fixtures.
- The local support tree, SQLite/WAL/SHM files, crash logs, repository, and nine
  managed-runtime process environments contained zero matches for the private
  test canary. No Luca signing-key variables were present in those child
  environments. The handoff job ledger remained body-free.
- R01, A103, A104, A208, and A401-A403: PASS.

## 2026-08-06 — R02 final gate

- `just ci`: PASS.
  - desktop frontend: 3,377 passed;
  - desktop Rust library: 1,748 passed, 13 ignored by documented platform or
    external-service preconditions;
  - mobile: 525 passed, one ignored;
  - typecheck, formatting, clippy, production builds, and remaining workspace
    suites passed.
- Post-gate focused regressions passed for encrypted forget, resident isolation,
  pinned correction, locked/restore/timeout fail-soft behavior, native import
  idempotency, one-time manual retry, canonical cognition timestamps, and the
  publication-to-handoff crash boundary.
- Independent final review found one crash window after accepted publication
  authority finalized but before its handoff job was durably recorded. The
  encrypted publication outbox now retains and protects accepted rows until an
  idempotent handoff transfer marker is persisted. Startup reconciliation
  repairs that exact boundary. A persisted crash/reload regression, all 12
  outbox tests, all 14 publisher tests, and a desktop Rust check passed. The
  reviewer re-examined the seam and returned PASS with no remaining P0/P1.
- The installed binary hash is
  `d633ba22eb929ecabb8fcd80053ec1c9699b3cbc7b4e2b687accc53b2966ab20`.
- The rebuilt app passed strict deep code-sign verification, retained bundle ID
  `com.luca.agent-network.dev`, relaunched successfully, and exposed the real
  native shell and existing workspace state through the accessibility tree.
- `git diff --check` and the V1B control validator passed.
- R02 and A404-A405: PASS. Final verdict: functional beta candidate accepted.
