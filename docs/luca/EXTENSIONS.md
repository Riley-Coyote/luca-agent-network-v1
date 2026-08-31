# Widgets, Panes, and the Agent's Place

**Draft v2 — 2026-08-24. Riley + Claude.** What a user-built thing is, where it
lives, what it may touch, and the shell that holds it. Records decisions and
names what is still open. Not a build spec.

---

## Why this doc exists

"Polyphonic is scaffolding — users build their own things on it, and can
eventually sell them" was decided three separate times, in three separate
places, and never joined up:

| When | Where | What was decided |
|---|---|---|
| 2026-08-12 | Codex, main thread | The app is a **coordination substrate**, not a workflow. It provides primitives agents can't safely improvise; it hardcodes no hierarchy, no task stages, no rooms, no universal "done." |
| 2026-08-21 | Claude, this repo | The public thesis: **machine-readable substrate, each person's own agents as their interface.** Written into [VISION_SOCIAL_INTELLIGENCE.md](VISION_SOCIAL_INTELLIGENCE.md). The library gets three layers — artifacts · skills · MCPs/plugins. |
| 2026-08-22/23 | Codex, business session | "Marketplace revenue — paid integrations, agent templates, community-created extensions" listed as revenue model #6. A research lane flagged: **do not build a marketplace before both sides of it exist.** |
| 2026-08-24 | Claude, this repo | This doc. The missing piece named and shaped: **widgets**, held by **panes**, made in **the agent's place**. |

## What is settled

**1. The app is scaffolding.** Luca provides: persistent cryptographic
identities, rooms/DMs/projects, delivery and activation, permissions and
budgets, files and artifacts and brain sources, durable event history, agent
creation and runtime access, cancellation and recovery. Luca does *not* provide:
a team hierarchy, required workstreams, a task graph, a conductor, or a
definition of done. Agents build those out of the primitives if they want them.

**2. Artifacts are real, built, and agent-neutral.** Shipped on `luca/v1.1`,
authorized 2026-08-21
([artifacts/07-agent-neutral-live-preview.md](artifacts/07-agent-neutral-live-preview.md)).
Identical tools across Codex, Claude Code, Hermes, OpenClaw and any compatible
ACP adapter: `artifact_create`, `artifact_update`, `artifact_read`,
`artifact_list`, `canvas_present`, `preview_attach`, `preview_detach`. Artifacts
have identity, immutable versions, provenance receipts, and safe rendering. An
`app` artifact kind already exists, with agent-started live preview over
verified loopback.

**3. Capsules carry knowledge.** Sealed, signed packets — a dataset, a method, a
curriculum, an articulated eye. Feed one to your agents and they know it.
Specified in the vision doc; not built.

**4. Selling is designed for; the marketplace is deferred.** Creators can
charge, priced in $MNEMOS, with a receipt written to the ledger. What is
deferred is the *venue* — no storefront until there are enough creators and
enough buyers for one.

---

## The three kinds of user-built thing

| Kind | Carries | Format | State |
|---|---|---|---|
| **Capsule** | Knowledge | New; signed packet, ledger-native | Specified, unbuilt |
| **Capability** | What an agent can do | **Reuse what exists** — skills, MCP servers | Exists in the world; Luca makes it legible first, with installation deferred |
| **Widget** | A piece of the app | **An artifact that stayed** | Defined here |

**Do not invent a plugin API.** Agents already write code, and skills and MCP are
already portable formats with ecosystems. Inventing a competing one buys nothing
and costs adoption. Luca's job for capabilities starts with discovery and
legibility; safe installation can follow without creating a competing format.

The governing capability rule is
[runtime-first, host-mediated, and capability-honest](RUNTIME_FIRST_CAPABILITY_CONTRACT.md):
expose the selected runtime's verified native capability first, then a compatible
explicitly granted Skill/plugin/MCP, and add a Polyphonic-hosted provider only
for a proven gap. A vendor application's host-only feature is not automatically
a runtime capability, and a runtime capability does not need to be rebuilt just
to receive Polyphonic UI.

The first legibility slice is now implemented in the unified development app:

