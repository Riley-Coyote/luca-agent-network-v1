# Luca Project–Room Navigation Visual-Fidelity Contract

Status: approved implementation authority, 2026-08-08.

## Authority order

1. The current production Luca components and `conversation-shell.css`.
2. `project-room-navigation-prototype.html` for layout and state behavior only.
3. Luca project-local design documentation.
4. Riley's global design language.

Prototype typography, colors, icons, message formatting, controls, and data are
not production references.

## Product model

- A project is a navigable container for rooms.
- A room remains the canonical conversation unit.
- A DM or room without a project opens directly at full conversation width.
- A project room opens with a contextual room navigator inside the existing
  application card.
- Project selection changes navigation only. It grants no memory, filesystem,
  tool, runtime, or messaging authority.

## Preservation boundary

The production global rail, blackout material ladder, conversation header,
timeline, inline replies, composer, attachments, microphone, permission cards,
cancellation, identity specimens, inspector, Agent Library, and Notebook remain
their existing components. The implementation must compose around them rather
than reproduce or restyle them.

## Global rail

- Preserve the current width, spacing, type, search, nav rows, owner footer,
  focus/hover states, and off-canvas behavior.
- `Rooms` contains DMs and rooms without a project.
- `Projects` contains one row per project.
- Project rooms never render nested in the global rail.
- Selecting a project opens its remembered room, falling back to the most
  recently active room. An empty project uses `/projects/:projectId`.

## Contextual project navigator

The navigator is 304px on standard desktop and 274px on compact desktop. It
uses the same master-detail grammar as the approved Agent Library and contains:

- project name and compact working-context status;
- an icon-only New room action with an accessible label and tooltip;
- room search;
- ledger-style room rows with existing identity specimens, name, one-line
  preview, and honest unread/activity/time state;
- Sources and Project details footer actions.

The full local path is never shown here or in the conversation header. Missing
local context is a non-destructive status. Filters are deferred.

## Routing and responsive behavior

- Room URLs remain `/channels/:channelId`.
- The shell derives the project navigator from the room assignment.
- Empty projects use `/projects/:projectId`.
- Only the last-selected room ID per project is persisted as local UI state.
- On mobile, a project first shows its room list; choosing a room replaces it
  with the conversation and exposes clear back navigation.
- The existing inspector keeps its overlay behavior at constrained widths.

## Required states

Loading, populated, empty, search results, no results, selected, unread,
working, missing local context, archived/read-only room, failed metadata load,
inspector open/closed, keyboard focus, and reduced motion must all remain
legible. Project metadata failure must never make messaging unusable.

## Verification baseline

Before approval, capture populated project, direct DM, and empty project at
1440x900, 1280x800, 1024x768, and 390x844. Reject any global-rail regression.
Verify project restoration and switching, search, empty state, deep links,
back/forward, loose-room bypass, inspector coexistence, overflow, focus order,
console errors, contrast, and reduced motion. Run messaging regressions once
after visual approval.
