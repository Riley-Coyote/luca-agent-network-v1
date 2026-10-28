# The rail, ironed out

Spec, 2026-10-23, from Riley's notes on the rail-glass test build. Not built yet. Everything here is measured against
this file; change the file first when a decision changes.

**Amended 2026-10-25 (Riley):** the rail now follows the place you're on (`NAVIGATION.md`). This file is the rail of
**Chats**. The other places' rails are in `NAVIGATION.md`. People and Rooms are new, Luca's side conversations nest
under Luca, every home shows its latest conversations with their times, and Fleets retire (their teams live on as
Groups in Agents).

## The sentence

**Luca first; then every place you talk, each with its sessions nested under its name.**

The rail is a short list of homes (Luca, projects, agents, people, rooms). A home's sessions sit under it on a thin
thread, the way Claude Code nests task sessions under their session. Nothing is listed twice.

## Top to bottom

```
CHATS                                     +   ← new conversation (⌘N)

Luca                                        ← the main thread, above everything else
│ Fifty · launch notes             ●        ← Luca's side conversations; a talking one never folds
│ Claude Code · build

PROJECTS                                  +
Tidepool  ⌄                               +   ← + appears on hover/focus: new session in this project
│ Landing page copy                   2h
│ Chapter nine                        1d
Studio site  ›

AGENTS
Atlas  ›
Wren  ⌄                                   +   ← + : new session with Wren
│ Monday plan                         3h

PEOPLE                                        ← shown once there is one
Sam

ROOMS                                     +   ← always shown (its + is a way in); was "Fleets"
Design review
Luca + Wren
Browse rooms…
Archived
```

- **Luca** is pinned first. Clicking Luca opens the main Luca thread. Under Luca sit Luca's **side conversations**:
  the agents and connected apps (Claude Code, Codex…) Luca is asking now or asked recently. A side conversation that is
  talking never folds away; quiet ones fold after the latest few.
- **Runtimes** leaves the rail (see Decisions); it is in Agents now, named **Connected** (`NAVIGATION.md`).
- **The places** (Search, Chats, Agents, Activity, Library, Settings) are the column beside the rail
  (`SHELL_SPEC.md`), so the rail starts with its own heading.

## One home per chat

Every chat appears exactly once (amended 2026-10-25):

1. A chat that belongs to a **project** lives under that project.
2. Otherwise, a side conversation **Luca holds with another agent or a connected app** lives under **Luca**.
3. Otherwise, a 1:1 chat with **an agent** lives under that agent (your own conversation with Luca is Luca's row).
4. Otherwise, a 1:1 chat with **a person** lives under **People**.
5. Otherwise (several members, or a shared room) it lives under **Rooms**, by its own name. A conversation with no
   name shows its members ("Luca + Wren") until it is named.

A chat's home is decided by what it is (a project's, a side conversation, a 1:1, a shared room), never only by who is
in it: until now (`railHomes.ts`, `homeIdOfChat`) membership alone decided it, so a public room with two others became
a "fleet" and a 1:1 with a person was filed under Agents.

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
  (unread dot or "working…"; otherwise how long ago it was last active, quietly: "2h", "1d"; amended 2026-10-25).
- **The latest few show** (amended 2026-10-25): every home shows its latest three conversations without being opened,
  so the rail never reads empty; the rest are one click away ("3 more"). The open conversation is always visible.
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
- A project's rooms hang on no thread: their titles sit under the project's name, quieter, with no line beside them.
  The thread is for work, "for agents and their task sessions specifically. so like not below projects" (Riley,
  2026-10-27). WP-34 had read that as "projects never nest"; it never meant that, and the rooms are back under it.
- The project room column (`ProjectRoomWorkspace`, the contextual navigator in the card) becomes an option:
  Settings → Appearance → "Project rooms: In the rail (default) · In a column". When "In a column", projects behave as
  they do today, and the rail draws their rows as today's rail does: no chevron and no nested rooms, so no room is
  listed twice.
- A project's details and sources live on its row's menu (right-click, the menu key, or Shift+F10), and its rooms are
  found by Search (⌘K), which opens them.

## Rooms (Fleets retired, 2026-10-25)

- **Rooms** lists conversations with several members and shared rooms outside a project, each by its own name. A room
  without a name shows its members ("Luca + Wren", Luca first, then by name; anyone who can't be named is counted,
  "+ 1 other") until it is named.
- Its `+` starts a room (most rooms Luca starts for you). Its last rows are **Browse rooms…** (the channel browser:
  join a room you're not in) and **Archived**.
- Always shown (amended 2026-10-26): its `+` and Browse rooms… are ways in, even before the first room. A section
  shows when it has something in it, or a `+` to make its first thing (`NAVIGATION.md`).
- Why Fleets went: in code a fleet was only "everyone in this chat", derived from members, with no name, record or
  page. Riley's idea for them (persistent teams such as a design team) lives on as **Groups** in Agents
  (`NAVIGATION.md`); a team's conversations are rooms.

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
4. **2026-10-25** (`NAVIGATION.md`): the rail follows the place; this is the Chats rail; Luca's side conversations
   under Luca; People and Rooms added; Fleets retired (teams are Groups in Agents); the latest three conversations of
   every home show, with their times; opening the app lands on Luca.

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
