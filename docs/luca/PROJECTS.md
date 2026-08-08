# Projects — grouping rooms by the work they belong to

**Status:** navigation and device-local projection implemented; project/source
creation belongs to the Brain Setup slice.

**Visual authority:**
[`project-navigation/VISUAL_FIDELITY_CONTRACT.md`](project-navigation/VISUAL_FIDELITY_CONTRACT.md).

## Product model

- A project is a navigable container for rooms.
- A room remains the canonical conversation unit.
- One room belongs to at most one project.
- DMs and rooms without a project remain directly available under `Rooms`.
- Selecting a project opens its remembered or most recently active room; it is
  never a second-click inbox.
- A project changes navigation only. It does not grant filesystem, memory,
  tool, resident, or runtime authority.

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

The local projection is versioned and scoped by owner public key and relay, so
one identity or home cannot inherit another's project organization. Existing
unscoped prototype data migrates once. Writes are reactive in the current
window and across storage events.

## Filesystem privacy boundary

A local filesystem path must never appear in a relay event, room metadata,
message, evidence log, or public project identifier. It discloses the owner's
username and directory layout and is different on every device.

Brain Setup may later bind a reviewed project ID to an absolute local path.
That binding must remain device-local. A moved or missing path changes only the
working-context status; it never deletes or hides the project or its rooms.

## Brain Setup handoff

Brain Setup should use the existing frontend seam rather than inventing a
second project store:

- `replaceRoomProjects(ownerPubkey, relayUrl, projects)` commits the reviewed
  catalog.
- `assignRoomProject(ownerPubkey, relayUrl, channelId, projectId)` assigns or
  unassigns exactly one room.
- `workingContextStatus` is presentation metadata only until trusted native
  path commands are added.

The next slice still needs to design and implement:

1. discovery and preview of repositories, folders, and other intelligence;
2. explicit project creation/import confirmation;
3. a trusted native path binding that never crosses the renderer/relay privacy
   boundary;
4. room creation/assignment UX using the approved project navigator;
5. source grants that remain separate from project membership.

## Do not

- Do not create a global "current project" runtime mode.
- Do not put local paths on the relay.
- Do not give every resident in a room automatic source or memory access.
- Do not make a room belong to multiple projects without redesigning the
  navigation and authority model.
- Do not restore the old Slack-style inbox or nest project rooms in the global
  rail.
