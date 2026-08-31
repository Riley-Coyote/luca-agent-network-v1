# Luca Projects

**Status:** canonical implementation contract, approved 2026-08-30.
**Related:** [`CONVERSATION_MODEL.md`](CONVERSATION_MODEL.md).

A Project organizes Chats that share work context. It is deliberately simple:
one safe, syncable identity; optional private instructions; and one optional
working folder on each machine.

## Product behavior

- A Chat belongs to zero or one Project.
- A Project is a collection, not a workspace mode. Selecting it opens a second
  column of its Chats; there is no global "current Project" state.
- The same canonical Chat ID appears under its Agents, its Project, and the flat
  Chats quick list. Moving a Chat does not copy its timeline.
- Project Chats are ordered by activity. The Project collection itself may also
  use recent activity rather than alphabetical or fixed ordering.
- A Chat may contain one Agent, several Agents, visiting Agents, and people.
  Projects do not imply or own an Agent roster.

The older rail prototype grouped all rooms beneath Project headings in one
list. That prototype established useful recency behavior, but its localStorage
assignment map and always-grouped navigation are superseded. The current
design uses a dedicated Projects rail section and a contextual Chat column.

## Syncable Project identity

Project identity uses parameterized-replaceable kind `30179`, owned by the
user and keyed by its UUID `d` tag. Kind `30178` remains reserved for Luca's
existing exchange object.

Safe event content contains only:

- display name;
- archived state;
- schema version.

The UUID remains in the `d` tag. A Project event must never contain an absolute
path, private instructions, credentials, repository secrets, or file contents.

## Chat binding

Buzz `Channel` remains the signed transport primitive. A Chat's optional
Project UUID is stored in channel metadata and emitted as a `project` tag. Kind
`9002` metadata edits assign, move, or clear the binding. The database exposes
the resolved `project_id` for efficient collection queries.

Because a Chat has one optional Project, moving it is one metadata edit. There
is no join table and no multi-Project UI.

## Private machine-local settings

Each machine stores a private record keyed by `(owner, project_id)`:

- optional context/instructions;
- optional absolute working-folder path.

The folder may itself be a Git repository, but Luca does not require or expose
repository semantics here. The hidden NIP-34 repository browser remains an
unlinked compatibility feature at `/repositories`; user-facing `/projects`
belongs to this model.

Local settings must not be serialized into Nostr events, relay request bodies,
diagnostic receipts, model-visible tool arguments, or renderer logs. Public
Project events and channel metadata contain only the safe Project ID/name
information above.

## Agent runtime handoff

When an owned Agent answers in a Project Chat, Luca provides a bounded local
handoff to that Chat's ACP session:

- prepend the Project instructions to the local Agent prompt context;
- use the Project folder as the session working directory;
- rotate the runtime session when the Project binding, instructions revision,
  or folder binding changes.

If the folder no longer exists, Chat and messaging continue without a working
directory override. The Project collection and Chat header show **Reconnect
folder**. Luca must not delete, archive, or hide the Project or its Chats.

Project instructions alter context only. They never alter authority, tool
permissions, provider, model, budgets, Agent identity, or signing custody.

## Creation and settings

A Project can be created through the Projects UI or a confirmed conversational
proposal. The user supplies a name; a folder is optional and can be chosen
later. Persistent creation uses one compact confirmation, with private details
available behind Edit details.

Project settings allow:

- rename;
- archive/unarchive;
- edit private instructions;
- choose, reconnect, or clear the local working folder.

## Compatibility and migration

There is no existing Luca user Channel data requiring product migration or
conversion onboarding. The localStorage demo assignment map is removed rather
than migrated. Older clients ignore the new optional Project metadata and keep
working through existing Channel and DM event kinds.

## Acceptance

- Assigning or moving a Project changes one canonical Chat.
- The Chat is listed under every participant and its Project with the same ID.
- Project instructions and the valid folder reach only that Chat's local ACP
  session.
- Changing the binding rotates the session.
- A missing folder leaves messaging usable and shows Reconnect folder.
- Relay events contain no absolute local paths or private Project instructions.
- Wide and narrow collection navigation preserve back/forward state.

## Non-goals

- Multiple Projects per Chat.
- Multiple folders or general resource graphs per Project.
- A Project-specific Agent roster.
- Git hosting, repository migration, or a broad NIP-34 rename.
- Cross-Chat memory or Unified Brain.