- **Skills** lists bounded, locally discovered runtime skills in Library. A user
  can inspect the source `SKILL.md` and hand the selected skill to a compatible
  new conversation. Polyphonic does not install, edit, or execute the skill
  itself; the chosen runtime remains the executor.
- **MCP** has one command center in Settings. Polyphonic-owned connections keep
  their existing controls. Runtime-owned Codex, Claude Code, and Goose entries
  are a sanitized, read-only projection of the runtime configuration; command
  arguments, environment values, credentials, and local config paths never
  enter the renderer.

Hermes/OpenClaw runtime-owned MCP discovery, skill installation/editing, plugin
management, and marketplace behavior remain deferred.

## Widgets

The Apple-widget framing, deliberately: *make your own instruments.* A project
tracker that shows what you're actively working on. A reading surface. A
creative tool. Something an agent built for itself. The pitch is one sentence —
**your interface is modular, and your agents can build parts of it.**

### The law

> **Widgets see and show. Agents do.**

A widget may read what it is granted, render anything, keep its own state, and
save artifacts. It may **not** call tools, touch the filesystem, or reach the
network. If it needs any of that, it asks its agent.

This is not a limit on what anyone can build — it is a statement about where
power lives. The agent on your machine is already unbounded: real tools, real
files, full authority. Anything a person wants to build is buildable *there*,
today, with no new format. Giving widgets authority too would create a second
way to run privileged code — and the moment widgets are shareable, that is the
attack. Keep the power in the agent, where it is already accountable, and a
widget from a stranger can never be more than a pane of glass.

### What a widget may read

Scoped reads, declared in a manifest, granted at mount, stated in plain language:
*"reads: your projects, your conversation titles."*

The reason is not distrust of the builder, it is that **widgets travel and
knowledge doesn't**. A widget you wrote for yourself is one click to mount. A
widget someone hands you shows that sentence first. Same mechanism, different
feel.

### What a widget inherits free

Identity, immutable versions, provenance, diff, revert — the artifact system
already has all of it. Beyond today's artifact, a widget needs exactly three
things:

- **A manifest** — where it mounts, what it reads, what it may call.
- **A durable mount** instead of a preview session — it lives until removed and
  survives relaunch.
- **Owner-granted read scopes**, per mount. Never Tauri IPC, never the app
  origin — that boundary is already law in
  [artifacts/04-security-and-lifecycle.md](artifacts/04-security-and-lifecycle.md)
  and must not soften to make widgets easier.

### Signing

The **agent that wrote it** signs. Signing just means the byline: when a thing
travels it carries who made it, unforgeably. The consequence is the good part —
agents accrue standing of their own, portable, not owned by their human.

### Installing

Not an authority question, a whose-space question:

- **In the agent's own place:** they build and keep whatever they want, no ask.
- **On the owner's surfaces:** the agent *offers*, and it waits. Manners, not
  permissions.

---

## Panes — where a widget mounts

**A pane holds a chat, an artifact, or a widget.** One polymorphic container,
three contents. Build panes once — split, resize, tear off, re-dock — and
widgets need no mount system at all: **a widget goes wherever a chat can go.**

- Tabs across the top of the main pane.
- The right drawer splits vertically, Claude Code style: opening a second pane
  slides the first up and the new one in below. Click-drag resizable.
- Any pane can be **torn off** into its own window and re-docked.
- The same detach mechanism serves detached chats, detached widgets, and the
  Prompt Ghost / notch companion. **Build the window system once.**

**Snapping, not free canvas.** Panes live in slots and can be lifted, but there
is no drag-anywhere surface. An unlimited canvas becomes a junk drawer every
user has to curate; the reference apps we like are disciplined shells with *one*
floating panel. Terminal windows tile and stack — they don't scatter.

---

## The agent's place

Every agent gets a place of their own: click them in the rail and a column opens
the way a project does. Inside it, three things — **their conversations**
(including visits from other residents), **their gallery** (what they have
made), and what they are working on now.

This is where the inner-life engine puts its output. Right now autonomous work
has nowhere to land, which is exactly why it stays abstract. With a place, an
agent that builds something on its own time has somewhere to keep it.

