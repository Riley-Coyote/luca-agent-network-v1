# Projects — grouping rooms by the work they belong to

**Status:** design settled, UI prototyped, data model **not built**.
**Owner:** Codex (event kind, relay handling, local path binding).
**Prototype:** shipped behind the rail's grouping, reading a local map — see
"What already exists" below.

---

## What a project is

**A project is an attribute of a room, not a mode you are in.**

A room bound to `~/Repositories/luca-agent-network-v1` already carries its own
working context. Residents in that room get that working directory *because the
room says so* — not because the owner navigated into a project first. There is
no "current project" state, nothing to enter or leave, and nothing to get lost
in.

This was a deliberate choice over the alternative (a Discord/Slack-style
workspace switcher, where you are *in* a project and the rail shows only its
rooms). Modality would have fragmented the conversation list and added a state
the owner has to track. Rejected.

**One project per room.** A repo-backed project cannot sensibly be many-to-many,
and the rail groups rooms — grouping requires a single home in a way that filter
chips would not. This is a constraint we are choosing, not an accident.

---

## Why grouping and not filtering

The rail originally had a `CHANNELS` / `DIRECT MESSAGES` taxonomy, which was
removed: it grouped by **object type**, which is meaningless and system-imposed.
The first replacement proposal was Telegram-style filter chips over one flat
list. Riley rejected that with a concrete reason — *you cannot tell at a glance
which sessions belong to which project* — and he was right. The flat-list rule
came from consumer messengers, and **those apps have no project dimension**.

Grouping was never what made the old sidebar feel like Slack. Three other things
were, and the spec preserves the fixes:

1. it grouped by object type → now grouped by the work, which the owner thinks in
2. heavy section chrome → the label *is* the toggle, chevron only on hover, no
   per-section action menus
3. **fixed order** → groups are ordered by their most recent room, so whatever
   is being worked on floats up and last month's project sinks

Point 3 is the one that keeps this alive rather than filed. Do not "stabilise"
the group order.

---

## What already exists (desktop, prototype)

| file | what it does |
|---|---|
| `features/sidebar/ui/ChatList.tsx` | `groupChats()` — grouping + the recency-ordered rule. Pure, 7 tests in `chatListGrouping.test.mjs`. |
| `features/channels/lib/roomProjects.ts` | `useRoomProjects()` — **the piece to replace.** Reads a local assignment map; seeds a demo assignment under the mock only. |

Behaviour with no assignments is exactly today's flat list, with everything under
a `Rooms` section. That is the degrade path and there is a test for it.

**Codex replaces `useRoomProjects` with the real source. Nothing else in the rail
should need to change.**

---

## Data model

### The project entity — new addressable kind

`30178` is the next free slot in the `3017x` block. `KIND_TEAM` (30176) is the
closest existing analogue: a named grouping, parameterized-replaceable, keyed by
`(pubkey, kind, d_tag)` with the project id as the `d_tag`.

Content carries the project's **identity**: a stable id and a display label.

### The room binding — a tag on channel metadata

A room references its project by id. Prefer a tag on the existing channel
metadata event over a new endpoint, per the repo's Nostr-first rule.

### ⚠ The repo path must NOT go on the relay

**This is the constraint most likely to be missed.** Relay events are
world-readable — `KIND_MANAGED_AGENT`'s own doc comment says so explicitly and
lists what must never appear in one. A local filesystem path discloses the
owner's directory layout, their username, and often the names of unrelated
private projects sitting beside it.

So the project splits in two:

- **On the relay:** project id + display label. Safe, syncs across devices,
  survives a reinstall, and is what the rail groups by.
- **Local only:** the `id → absolute path` binding. Never published, never in
  event content, never in a tag. A path is machine-specific anyway — the same
  project legitimately lives at different paths on different machines, so
  syncing it would be wrong even if it were safe.

That split also answers "what happens on a second device": the project appears
with its rooms and its label, and simply has no path until the owner points it
at one locally.

---

## What Codex builds

1. **Kind `30178`** in `buzz-core/src/kind.rs` with a doc comment, plus relay
   handling. Follow `KIND_TEAM` / `KIND_MANAGED_AGENT` for shape.
2. **A project tag on channel metadata**, and expose the resolved project id on
   the `Channel` type the desktop already consumes.
3. **A local-only path store** for `projectId → absolutePath`, alongside the
   existing local archive/state mechanisms. Must never be published.
4. **Replace `useRoomProjects`** to read (2) instead of localStorage. The rail,
   grouping, ordering and tests stay as they are.
5. **Wire the path into agent working directory** — this is the payoff. A
   resident answering in a project-bound room should be working in that repo.
   Coordinate with the ACP/harness side; see `REPLY_ADDRESSING.md` for the
   adjacent question of *who* answers.

---

## Open questions

- **Creating a project.** Proposal: point at a directory, and that is a project;
  the label defaults to the directory name. Needs a picker and a name field.
- **Assigning a room.** From the room's own header/info panel is the obvious
  place, since project is a room attribute. Not designed yet.
- **What happens when the path is gone** — repo moved or deleted. The project
  should not break; it should surface as "no working directory" and the rooms
  should still open. Do not delete rooms on a missing path.
- **Does a project imply an agent roster?** Plausible — "these residents work in
  this repo" — but not decided, and it interacts with reply addressing. Do not
  assume it.

---

## Do not

- Do not make a project a mode, a switcher, or a "current project" state.
- Do not sort groups alphabetically or pin them to a fixed order.
- Do not put a filesystem path in a relay event, a tag, or event content.
- Do not allow a room in two projects without redesigning the rail first.
- Do not delete or hide rooms when their project's path is missing.
