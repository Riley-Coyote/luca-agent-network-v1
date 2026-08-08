# Project–Room Navigation Production Handoff

Updated: 2026-08-08

## Outcome

The approved Project → Room navigation is implemented in the real Luca shell.
It composes the existing global rail, conversation header, message timeline,
composer, inline replies, and inspector rather than recreating any of them.

Three navigation paths are now explicit:

1. A DM or loose room opens the full-width conversation directly.
2. A project room opens the contextual room navigator beside that same
   conversation.
3. An empty project opens the navigator plus a purposeful create-first-room
   state.

Room routes remain `/channels/:channelId`. `/projects/:projectId` is used only
to resolve a project entry or represent an empty project. Browser history,
deep links, and direct conversation selection retain the existing route model.

## Data boundary

The UI consumes one owner/relay-scoped device-local projection:

```text
RoomProjectStoreV1
  projects[]
  assignments[channelId] -> projectId
```

The store is versioned, validated, reactive, and migrates the old unscoped
prototype keys once. It does not contain credentials, message bodies, memory,
or filesystem paths. Project and room membership grant no additional
authority.

Brain Setup is the next producer of this projection. It should use
`replaceRoomProjects` and `assignRoomProject`, then add a separate trusted
device-local path binding after the import/consent flow is designed.

## Demo boundary

Deterministic Luca, Polyphonic, and Field Unit data exists only when the mock
runtime is active with `projectDemo=1` (or the older `notebookDemo=1` fixture
flag). It is never written to a native profile. A production profile with no
confirmed projects continues to show every conversation under `Rooms`.

## Verification

See [`RUN_LOG.md`](RUN_LOG.md) for command results and
`evidence/project-room-navigation/visual/` for the approved desktop, compact,
mobile, empty, DM, and inspector states.

## Next slice

Brain Setup should begin with a read-only source audit and an import-preview
contract. Do not couple source discovery, project creation, room assignment,
resident grants, or memory ingestion into one irreversible action.
