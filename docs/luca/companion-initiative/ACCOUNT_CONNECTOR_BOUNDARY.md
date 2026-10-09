# Account connector boundary

Source audit: 2026-10-08, initiative candidate only. Ordinary authorized
native-harness MCP use remains available. Automatic account/service feeds are
**unverified, not implemented**. This note adds no executable connector, grant,
transport, account claim, or observation.

Riley's current scope decision defers social-account and iMessage connections
until after the other companion features work. Browser visits and separately
granted page excerpts can cover allowed social pages visited in that browser;
they are not a connected account feed or permission to read private messages.

## What the current source proves

- Luca's local stdio registry grants an exact connection to an exact resident,
  not an automatic tool/operation feed. See
  [AgentMcpGrantV1](/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07/desktop/src-tauri/src/luca/mcp_registry.rs:76)
  and [set_grant](/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07/desktop/src-tauri/src/luca/mcp_registry.rs:482).
- [resolve_for_resident](/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07/desktop/src-tauri/src/luca/mcp_registry.rs:542)
  selects enabled, granted connections. Secret references are resolved only in
  the existing host preparation path; an awareness adapter must not copy,
  display, serialize, or log the resulting environment.
- [managed_mcp::create_endpoint](/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07/desktop/src-tauri/src/luca/managed_mcp.rs:57)
  sends a one-shot resident/session-bound bootstrap over an inherited descriptor.
  It is a launch snapshot, not current per-read revocation authority.
- [test_luca_mcp_connection](/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07/desktop/src-tauri/src/commands/mcp_settings.rs:308)
  calls the existing bounded probe. `Ready` means initialization and
  `tools/list` succeeded, not that an account is signed in or that any advertised
  operation is an authorized, verified read.
- [runtime_owned_mcp_catalogs](/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07/desktop/src-tauri/src/commands/mcp_settings.rs:158)
  projects configured server names/status for supported native configuration
  readers. It does not expose account data or prove service availability.
- [McpRegistry::call](/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07/crates/buzz-agent/src/mcp.rs:485)
  is the existing generic tool transport, accepting a tool name and JSON
  arguments. [PermissionMatcherV1](/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07/crates/luca-protocol/src/permission_rule.rs:46)
  and the existing desktop permission ledger govern normal managed requests;
  neither is a service-specific automatic-feed adapter.

No host-verified account read operation with exact per-companion automatic
operation consent was found in these surfaces. Tool discovery and
`readOnlyHint` are not a replacement: MCP annotations describe risk, not an
enforced read contract. See the official
[MCP tool-annotation guidance](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/).

## Smallest future integration boundary

One reviewed service-specific adapter must pin the exact current connection,
configuration binding, server/tool, typed read operation and host-selected
resource scope. No model-selected tool, arbitrary JSON arguments, broad social
or text-message access, private native database scraping, or outward side effect
belongs in automatic awareness.

Before every read, the host must independently re-resolve the current configured
handle and explicit per-companion server/tool/operation consent, live owner,
device/source scope, resident Pause state, grant revision and deny epoch. A
launch bootstrap or prior successful probe cannot authorize that read. Reuse
the existing transport and permission/control authorities; do not add a second
MCP framework or acquire credentials in the awareness layer.

Return only bounded, source-linked untrusted evidence, held in the existing
ephemeral buffer. Recheck withdrawal and dependencies before admission,
assembly, promotion or provider egress. Provider egress and canonical promotion
remain separate choices. Bodies, secrets and account identifiers must not enter
the control database, diagnostics or operational logs.

Report unsupported/unavailable honestly. Report sign-in-required only from a
verified service-specific authentication result, not from `tools/list`, a generic
failure or a locked local secret. A first adapter needs only focused synthetic
denial/bounds checks plus a separately authorized disposable-account proof of
the exact read and revocation path. No real configurations, credentials,
accounts, calls, sign-ins or private databases were accessed for this audit.
