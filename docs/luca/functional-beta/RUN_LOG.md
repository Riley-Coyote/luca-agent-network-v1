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
