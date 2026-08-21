# Source Map

This map records likely integration seams as of packet authoring. `A00` must
reconcile them against the active branch before implementation.

## Current Luca seams

| Concern | Current source | Intended use |
|---|---|---|
| App routes | `desktop/src/app/routes/`, `desktop/src/app/routeTree.gen.ts` | Add Library index/detail routes through existing TanStack Router generation |
| Shell route classification | `desktop/src/app/AppShell.helpers.ts`, `desktop/src/app/AppShell.tsx` | Add `library` as a first-class selected view |
| App navigation | `desktop/src/app/navigation/useAppNavigation.ts` | Add Library/artifact navigation with back/forward behavior |
| Primary sidebar | `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx`, `AppSidebar.tsx` | Add Library entry without reintroducing workspace modality |
| Auxiliary pane | `desktop/src/features/channels/ui/RightAuxiliaryPane.tsx`, `ChannelPane.tsx` | Host conversation Canvas using existing resize/responsive behavior |
| URL-backed panel state | `desktop/src/features/channels/ui/useChannelPanelHistoryState.ts` | Add selected artifact/version and prior-pane return state |
| Existing Channel Canvas | `desktop/src/features/channels/ui/ChannelCanvas.tsx`, `ChannelManagementSheet.tsx`, `desktop/src-tauri/src/commands/canvas.rs` | Rename user-facing copy to Room brief; preserve relay transport |
| Message projection | `desktop/src/features/messages/ui/`, `desktop/src/features/messages/lib/` | Project local artifact receipts beside signed messages without fake events |
| Existing preview components | `desktop/src/shared/ui/markdown.tsx`, `desktop/src/shared/ui/markdown/CodeBlock.tsx`, `SimpleImageLightbox.tsx` | Reuse safe typography and display primitives |
| Media sniffing/safety | `desktop/src-tauri/src/commands/media.rs`, `media_download.rs` | Reuse or extract MIME/filename/size validation patterns without using relay storage |
| Tauri command registry | `desktop/src-tauri/src/commands/mod.rs`, `desktop/src-tauri/src/lib.rs` | Register artifact service commands through the integrator mutex |
| Local SQLite precedent | `desktop/src-tauri/src/archive/`, `desktop/src-tauri/src/managed_agents/retention.rs` | Reuse WAL, blocking-thread, busy-retry, and test conventions |
| App-data storage precedent | `desktop/src-tauri/src/managed_agents/storage.rs` | Resolve app-data root and safe directory permissions |
| Typed renderer IPC | `desktop/src/shared/api/tauri.ts` | Prefer a dedicated `tauriArtifacts.ts` module and narrow exports |
| Mock Tauri bridge | `desktop/tests/helpers/bridge.ts` | Add artifact fixtures and command parity for E2E |
| Desktop E2E | `desktop/tests/e2e/`, `desktop/playwright.config.ts` | Add Library/Canvas/conversation specs and visual states |
| ACP observer | `crates/buzz-acp/src/observer.rs`, `desktop/src/features/agents/` | Reuse safe tool activity; exclude body/path data |
| MCP server | `crates/buzz-dev-mcp/src/` | Add narrow create/update/read/list artifact tools |
| MCP provisioning | `crates/buzz-acp/src/lib.rs::build_mcp_servers`, `crates/buzz-acp/src/acp.rs` | Pass only artifact MCP bootstrap data to the designated MCP child |
| Runtime lifecycle | `desktop/src-tauri/src/managed_agents/runtime.rs` | Create, bind, invalidate, and clean artifact broker sessions |
| Shared protocol | `crates/luca-protocol/src/`, `schemas/luca/` | Add versioned artifact broker requests/results and vectors |
| Managed final publication | `crates/buzz-acp/src/luca_final_publisher.rs`, `desktop/src-tauri/src/luca/managed_message_publisher.rs` | Link local receipts to accepted message ID without changing message content/tags |
| Community reset | `desktop/src/features/communities/useCommunityInit.ts` | Clear artifact renderer/query singletons on scope change |
| Artifact scanning | `scripts/evidence/scan_artifacts.py`, `crates/luca-diagnostics/` | Prove evidence contains no protected bodies, paths, or capabilities |

## Proposed new production paths

```text
desktop/src-tauri/src/artifacts/
  mod.rs
  model.rs
  store.rs
  blobs.rs
  capture.rs
  broker.rs
  recovery.rs
  tests.rs

desktop/src-tauri/src/commands/artifacts.rs
desktop/src/shared/api/tauriArtifacts.ts

desktop/src/features/artifacts/
  hooks/
  types.ts
  lib/
  ui/library/
  ui/canvas/
  ui/renderers/

desktop/src/app/routes/library.tsx
desktop/src/app/routes/library.$artifactId.tsx

schemas/luca/artifacts/
crates/luca-protocol/src/artifact.rs

desktop/tests/e2e/artifacts/
```

The implementation may adjust filenames during `GA0`, but it must keep one
coherent feature boundary and avoid scattering artifact persistence across
message, media, and project modules.

## Read-only behavioral references

The prior Luca v2 implementation remains a reference for behavior only:

- versioned canvas artifact identity and append-only versions;
- Library catalog, search, type filters, source-conversation links, and pinning;
- multi-artifact conversation handling;
- automatic Canvas open/update;
- source/preview/diff/version controls;
- generated images flowing into Library and Canvas.

Do not copy its Electron/Node server, separate databases, raw HTTP API,
filesystem path exposure, remote CDN renderer dependencies, or iframe policy
without reconciling them with this packet.

## Adjacent contracts

- `HANDOFF.md` — current product/authority truth and branch direction.
- `docs/luca/G1_CHECKLIST.md` — core messaging/runtime gate that normally
  precedes artifact implementation.
- `docs/luca/PROJECTS.md` — safe project ID versus local-only path split.
- `.codex/luca-v1/SECURITY_THREAT_MODEL.md` — keys, paths, descendants,
  logging, and authority rules.
- `.codex/luca-v1/USABLE_BUILD_MODE.md` — focused verification and failure
  budget while milestone-grade verification is paused.

## Source-map stop conditions

Stop at `GA0` if source reality shows that implementation would require:

- artifact bytes in relay events;
- resident keys or signing capability in ACP/model/MCP descendants;
- arbitrary renderer filesystem access;
- weakening the managed permission channel;
- a dev server or build command to satisfy the static demo;
- wholesale replacement of Buzz messaging/media transport;
- edits to the read-only legacy Luca source.
