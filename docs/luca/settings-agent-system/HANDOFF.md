# Luca Settings and Agent System Handoff

Start with [`00_START_HERE.md`](00_START_HERE.md), then read the specification,
verdict, and run log in that order.

## Current source

- Branch: `codex/settings-agent-system`
- Frontend checkpoint: `b3778c8`
- MCP/runtime checkpoint: `87e0aa6`
- Installed bundle: `~/Applications/Luca Agent Network Dev.app`

## Important implementation boundaries

- Public copy says **Agent**. `resident` remains an internal identity/runtime
  term.
- Luca-authored runtime-backed agents are **Polyphonic Agents**.
- Imported Hermes/OpenClaw bindings and native configuration remain read-only.
- The Agent Library and Settings use the same roster/view-model foundation;
  do not create a second agent store.
- MCP connection metadata is local. Secret values are Keychain-only.
- MCP grants bind one connection ID to one exact resident public key and apply
  to fresh managed sessions.
- Tool permission remains independent and fail-closed.
- Mobile currently exposes pairing state, not a fabricated durable device list.
- Visible upstream attribution belongs only in About Luca third-party notices.

## Next safe work

The next implementation should begin from this branch or a committed descendant
after confirming no concurrent design lane needs reconciliation. The most
natural follow-on is the deferred Polyphonic Agent creation flow. It should not
expand native Hermes/OpenClaw write authority until official transactional
adapters exist.
