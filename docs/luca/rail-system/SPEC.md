# The rail, ironed out

Spec, 2026-10-23, from Riley's notes on the rail-glass test build. Not built yet. Everything here is measured against
this file; change the file first when a decision changes.

## The sentence

**Luca first; then every place you talk, each with its sessions nested under its name.**

The rail is a short list of homes (Luca, projects, agents, fleets). A home's sessions sit under it on a thin thread,
the way Claude Code nests task sessions under their session. Nothing is listed twice.

## Top to bottom

```
‹traffic lights›  ‹collapse›  ‹ ›
Search everything                          ⌘K
Library · New conversation · Agents · Activity · Brain · Settings     (unchanged)

Luca                                        ← the main thread, above everything else

PROJECTS                                  +
Tidepool  ⌄                               +   ← + appears on hover/focus: new session in this project
│ Landing page copy
│ Chapter nine
Studio site  ›
Field guide  ›

AGENTS                                    +
Atlas  ›
Wren  ⌄                                   +   ← + : new session with Wren
│ Monday plan
│ The tide tables

FLEETS                                    +   ← was "Conversations"
Design team  ›
Luca + Wren  ›
```

- **Luca** moves above Projects, directly under the pinned links. Clicking Luca opens the main Luca thread. Luca's other
  sessions, if any, nest under Luca like any agent's (collapsed by default).
- **Runtimes** leaves the rail (see Decisions); it is infrastructure, not a place you talk.

## One home per chat

Every chat appears exactly once:

1. A chat that belongs to a **project** lives under that project.
2. Otherwise, a chat with **more than one agent** (a group) lives under **Fleets**.
3. Otherwise, a chat with **one agent** lives under that agent (Luca's under Luca).
4. A 1:1 chat with someone not in the agent list (a removed agent, a person) is listed under Agents by that
   participant's name, so it is never lost.

Today `chatsWithAgent` lists every chat an agent is in, so project rooms and group chats also appear under each agent,
and groups appear twice. That goes.

## A row

- **No glyphs.** Agents, projects and fleets show their name only. The pinned links keep their icons (they are
  navigation, and the icon rail will need them). The resident identity mark lives in the conversation, not the rail.
- **Parent row** (Luca, a project, an agent, a fleet): name, then a small chevron right after the name when it has
  sessions (`›` closed, `⌄` open), then, at the right edge, one trailing slot: the unread dot, or "working…", or the
  `+` on hover and keyboard focus. Never two things in that slot at once; on hover the `+` wins.
- **The `+` on the row** starts a new session in that home (an agent: a new session with that agent; a project: a new
  room in it; a fleet: a new session with the group). The "New session" and "Chat with …" rows under agents go away.
- **Child row** (a session): indented, on a 1 px thread line at the left (the ink at 16%), quieter text than parents
  (homes are `ink-muted`, sessions `ink-faint`), the session's title only, no icon, and the same single trailing slot
  (unread dot or "working…"; no timestamps on children).
- **Tones:** homes muted, sessions faint, the thread the ink at 16%; the open session's text and its segment of the
  thread at full ink. (Amended 2026-10-24 in WP-02b, as the shell study draws them.)
- **Corners:** rows have 8-point corners, never a pill (as `SHELL_SPEC.md`, "Where you are").
- Section headers keep their mono caps eyebrow and their `+`.

## Selection

- **The glass is the home, not the session.** The rail's glass selection (the web pill, or Apple's glass in native
  builds) sits on the parent row of whatever is open: Luca, the project, the agent, the fleet, or a pinned link.
  It never moves onto a child row.
- **The open session** under it is marked with light, not a second pill: its text goes from `ink-faint` to full ink,
  and the thread line beside it lights (the 1 px segment next to that row goes to full ink). Nothing else changes.
  With Increase Contrast the lit segment widens to 2 px.
- In the DOM: the parent row carries `data-active="true"` while any of its sessions is open (so both glasses already
  follow it); the open child carries `data-current="true"` (never `data-active`) and `aria-current="page"`.
- Opening a parent opens its main session: Luca's thread, the agent's 1:1, the project's last room, the fleet's
  newest session. It also expands the parent. Clicking the chevron only expands or collapses.
- Expansion is remembered per home (the agent rail already stores it; extend that to projects and fleets).
- A collapsed parent whose session is open still carries the glass, so you can always see where you are.

## Projects

- By default a project nests its rooms in the rail, like an agent's sessions. Selecting the project opens its last
  room in the normal conversation view, with no extra column.
