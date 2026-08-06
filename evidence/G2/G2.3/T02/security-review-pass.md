# T02 security review — PASS

Date: 2026-08-05

## Accepted boundary

- Managed ACP runtimes receive continuity through a dedicated inherited FD4
  channel; owner key custody, permission control, signing, and provider
  credentials remain outside that channel.
- Every request is bound to the exact owner dispatch, resident, conversation,
  session epoch, turn, trigger event, runtime binding, and deadline.
- Signed history is validated, deduplicated, deterministically ordered, and
  event-ID bound before it can contribute to the retrieval cue.
- The current trigger batch is excluded from the cue so the owner message is not
  duplicated in model input.
- Continuity is rendered as a separate untrusted user-data block after verified
  history and before trigger events. It cannot alter system authority, tools,
  permissions, routing, cancellation, or signing.
- The desktop reauthorizes the exact dispatch immediately before delivery and
  holds the dispatch authority across a bounded write. Cancellation or terminal
  state therefore wins without leaking a late packet.
- Timeouts, malformed frames, locked or absent storage, invalid authority, and
  provider failure return body-free fail-soft results.
- The inherited channel persists across turns, discards stale or partial late
  replies, and correlates the next response by exact request and resident.
- Prompt and steer bodies reach only runtime stdin. Observer snapshots and
  debug tracing retain body-free method, ID, session, count, and byte metadata.
  Temporary serialized wire buffers are zeroized.

## Focused evidence

- `cargo test -p buzz-acp continuity_ --lib` — 14 passed, 0 failed.
- `cargo test -p buzz-acp prompt_write_reaches_runtime_but_observer_and_debug_are_body_free --lib`
  — 1 passed, 0 failed. A real child process accepted the private sentinel while
  observer and debug captures remained sentinel-free.
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_continuity --lib`
  — 5 passed, 0 failed.
- `python3 scripts/luca/validate_g2_control.py` — PASS.
- `git diff --check` — PASS.

## Review result

Independent adversarial review accepted the implementation after two bounded
repairs. No remaining blocker exists in the ACP pre-turn transport, dispatch
authority, cancellation race, retry, or plaintext-observation boundary.

A303 and A304 are deliberately not claimed from source tests. They require
populated durable continuity and fresh real Hermes/OpenClaw sessions at the
later G2.3 native gate.
