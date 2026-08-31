# Luca conversation model

**Status:** canonical product contract, approved 2026-08-30.

This document is the source of truth for Luca's user-facing conversation and
delegation model. Older documents that describe one permanent DM per resident,
immutable DM membership, an expanded replacement DM, or Channels as Luca's
organizational model are historical only.

## The six concepts

### Agent

An Agent is a persistent AI identity owned by the user. Its public identity
survives model, provider, executable, and runtime-session changes. The UI may
refer to an Agent as a resident in lore or internal implementation names, but
the product navigation label is **Agents**.

The same Agent can participate in any number of Chats. Creating another Chat
does not create another Agent. A visiting Agent is a normal Chat participant,
but is not added to the owned Agents roster and does not become a persistent
Luca Agent.

### Chat

A Chat is one independent conversation with its own stable UUID and signed
timeline. Chats may contain the owner, one Agent, several Agents, and other
people. The user may create multiple Chats with the same participant set.

Participants can be added to or removed from the same Chat. Adding an Agent
never copies the conversation and never opens a replacement Chat. Luca retains
Buzz `Channel` internally as the signed transport and storage primitive; Chat
is the user-facing name.

A Chat belongs to zero or one Project. Every appearance of a Chat in Chats,
under an Agent, or under a Project references the same canonical Chat ID.

### Project

A Project organizes Chats that share work context. It is not a workspace mode:
selecting a Project simply opens its Chat collection. A Chat can be moved to or
removed from a Project without copying its conversation.

Safe Project identity (ID, display name, archived state) may sync through the
relay. Private instructions and one optional working folder are local to the
machine. Absolute paths and private Project instructions must never be placed
in relay events. If the folder is missing, the Chat continues normally and the
UI offers **Reconnect folder**.

### Team

A Team is a saved roster of existing, persistent Agents, stored by their stable
public keys. It does not create duplicate Agent instances. Team instructions
apply to the assignment or Chat context and do not rewrite each Agent's
permanent definition.

### Task

A Task is work happening inside a Chat. Luca represents it through delegation
receipts and status (`requested`, `working`, `waiting`, `completed`, `failed`,
or `cancelled`). Task is not a separate database entity, navigation section, or
conversation hierarchy.

### Delegation

Conversational requests have two intentionally different effects:

- "Bring Maya in" or "ask Maya here" adds Maya to the current Chat.
- "Send Maya to research this" creates a new focused Chat for that assignment.

A focused delegation Chat contains the owner, the delegating primary Agent,
and the assigned Agent or Team members. It inherits the source Project unless
the user chooses another one. The source Chat receives linked status receipts
and the final result or blocker, so the user may continue working only through
their primary Agent.

Reply routing remains exact-addressed: a reply addresses its author and
explicit mentions add recipients. Agent-to-agent work must be intentional and
must not create response loops.

## Navigation contract

The left rail contains:

- **Chats:** one flat, recency-sorted quick list. Selecting an item opens its
  conversation directly.
- **Agents:** owned Agents, plus Teams when Teams exist. Selecting an Agent
  opens a contextual column containing that Agent's Chats.
- **Projects:** Projects. Selecting one opens a contextual column containing
  that Project's Chats.
- Activity, Brain, and Settings remain separate utilities.

The contextual column is a collection view, not a second copy of any Chat.
Wide windows show rail, collection, and conversation together. Narrow windows
use the same order as a stacked flow: collection, Chat list, conversation.
`/channels/:id` remains the canonical internal Chat route during the Buzz-derived
implementation.

## Creation and confirmation

An owned Agent may conversationally propose an Agent, native link, Team, or
Project. Persistent creation uses one compact confirmation containing the
resolved defaults and an Edit-details path. Adding an existing participant or
explicitly delegating work may execute directly and leaves a visible receipt.

The proposal bridge is local and typed. It provides no owner key, Agent key,
relay signing capability, arbitrary Tauri access, or authority over native
Hermes/OpenClaw configuration. Luca Desktop validates the requester, source
Chat membership, referenced records, and idempotent request ID before acting.

## Continuity boundary

Chats carry their own signed history. They do not pretend to provide global or
cross-Chat memory. Cross-Chat discovery, memory, and continuity belong to the
later Brain work and are not a dependency for normal conversation, Agent
creation, Project context, or delegation.

## Compatibility boundary

- Buzz Channel events, search, archive, unread state, attachments, and timeline
  infrastructure remain in place.
- Legacy kinds `41010` and `41011` remain available for older desktop/mobile
  clients, while the new desktop UI creates fresh Chats through channel create
  and membership events.
- Mobile retains its current idempotent DM-opening UX for this milestone and
  learns only the compatible Project and mutable-membership fields.
- The hidden NIP-34 repository browser remains a compatibility feature at
  `/repositories`; user-facing `/projects` belongs to Luca Projects.

## Explicit non-goals

This model does not introduce Unified Brain, temporary Agents, a Task manager,
multiple Projects per Chat, multiple folders per Project, native-config writes,
a full mobile navigation redesign, a conductor, a general orchestration or
signing service, or a rebuild of Buzz messaging.