- The project room column (`ProjectRoomWorkspace`, the contextual navigator in the card) becomes an option:
  Settings → Appearance → "Project rooms: In the rail (default) · In a column". When "In a column", projects behave as
  they do today, and the rail draws their rows as today's rail does: no chevron and no nested rooms, so no room is
  listed twice.
- A project's details and sources live on its row's menu (right-click, the menu key, or Shift+F10), and its rooms are
  found by Search (⌘K), which opens them.

## Fleets

- "Conversations" is renamed **Fleets**: persistent groups of agents the owner sets up (a design team, a dev team).
- Its `+` creates a fleet: pick agents, give it a name. A group chat without a name shows its members ("Luca + Wren")
  until it is named.
- A group is named by its members, never by one of its chats: a group with one chat is that chat, by its own name
  (no chevron); a group with several is named by its members ("Luca + Wren", Luca first, then by name; anyone who
  can't be named is counted, "+ 1 other"), and each chat is a session under it by its own name; opening it opens the
  most recent. When fleets get their own record and name, the record's name wins. (Amended 2026-10-24 in WP-02b.)
- A fleet can hold several sessions; they nest under it like an agent's.

## Keyboard and access

- Up and down move between visible rows; Right opens a parent (or moves into its first session); Left closes it (or
  moves back to the parent). This exists for agents today (`AgentRail.tsx`); every parent gets it.
- The `+` is reachable by Tab on the row and has a label ("New session with Wren", "New room in Tidepool").
- Rows keep the focus ring the glass rail uses; their hit shape has 8-point corners, never a pill, as the shell's
  study and `SHELL_SPEC.md` ("Where you are": "a capsule at this size reads cheap") have it. Homes and their sessions
  share that one corner. (Amended 2026-10-24 in WP-02's fix pass; this line said "the 999 px capsule hit shape".)
- A home with sessions says whether it is open on its own button (`aria-expanded`, `aria-controls` naming its
  sessions); the chevron is a mouse target only, hidden from the keyboard and screen readers.
- Reduce Motion: expansion is instant.

## Decisions (Riley)

1. **Runtimes:** move the section out of the rail into the Agents page (recommended), or keep it collapsed at the
   bottom of the rail.
2. **"Fleets"** as the name (recommended, Riley's), or "Groups" or "Teams".
3. **The open session's mark:** lit text and a lit thread segment (recommended), lit text only, or a small glass drop on
   the thread beside it (Apple's glass in native builds; a later experiment).

## Out of scope here (next)

The icon rail that opens into the full rail (the glass disc stretching into the row capsule), and the top lip over the
card for tabs. They build on this rail once it is right. The frame around the rail, as decided in the shell study, is
`SHELL_SPEC.md`; where the two differ on the selection, the shell's solid marks replace the rail's glass.

## Where it lives

- `desktop/src/features/sidebar/ui/ChatList.tsx`: the rail's sections, `ChatRow`, `ProjectRow`, `RailSectionHeader`.
- `desktop/src/features/sidebar/ui/AgentRail.tsx`: Luca's row, agent rows, sessions, the "New session" rows.
- `desktop/src/features/sidebar/lib/chatListModel.ts`, `agentRailState.ts`: who a chat belongs to
  (`chatsWithAgent`, `standaloneConversations`, `groupChats`), and remembered expansion.
- `desktop/src/features/sidebar/ui/AppSidebar.tsx`: wiring (`selectProjectFromRail`, `openAgentFromRail`,
  `setNewSessionPubkey`), the Runtimes section (`RuntimeRailSection`).
- `desktop/src/features/projects/ui/ProjectRoomWorkspace.tsx`, `desktop/src/app/routes/ChannelRouteScreen.tsx`: the
  project column.
- `desktop/src/features/sidebar/ui/railGlass.css`, `RailGlass.tsx`, `NativeRailGlass.tsx`: the glass follows
  `data-active`; it needs no change if the rows carry the attributes above.

## Done means

- Every rule above holds in the lab scene (`/scripts/shell-lab.template.html?scene=ad`) and in the rail-glass test
  build, checked with screenshots of: nothing open; Luca open; an agent's session open (glass on the agent, the session
  lit); a project room open; a fleet open; a collapsed parent with an open session; hover showing the `+`; keyboard
  focus on a `+`.
- No chat appears twice (a unit test over the grouping).
- `tsc`, biome, the desktop unit tests and the desktop gates pass.
