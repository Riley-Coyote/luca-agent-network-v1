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
