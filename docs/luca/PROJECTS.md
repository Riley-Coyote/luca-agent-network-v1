# Projects — grouping rooms by the work they belong to

**Status:** navigation, device-local projection, and device-local runtime
context defaults implemented. Connected-source discovery remains owned by the
Brain surface.

**Visual authority:**
[`project-navigation/VISUAL_FIDELITY_CONTRACT.md`](project-navigation/VISUAL_FIDELITY_CONTRACT.md).

## Product model

- A project is a navigable container for rooms.
- A room remains the canonical conversation unit.
- One room belongs to at most one project.
- DMs and rooms without a project remain directly available under `Rooms`.
- Selecting a project opens its remembered or most recently active room; it is
  never a second-click inbox.
- A project may supply device-local working-context defaults to its rooms. It
  still does not grant Brain access, relay authority, resident ownership, or
  tool permission.
- A room may replace the inherited working folder or add room-only sources.
  Those changes stay in that room until the owner explicitly selects **Save to
  project**.

The persistent global rail stays unchanged. Project rooms appear in the
contextual navigator inside the main application card rather than nested below
the project row. This is the approved master-detail pattern shared with the
Agent Library.

## Current implementation

| File | Responsibility |
|---|---|
| `features/channels/lib/roomProjects.ts` | Owner/relay-scoped local project catalog, one-project-per-room assignments, migration from the old prototype keys, and the reviewed mutation seam for Brain Setup. |
| `features/projects/lib/projectNavigator.ts` | Pure project-room view model and room filtering. |
| `features/projects/ui/ProjectRoomWorkspace.tsx` | Contextual room navigator, empty state, responsive transition, and composition around the real conversation surface. |
| `features/sidebar/ui/ChatList.tsx` | Loose rooms plus one global-rail row per project. |
| `app/routes/ChannelRouteScreen.tsx` | Derives project context while keeping `/channels/:channelId` canonical. |
| `app/routes/projects.$projectId.tsx` | Empty-project and project-entry route; preserves the older repository-project route for unrelated IDs. |
| `src-tauri/src/luca/conversation_context.rs` | Owner/relay-scoped native authority for project defaults, room overrides, opaque source bindings, availability, revisions, and exact dispatch snapshots. |
| `features/luca/context/ConversationContextComposerSurface.tsx` | Single composer entry point, compact context chip, inheritance-aware drawer, missing-folder recovery, and local change marker. |

The local projection is versioned and scoped by owner public key and relay, so
one identity or home cannot inherit another's project organization. Existing
unscoped prototype data migrates once. Writes are reactive in the current
window and across storage events.

## Filesystem privacy boundary

A local filesystem path must never appear in a relay event, room metadata,
message, evidence log, or public project identifier. It discloses the owner's
username and directory layout and is different on every device.

The native context authority resolves a project or room's opaque connected
source IDs through the existing device-local connected-source store. Absolute
paths never enter renderer persistence, project metadata, relay events,
messages, or context receipts. A moved or missing path changes only the
working-context status; it never deletes or hides the project or its rooms.

## Brain and runtime boundary

Brain Setup continues to use the existing frontend seam rather than inventing
a second project catalog:

- `replaceRoomProjects(ownerPubkey, relayUrl, projects)` commits the reviewed
  catalog.
- `assignRoomProject(ownerPubkey, relayUrl, channelId, projectId)` assigns or
  unassigns exactly one room.
- `workingContextStatus` is a coarse project-list projection. The native
  `ConversationContextViewV1` is authoritative for per-room readiness.

The context layer now provides:

1. one optional primary working folder and bounded additional sources;
2. project inheritance, isolated room overrides, explicit promotion, and
   optimistic revision checks;
3. trusted native path resolution that never crosses the renderer/relay
   privacy boundary;
4. exact context freezing before a managed owner event is published; and
5. source grants that remain separate from project membership.

Selecting a source for runtime context does not create a Brain grant. Brain
retrieval remains limited to grants already held by the resident. Native folder
access follows the selected runtime adapter's existing approval behavior.

## Do not

- Do not create a global "current project" runtime mode or a process-wide cwd.
- Do not put local paths on the relay.
- Do not give every resident in a room automatic source or memory access.
- Do not make a room belong to multiple projects without redesigning the
  navigation and authority model.
- Do not restore the old Slack-style inbox or nest project rooms in the global
  rail.
