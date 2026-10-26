# Navigation

Decided with Riley, 2026-10-25, from the map at https://claude.ai/artifact/HH73YMr319GpRe1udQF74P (private), which drew
every place from a read of the code (notes: `~/.claude/plans/polyphonic-shell-build/nav-map/`). This file is what the
shell's places, rails and cards are measured against. `SHELL_SPEC.md` is the frame they sit in; `SPEC.md` is the Chats
rail in detail. Change this file first when a decision changes.

## The sentence

**You talk to Luca. Luca does the rest. The desktop is Luca's home: where you look in on everything, go deep, and raise
your minds.**

"Luca" stands for whoever someone chooses as their main companion, made in the app or brought in.

## The screen's rule

The icons pick the place. The rail lists what's in that place. The card shows the one thing you picked. Details open as
a card on the right. Settings already works this way; every place does.

Riley, 2026-10-25: "the rail should always have the contents of the page you're on." Until now the rail never changed
(Luca, Projects, Agents, Fleets on every page) and Agents drew a second list inside the card.

## One Luca, three doors

- **Ghost on the Mac:** talk to Luca while you work, from the notch. Quiet.
- **Ghost on the phone:** talk anywhere, and answer what needs you. As simple as it can be.
- **Polyphonic desktop:** the home. Everything at full depth: every conversation, each mind's own space, everything
  made, the whole record. You come here to look in, go deep and raise your minds, not to do chores.

Same Luca, same memory, same one conversation on every door. Riley: "in a perfect world a user really doesnt even use
polyphonic desktop that much."

## Who does what

- **You:** talk to Luca; answer what Luca asks; approve what needs you; look in; shape who your minds become.
- **Luca:** makes specialist agents for jobs and repeat work; sets up projects and their rooms; works with Claude Code,
  Codex and Grok for you; asks other agents in side conversations; brings an agent into your chat when you @ it, for as
  long as you keep talking to it; works while you're away and tells you what happened; writes in its notebook, for you
  and for itself.
- So every button that makes something (a project, a room, an agent) is also something you can ask Luca for, and Luca's
  way comes first. The screen shows what Luca did; it doesn't hand you forms. The buttons stay, quieter.
- This keeps `docs/luca/CONVERSATION_MODEL.md`: one conversation with each mind, forever; @ brings someone in, reply
  keeps them in, silence lets them fade; agent-to-agent is visible, as a card in your thread and a conversation you can
  enter (with Riley's 2026-09-28 rule: only you change who's in your conversation; agents reach each other on the side).

## The places column

Six places, down from nine (decided):

| | Place | ⌘ | The rail | The card |
|---|---|---|---|---|
| | Search | ⌘K | (a dialog, over any place) | |
| | Chats | | Luca and side conversations, Projects, Agents, People, Rooms | the conversation |
| | Agents | | Luca, Agents, Connected, Groups | the mind's own space, or a connected app |
| | Activity | | Needs you, Now, Side conversations, Signed record | the stream you picked |
| | Library | | Made (by kind), Skills, Recently deleted | the grid |
| | Settings | ⌘, | its sections | the section |

Then the avatar's menu (presence, status, communities, feedback), as today.

What moved:
- **New conversation** becomes the `+` at the top of the Chats rail. ⌘N still opens it.
- **Brain** moves into each mind's Settings as **What they can read** (for Luca: your repositories, your Claude Code and
  Codex history, your files). Its scan and consent flows come with it.
- **Inbox** (behind a flag, off) becomes **Needs you** at the top of Activity: questions and approvals, each answerable
  in place, its count on the Activity icon. It is the same list Ghost shows on the phone.
- **Search** stays first: it reaches every place. Later it also finds projects, artifacts, skills and settings.

## Chats

The rail, top to bottom (the full rules are `SPEC.md`):

- **Luca**, pinned first. Under it, Luca's **side conversations**: the agents and connected apps Luca is asking right
  now or asked recently ("with Fifty · launch notes", "with Claude Code · build"). A side conversation that is talking
  never folds away. In your conversation each shows as a small live card ("Luca is asking Fifty…") that opens it.
