# Communication Parity Cross-Session Handoff

## Coordinates

- Communication worktree:
  `/Users/rileycoyote/Documents/Codex/2026-07-22/referenced-chatgpt-conversation-this-is-untrusted/luca-agent-network-v1-communication-parity`
- Communication branch: `codex/communication-parity`
- Communication checkpoint before this handoff: `d2d5bf7`
- Conversation-design worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-conversation-polish`
- Conversation-design branch: `codex/conversation-experience-polish`
- Conversation-design checkpoint inspected for this handoff: `0bfbd7a`
- Shared merge base: `81762ad144368bd1b5f5e7f144fdd19a57466676`

The conversation-design branch is the integration home. It owns the newest
approved conversation presentation and the currently rebuilt branch-specific
application. Do not merge that branch into this worktree and then treat this
worktree as the visual authority.

## What the communication checkpoint contains

- Strict typed communication contracts.
- Exact-turn Communications MCP authority.
- A trusted desktop communication broker.
- Resident-signed kind-9 sending to an existing owner-visible conversation.
- Same-owner and relay membership checks.
- Relay-atomic expected-membership compare-and-insert.
- Encrypted exact-event vault and encrypted action outbox.
- Crash recovery and byte-identical retry after ambiguous publication.
- Fail-soft managed-runtime wiring and broker teardown.
- A passive owner Inbox projection and deterministic browser fixtures.
- Honest privacy language: current DMs are relay-membership restricted, not
  NIP-17 end-to-end encrypted.

Read `receipts/SECURE_SEND_CHECKPOINT.md` for the exact verified boundary.

## What it does not yet contain

- Complete managed-agent reactions, edits, approved deletes, invitations, or
  room creation.
- Managed attachment publication.
- Causally bounded agent-to-agent activation.
- Resident-specific native Inbox projections.
- Full browser, repository-CI, or installed-application acceptance.
- NIP-17 end-to-end encrypted DMs.

Do not market or test these deferred capabilities as complete.

## Merge-risk map

At the inspected checkpoints, only these files were changed by both branches:

- `crates/luca-protocol/src/lib.rs`
- `desktop/src-tauri/src/luca/mod.rs`

Resolve both additively. Preserve every module/export from both branches.

The communication branch does not modify the conversation renderer, composer,
activity shelf, streaming geometry, Graphite theme, or conversation-shell CSS.
The approved design branch remains authoritative for those surfaces.

## Safe integration sequence

1. Require both worktrees to remain clean and record their exact commits.
2. Create a new integration branch from `codex/conversation-experience-polish`.
3. Merge `codex/communication-parity` without rewriting either history.
4. Resolve the two shared registries additively.
5. Run protocol, communications, runtime, relay, Inbox, typecheck, and focused
   conversation-presentation tests before changing UI.
6. Inspect the real conversation surface and Inbox fixtures to confirm the
   communication work did not regress the approved composer, activity shelf,
   streaming rows, identity marks, or Graphite theme.
7. Only after source and visual checks pass, rebuild the branch-specific app.

Do not merge directly into `luca/v1.1`, replace the generic development app,
or run the complete installed gate until the combined checkpoint is clean.

## Supporting artifact

`luca-messaging-explainer.html` is a standalone marketing explainer. It has no
runtime authority and must not be used as acceptance evidence. Its copy
distinguishes shipped messaging foundations from deferred communication work.
