# Luca Settings and Agent System Handoff

Start with [`00_START_HERE.md`](00_START_HERE.md), then read the specification,
verdict, and run log in that order.

## Current source

- Branch: `codex/settings-agent-system`
- Frontend checkpoint: `b3778c8`
- MCP/runtime checkpoint: `87e0aa6`
- Visible-branding checkpoint: `db37bb3`
- Pre-acceptance evidence checkpoint: `a457c30`
- Installed bundle: `~/Applications/Luca Agent Network Dev.app`
- Installed executable SHA-256:
  `18be55fe53e4f5a242e310638e583d3a640f1dc888c714b82270dbb093471e4d`

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
- Internal Buzz crate, binary, protocol, storage, and test identifiers are
  compatibility details. Do not expose them as Luca product copy, and do not
  mass-rename them without a separate migration plan.
- Installed interactive MCP acceptance passed with the default Hermes resident:
  grant, fresh-session tool registration, successful invocation, revocation,
  fresh-session removal, and ordinary messaging were observed directly.
- The temporary acceptance connection and its grants were deleted. The local
  Luca MCP registry was left with zero connections and zero grants.
- OpenClaw discovery was unavailable after the machine restart because its
  native agent list was unreadable. Do not infer OpenClaw MCP acceptance from
  the Hermes proof.

## Next safe work

The next implementation should begin from this branch or a committed descendant
after confirming no concurrent design lane needs reconciliation. The most
natural follow-on is the deferred Polyphonic Agent creation flow. It should not
expand native Hermes/OpenClaw write authority until official transactional
adapters exist.