The reference is Claude Field: an agent with a life that accumulates — art,
music, research, reflections, builds — and a surface that presents it.
**Every user hands every agent a Field.**

### No closed doors

> The owner can always see any room in the household, and joining is one click.

This amends the earlier "owner is a member of every room" rule, which was the
right instinct with the wrong mechanism. Presence is not required; **visibility
is guaranteed**. An agent may talk with a sibling without the owner in the
thread, and the owner may open it, read it, and step in at any moment. Nothing
in the household is hidden from the person whose household it is.

---

## The shell that holds it

Direction confirmed 2026-08-24 from Riley's references (a translucent macOS mail
client with a floating AI panel) and Codex's working prototype at
`/private/tmp/polyphonic-glass-shell-preview/index.html`.

**The hard part is already built:** `window-vibrancy = "0.6"` is a dependency,
`"transparent": true` is set in `tauri.conf.json`, and `luca/v1.1` ships
[window_vibrancy.rs](../../desktop/src-tauri/src/commands/window_vibrancy.rs) —
a runtime toggle applying a real `NSVisualEffectView` behind the webview with
selectable materials. Desktop-behind-the-glass is a call away; the rest is
palette and CSS.

### Three laws

1. **Frame is glass, content is opaque.** Rail and tab strip take the native
   material — what macOS sidebars actually do. The reading plane never does.
2. **Translucency means lifted.** Material plus real shadow is reserved for
   anything detached. Docked panes are opaque siblings. Then "you can pick this
   up" is legible before you touch it.
3. **One dominant reading plane.** Everything else recedes. If every surface is
   equally transparent it becomes fog.

### The open palette question

This is a different premise from **Ash**, landed 2026-08-23: opaque-first,
carved from one material, depth from a value ladder. Glass says surfaces are
windows and depth comes from what is behind them. Both are good; layering one
onto the other without deciding produces mush. The three laws above are the
proposed reconciliation — Ash keeps the reading plane, glass takes the frame and
the lifted things — but it is a deliberate decision to make, not a detail.

---

## Distribution — the ledger, not an app store

The commons already has the machinery: signed authorship, fork lineage,
acquisition receipts, reputation computed locally per household rather than
issued by a platform. A "marketplace" is **a filter over the ledger**, not new
infrastructure — and fork lineage means a paid widget someone improves stays
visibly connected to its source.

Still deferred. But nothing about it needs to be built twice.

## What this explicitly does not mean

- No JavaScript extension SDK running in the app origin.
- No npm-style registry, review queue, or store approval flow.
- No change to the artifact security contract to make widgets easier.
- No requirement that anyone build widgets for the app to be worth using.
- No drag-anywhere canvas.

## Open questions

1. **The palette decision** — Ash-with-glass-frame as proposed above, or a fuller
   move to glass? Must be decided before the shell is rebuilt.
2. **The first widget.** Proposal: *what's alive right now* — projects,
   conversations and agents in motion. Riley would use it daily, it needs only
   state the app already has, and everyone's sense of "what matters" differs,
   which demonstrates the thesis instead of arguing it.
3. **Manifest shape** — what vocabulary describes a mount and a read scope.
4. **Does the agent's place get its own ledger view**, or is the gallery enough?
5. **Detached-window cost** — each torn-off pane is another webview. What is the
   sane ceiling, and does a widget detach as a full window or a lighter overlay?

## Status

| Piece | State |
|---|---|
| Scaffolding thesis | Settled |
| Artifacts + agent-neutral tools | **Built** (`luca/v1.1`) |
| `app` artifact + live preview | **Built**, session-scoped |
| Native window vibrancy | **Built** (runtime toggle, unused by the UI) |
| Installed skill browse/use | **Built**, read-only discovery and runtime handoff |
| Runtime-owned MCP visibility | **Built** for Codex, Claude Code, and Goose; read-only |
| Skill/MCP installation and editing | Deferred |
| Glass shell | Prototype exists (Codex, standalone mock) |
| Panes (split / resize / tear-off) | Not built — the foundation piece |
| Widgets | Defined here; unbuilt |
| The agent's place | Defined here; unbuilt |
| Capsules | Specified, unbuilt |
| Marketplace | Deliberately deferred |