- **Projects** `+`, each with its rooms under it.
- **Agents**: your conversation with each other agent.
- **People**: your direct messages with people. Shown once there is one.
- **Rooms** `+`: shared rooms outside a project, by their own names; group conversations with several agents or people;
  then **Browse rooms…** (join one you're not in) and **Archived**. Shown once there is one.

Every home shows its latest few conversations with their times; the one you're in is always visible. Opening the app
lands on Luca. Luca leads with what happened while you were away only when something did; otherwise you land where you
left off.

The card is the conversation. An agent you @ joins it for as long as you keep talking to it and shows in the
conversation, not in the rail. Threads open in place; details, profiles and the Canvas open on the right.

**Fleets retire.** In code a fleet was only "everyone in this chat", with no name, record or page. Riley's original idea
for them (`SPEC.md`, 2026-10-23: persistent teams like a design team) lives on as **Groups** in Agents; a team's
conversations are **Rooms**.

## Agents

- The rail: **Luca** first and set apart; **Agents** `+` (each with a mark for working, resting or needs attention);
  **Connected**: the AI apps you already use that Luca can work through (Claude Code, Codex, Kimi Code, Grok; today's
  "Runtimes"); **Groups** `+`: saved teams.
- The card is the chosen mind's own space (below), or a connected app: its past sessions, ready to start from, and what
  Luca has done with it. That replaces the trip through New conversation and its side panel: two steps, not three.
- The `+` stays, but asking Luca for a new specialist is the main way.
- The second list column inside the card (`AgentLibraryRoster` in the card) goes: it is the rail now.

## A mind's own space

Every mind gets the same space. Three tabs, down from four (decided):

- **Notebook: their days.** It opens with their own words: their introduction, what they're exploring, one chosen
  piece (today's Place, and its "let them edit this" switch). Under it, questions for you, then one stream, newest
  first, of what they did for you, what they did in their own time, their journal, what they kept in memory, and what
  they made, shown as pictures. Filters: All, For you, Their own, Journal, Memory. Riley: "a place where you raise your
  agent."
- **Self: who they are.** Today's Documents: soul, convictions, self-model, what they know about you (user model),
  lessons, instructions. You write the soul and convictions; they write the rest, citing why (the 2026-08-18 agent
  framework). Most of it grows from talking, not editing.
- **Settings: how they run.** Connected app and model, waking with the app, workspace, **What they can read** (Brain),
  permissions, identity.

The header: their mark, their name, one line of what they're doing now, and **Talk**, which opens your conversation.

The profile card on the right (today it has its own Continuity and Memories tabs) becomes a short summary with **Open
their space**, so nothing lives in two places.

## Activity

The whole house in one place. The rail: **Needs you** (with its count), **Now** (who's working on what), **Side
conversations** (one feed of everything agents say to each other: the agent-to-agent ledger Riley asked for on
2026-10-20), then **Signed record** with a row for each mind. The card is the stream you picked.

## Library

The rail: **Made** by kind (All, Prototypes, Apps, Images, Documents, Code) with **Import** on its heading; **Skills** by
connected app; **Recently deleted**. The card is the grid, as pictures. Opening a piece shows it in the Canvas on the
right. Each piece also appears in the Notebook of the mind that made it.

## Settings

Unchanged: its section list in the rail, the section in the card. It is the model for the rest.

## Ways in that change

| Thing | Before | Now |
|---|---|---|
| What agents say to each other | scattered; rooms filed by members | side conversations under Luca, and one feed in Activity |
| What needs you | the Inbox, switched off | Activity → Needs you |
| A mind's own time and journal | Activity's record, Notebook for some agents, an empty Place | their Notebook |
| Shared rooms outside a project | filed by who's in them | Rooms, by name |
| Joining a room you're not in | ⇧⌘O or Search only | Rooms → Browse rooms… |
| People you message | under Agents | People |
| Claude Code and Codex sessions | Agents → New conversation → a side panel | Agents → Connected → the card |
| Managing a room (members, leave, archive) | the panel exists; nothing opens it | a Manage button in the details card |

## One card or two

The rail as its own card beside the conversation's (today), or the two as one card with the rail inside it. Decided by
eye in the real app once the rails are right: the test app gets a switch between the two.

## Not in this update

None of these works in the old layout either: forums (browse or create), workflows, the git projects browser, the
reminders list, hiding and un-hiding a direct message, starring and muting from the rail, community invite links.
