# Communication Parity Run Log

## CP0 — 2026-08-11

- Immutable source checkpoint:
  `81762ad144368bd1b5f5e7f144fdd19a57466676`.
- Active branch: `codex/communication-parity`.
- The source checkout later gained two unrelated untracked presentation-retry
  files. They were preserved untouched and are not part of this branch.
- Control package and machine-validated parity ledger created before product
  implementation.
- Current protected configuration hashes:
  - Hermes `config.yaml`:
    `5b03798c7625609e78a67bd813e9104d7a69b2e80c6ef69c42c08276d262b0bd`
  - OpenClaw `openclaw.json`:
    `f5633fc4e495e5ef6a87e35966ab6d9875bd92d0458371f0074525f386f8e2b5`
  - aggregate Hermes profile tree:
    `43ac1c9cd4652a837a163b34ba20fb47f2eb730c6315e963c127a411e013178c`
- Ledger validator: 58 capabilities across 13 required areas, pass.
- Frontend typecheck: pass.
- `luca-protocol`: 49 passed, 2 ignored across unit/vector suites.
- Focused message, reply, mention, reaction, read-state, and Inbox baseline:
  86 passed.

## Receipts

Each completed task records its commit, owned files, checks, reviewer, repair
count, and terminal status under `receipts/`.

## Narrow secure-send checkpoint — 2026-08-11

- Implemented one production communication path: a managed resident can send
  one signed kind-9 message into an existing owner-visible conversation.
- The Communications MCP capability is bound to the exact resident, runtime,
  session epoch, turn, dispatch receipt, cancellation epoch, conversation, and
  capability generation. It is unavailable to private cognition and cannot
  share an ACP session with Repository MCP.
- Publication uses an encrypted exact-event vault and encrypted action outbox.
  Relay-ambiguous retries reuse the frozen signed bytes and reconcile exactly
  once after restart.
- A relay-atomic expected-membership snapshot guard closes the room-membership
  race without changing legacy unguarded kind-9 behavior.
- Runtime setup is fail-soft: an unavailable communication broker withholds the
  capability but does not block ordinary resident messaging.
- Seal-before-outbox and failed terminal-cleanup crash windows are covered.
  Pending encrypted cleanup authority is retained until vault deletion succeeds.
- Protected Hermes and OpenClaw configuration hashes still match CP0.

Focused evidence:

- communication action/outbox/publisher: 28 passed;
- encrypted exact-event vault: 7 passed;
- Communications ACP: 6 passed;
- restricted Communications MCP: 9 passed;
- managed environment: 41 passed;
- managed runtime: 42 passed;
- relay expected-membership parser: 2 passed;
- desktop focused Clippy: pass with integration-only dead-code and one unrelated
  pre-existing lazy-evaluation lint explicitly allowed.

This is a bounded CP1/CP2 checkpoint, not the complete communication-parity
verdict. Reactions, edits, approved deletes, invitations, room creation,
attachments, causal agent activation, resident Inbox projection, full browser
regression, full CI, and installed-app proof remain open.
