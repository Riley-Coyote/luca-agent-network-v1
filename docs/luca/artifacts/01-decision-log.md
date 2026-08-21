# Decision Log

## Settled product decisions

| Decision | Consequence |
|---|---|
| Build static artifacts and agent-attached live preview together | Luca stores artifacts and presents verified loopback servers, while the harness remains process owner |
| Library is first-class | Artifacts survive and remain browsable outside their source conversation |
| Canvas is contextual | The same Canvas component opens from conversation and Library |
| Local-first by default | Artifact bodies and absolute paths do not enter relay storage |
| Versions are durable | Iteration updates one artifact identity through append-only versions |
| Previous Luca is a behavioral reference | Do not transplant its Electron/Node storage or authority model |
| Live application execution remains agent-owned | Luca implements preview sessions without commands, PIDs, or automatic restart |
| Shared boards remain extensible | A board may become a future artifact kind, not a hidden dependency of static V1 |

## Frozen implementation defaults

These defaults are part of the first implementation contract unless source
reconciliation at `GA0` proves one infeasible.

| Topic | Default |
|---|---|
| Public navigation label | Library |
| Public preview label | Canvas |
| Existing Channel Canvas label | Room brief |
| Storage | SQLite catalog plus content-addressed files under Tauri app data |
| Import mode | Managed immutable snapshot with optional local source binding |
| Conversation integration | Local overlay anchored to turn and signed message; no relay change |
| Auto-open | First ready artifact in the active turn, unless focus was explicitly claimed or dismissed |
| Update concurrency | Required `expected_current_version` compare-and-append |
| Delete | Soft delete, reversible retention, later unreferenced-blob garbage collection |
| HTML | Single-document sandbox, scripts allowed only inside opaque origin, network denied |
| SVG | Render as image content, never inline application DOM |
| Library HTML cards | Non-executing schematic/metadata preview |
| Missing source | Keep managed snapshot and mark only the source binding missing |
| Service unavailable | Fail the artifact tool honestly; do not fail the conversation |

## Authority decisions

- The desktop artifact service owns validation, persistence, version identity,
  and lifecycle state.
- `buzz-dev-mcp` exposes narrow artifact operations to the resident.
- A separate artifact broker capability connects that MCP process to the
  desktop. It is not the signing broker or permission channel.
- The provider/model process does not receive the broker descriptor or token.
- Shell/file descendants launched by `buzz-dev-mcp` do not inherit the artifact
  broker capability.
- The artifact tool may reference only inline content or paths resolved beneath
  the app-authorized working root for that turn.
- Artifact data never changes routing, tools, permissions, provider, model,
  budgets, or signing authority.

## Source-reconciliation questions owned by `A00`

These are technical checks, not invitations to redesign the product:

1. Confirm the exact current branch and final-publication hooks used to bind a
   source message ID after a managed final is accepted.
2. Confirm every supported managed runtime accepts the app-supplied
   `buzz-dev-mcp` server. Unsupported runtimes must report capability absence.
3. Confirm the safest Tauri/WebKit mechanism for an opaque sandboxed HTML
   document under the packaged app CSP.
4. Confirm the current local database initialization and blocking-thread
   convention to reuse.
5. Confirm route-search ownership for an artifact Canvas alongside thread,
   activity, profile, and management panels.
6. Confirm the mock bridge and Playwright project paths at implementation time.

`A00` may adjust source paths and adapter details. It may not silently change
the product or authority decisions above.

## Decisions deferred until their milestone

| Decision | Earliest owner |
|---|---|
| Multi-file static bundle limits and custom protocol | Post-static extension |
| Build toolchain and dev-server allowlist | Live Canvas milestone |
| Preview network grants | Live Canvas milestone |
| Encrypted cross-device artifact synchronization | Sync/share milestone |
| Shared collaborative boards | Board milestone |
| Public or room-visible artifact publication | Share milestone |
| Real HTML thumbnail capture | Library polish after safe renderer proof |

## Decisions an implementer may not make unilaterally

- upload local artifacts to relay media or a third party;
- publish absolute or relative source paths in signed events;
- add `allow-same-origin` to generated HTML preview;
- expose Tauri globals or application cookies/storage to preview content;
- auto-run package managers, build commands, or development servers;
- infer every file write as an artifact;
- catalogue unrelated files outside the selected working root;
- let artifact content become a system prompt, permission, or configuration;
- mutate the old Luca repository while using it as a reference;
- claim static V1 is a full live application runtime.
