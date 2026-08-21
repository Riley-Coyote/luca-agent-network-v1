# Agent-Neutral Artifact Bridge and Live Preview Amendment

**Status:** implementation authorized by Riley on 2026-08-21.

This amendment supersedes the packet's static-only sequencing and its
Codex-shaped `buzz-dev-mcp` assumption. The storage, authority, privacy,
conversation-independence, and static-rendering safety contracts remain in
force.

## Product decisions

- The first integrated slice includes durable static artifacts and an
  agent-started live preview in the same Canvas.
- Live preview accepts verified loopback HTTP origins only.
- The harness owns build commands and server processes. Luca stores no launch
  command or PID and never restarts a server automatically.
- An `app` artifact stores durable metadata, provenance, preview imagery, and a
  native-only source-directory binding. It does not copy the repository.
- Relaunch expires the preview session but retains the app artifact. The stopped
  state can prepare an owner message asking the source resident to restart it.
- Remote browsing, LAN preview, sharing, sync, full IDE behavior, and automatic
  process orchestration remain deferred.

## Agent-neutral transport

The bundled MCP binary gains a dedicated artifact-only mode. The managed ACP
host provisions that sidecar through standard `session/new.mcpServers`
independently from every runtime's legacy development-tool configuration.

The provider-visible tool names and schemas are identical for Codex, Claude
Code, Hermes, OpenClaw, and any compatible ACP adapter:

- `artifact_create`
- `artifact_update`
- `artifact_read`
- `artifact_list`
- `canvas_present`
- `preview_attach`
- `preview_detach`

Tool-visible arguments never select owner, resident, session, dispatch, turn,
conversation, cancellation epoch, or working root. The host binds those values
from the admitted managed dispatch using `luca-protocol`'s
`ArtifactBrokerBindingV1`.

Standard ACP necessarily exposes the sidecar command and its per-process MCP
environment projection to the trusted ACP adapter. The security promise is
therefore precise: capability material never enters model prompts, shell/tool
environments, nested subprocesses, relay events, observer archives, renderer
state, or diagnostics. It is exact-turn-bound, HMAC-derived, short-lived, and
useless after desktop revocation.

Runtime support is a capability fact from the Rust runtime catalog or a bounded
compatibility probe. React never branches on harness names. An incompatible
adapter retains normal conversation behavior and reports artifact tools as
unavailable.

## Live preview contract

`preview_attach` requires an existing `app` artifact and an HTTP URL whose
resolved destination remains loopback. Credential-bearing URLs, private LAN
addresses, remote hosts, malformed authorities, and rebinding are rejected.

Canvas exposes status, URL display, reload, open externally, detach, and close.
It is not an addressable general browser. Live content receives no Tauri IPC or
parent-DOM authority and may not navigate the top-level Luca window.

Preview sessions are ephemeral invalidation state. Artifact metadata may retain
the last safe URL label and preview image, but no session is considered live
after app relaunch.

## Implementation sequence

1. Freeze the shared protocol and port the approved Canvas/Library prototype.
2. Build the owner-local catalog, immutable versions, blobs, and typed Tauri API.
3. Bind the Library and shared Canvas to production data.
4. Provision the artifact-only MCP sidecar and exact-turn desktop broker.
5. Project local receipts into conversation without changing signed events.
6. Add loopback live-preview health, sandboxing, and stopped/restart-request UX.
7. Pass protocol, storage, isolation, provider-neutral, browser, and native-app
   acceptance gates.

