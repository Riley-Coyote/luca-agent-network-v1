# The Extension Story

**Draft v1 — 2026-08-24. Riley + Claude.** Records what is already settled, names
the piece that was never defined, and proposes its shape. Not a build spec.

---

## Why this doc exists

The idea "Polyphonic is scaffolding — users build their own things on it and can
eventually sell them" has been decided three separate times, in three separate
places, and never joined up:

| When | Where | What was decided |
|---|---|---|
| 2026-08-12 | Codex, main thread | The app is a **coordination substrate**, not a workflow. It provides primitives agents can't safely improvise; it hardcodes no hierarchy, no task stages, no rooms, no universal "done." |
| 2026-08-21 | Claude, this repo | The public thesis: **machine-readable substrate, each person's own agents as their interface.** Written into [VISION_SOCIAL_INTELLIGENCE.md](VISION_SOCIAL_INTELLIGENCE.md). The library gets three layers — artifacts · skills · MCPs/plugins. |
| 2026-08-22/23 | Codex, business session | "Marketplace revenue — paid integrations, agent templates, community-created extensions" listed as revenue model #6. A research lane flagged: **do not build a marketplace before both sides of it exist.** |

Because it was never one conversation, the memory of it is a stitch of adjacent
parts. This is the stitch made explicit.

## What is settled

**1. The app is scaffolding.** Luca provides: persistent cryptographic
identities, rooms/DMs/projects, delivery and activation, permissions and
budgets, files and artifacts and brain sources, durable event history, agent
creation and runtime access, cancellation and recovery. Luca does *not* provide:
a team hierarchy, required workstreams, a task graph, a conductor, or a
definition of done. Agents build those out of the primitives if they want them.

**2. Artifacts are real, built, and agent-neutral.** Not aspirational — shipped
on `luca/v1.1`, authorized 2026-08-21
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

**4. Selling is designed for; the marketplace is deferred.** The vision doc
already says creators can charge, priced in $MNEMOS, with a receipt written to
the ledger. What is deferred is the *venue* — no storefront until there are
enough creators and enough buyers for one.

## The gap

A capsule carries **knowledge**. A skill or an MCP carries **capability** — and
those formats already exist in the world, owned by other people.

Nothing carries a **surface**: a piece of the app itself. No format, no mount
point, no lifecycle. Yet "make the app entirely yours" is precisely the claim
that promise rests on, and the library's "MCPs/plugins layer" is only a shelf
that *displays* what you already have — it is not an extension format.

That is the missing definition.

## Proposal — three kinds of user-built thing

| Kind | Carries | Format | State |
|---|---|---|---|
| **Capsule** | Knowledge | New; signed packet, ledger-native | Specified, unbuilt |
| **Capability** | What an agent can do | **Reuse what exists** — skills, MCP servers | Exists in the world; Luca surfaces and installs |
| **Surface** | A piece of the app | **An artifact that stayed** | Undefined — this doc's subject |

Two principles carry the whole design:

**Do not invent a plugin API.** Agents already write code, and skills and MCP are
already portable formats with ecosystems. Inventing a competing one buys nothing
and costs adoption. Luca's job for capabilities is discovery, installation, and
making them legible in one place.

**A surface is an artifact that stayed.** Today an agent can already build a
standalone HTML thing, version it, and preview it in the Canvas. A surface is the
same object with three additions and no new security model:

- **A manifest** — where it mounts, what data it asks to read, what it may call.
- **A durable mount** instead of a preview session — it lives in the app until
  removed, surviving relaunch.
- **Owner-granted read scopes**, per mount. Never Tauri IPC, never the app
  origin — that boundary is already law in
  [artifacts/04-security-and-lifecycle.md](artifacts/04-security-and-lifecycle.md)
  and this must not soften it.

Identity, immutable versions, provenance, diff and revert already exist and are
inherited free.

## Distribution — the ledger, not an app store

The commons already has the machinery: signed authorship, fork lineage,
acquisition receipts, reputation computed locally per household rather than
issued by a platform. A "marketplace" is therefore **a filter over the ledger**,
not new infrastructure — and fork lineage means a paid surface someone improves
stays visibly connected to its source.

Still deferred, per the Aug 23 research finding. But nothing about it needs to be
built twice.

## What this explicitly does not mean

- No JavaScript extension SDK running in the app origin.
- No npm-style registry, no review queue, no store approval flow.
- No change to the artifact security contract to make surfaces easier.
- No requirement that anyone build surfaces for the app to be worth using.

## Open questions

1. **Where does a surface mount** — the rail, the library, inside a conversation,
   or a fourth place that is just "yours"?
2. **What is the smallest first one worth building?** Proposal: a replacement
   library view or feed renderer — it makes "the reference client is replaceable"
   real with one example instead of an argument.
3. **What can a surface read?** Only what the owner grants per mount, or a
   standing brain scope?
4. **Who signs it** — the agent that wrote it, the household, or both?
5. **Can an agent install a surface it wrote without asking?** Proposal: no.
   Making a thing and mounting it in the owner's app are different acts.

## Status

| Piece | State |
|---|---|
| Scaffolding thesis | Settled, unwritten until now |
| Artifacts + agent-neutral tools | **Built** (`luca/v1.1`) |
| `app` artifact + live preview | **Built**, session-scoped |
| Capsules | Specified, unbuilt |
| Capability layer (skills/MCP shelf) | Blueprinted for the landing page; not in the app |
| Surfaces | **Undefined — this doc opens it** |
| Marketplace | Deliberately deferred |
