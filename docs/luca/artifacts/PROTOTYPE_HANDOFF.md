# Library and Static Canvas Prototype Handoff

## Coordinate and activation

- Reconciled base: `agent/exchange-object` at `350dd9d2`.
- Riley explicitly activated `EXT-502` for a static-first visual prototype on
  2026-08-21.
- The prototype is isolated behind the development-only `?lab=canvas` entry.
- It does not add production navigation, persistence, relay events, resident
  tools, runtime capabilities, or application-data writes.

## Current-source reconciliation

The earlier static-artifact packet remains useful for product scope, local
durability, append-only versions, provenance, and opaque HTML preview. These
parts need correction before production implementation:

1. The functional source is the current `agent/exchange-object` lineage, not
   the older identity-glyph or G1 planning coordinates.
2. Luca now treats family inside the house as trusted. A new artifact broker,
   permission channel, capability type, or turn gate would conflict with
   `CODEX_CLEANUP_BRIEF.md` and `AUTONOMY_POSTURE.md`.
3. Resident creation should later reuse the current native resident tool and
   exchange conventions. It must not thread new authority through conversation.
4. The current conversation model is resident, DM, room, project, visit, and
   exchange. Artifact provenance should point back to one of those existing
   conversations rather than introduce another collaboration container.
5. `sharedCanvas` and `whiteboard` remain deferred feature flags. This static
   artifact Canvas is a personal Library/detail surface, not either feature.

The current prototype deliberately stops before choosing the resident-write
adapter. That decision should be made only after the UI direction is accepted.

## What the prototype proves

- A first-class Library can sit in Luca's present global navigation language.
- One artifact workspace can support Preview, Source, and Versions.
- HTML can render in an iframe with `sandbox="allow-scripts"`, no
  `allow-same-origin`, a restrictive in-document CSP, and no referrer.
- Markdown, image, code, and unsupported-file states share the same frame.
- Version restoration is represented as “Restore as new,” preserving history.
- Conversation and resident provenance can remain visible without making the
  conversation dependent on artifact availability.
- The Library becomes a full overlay at narrow widths while Canvas remains the
  destination behind it.

## Conversation Canvas prototype

The real shell design lab now carries a second, conversation-bound prototype.
It mounts the existing App shell, real conversation surface, and mock scene,
then introduces Canvas as a sibling card on the same floor.

- Build with `just shell-lab` and open `design-lab/shell-lab.html`.
- Canvas opens automatically unless the URL includes `?canvas=closed`.
- `Command/Control + Shift + .` opens it; `Escape` closes it.
- Closing leaves a quiet artifact launcher so the owner can reopen the work.
- At wide widths the shell host expands and the measured conversation geometry
  remains fixed while Canvas claims only the new space.
- At moderate widths the two planes share the available window while keeping
  readable minimums.
- At narrow widths Canvas becomes a separate focus card over the conversation
  plane rather than compressing both into unusable columns.
- Reduced Motion removes the spatial transition without changing the result.

The native prototype seam plans against the current monitor work area. It grows
right first, shifts left only by the unavailable amount, refuses undersized
expansions, leaves maximized/fullscreen windows alone, and restores the prior
geometry only if the owner did not manually resize while Canvas was open. The
policy is unit-tested; native animation still requires a foreground Tauri app
inspection before it can be accepted for production.

## Shortest production task graph

```text
L0  Static visual prototype                         COMPLETE
 |
L1  Local model + atomic versioned store
 |
L2  Production Library route + shared Canvas
 |
L3  Owner import/export + conversation references
 |
L4  Explicit resident create/update adapter
 |
L5  Installed-app sandbox, restart, and regression acceptance
```

Use one implementation lane in this order to reduce context and coordination
cost. `L1` freezes the DTOs used by every later task. `L2` replaces fixtures
with that store. `L3` proves owner-controlled lifecycle before resident writes.
`L4` then adds the narrowest existing-tool adapter with no new interior
permission system. `L5` is the first point at which the feature can be called
integrated.

## Integration acceptance

Before exposing Library in the live app:

- artifact versions survive relaunch and revert only by appending a version;
- the owner can import, find, preview, export, delete, and restore locally;
- HTML cannot access Luca DOM, storage, network, parent, or Tauri IPC;
- Library metadata does not eagerly execute or load artifact bodies;
- missing/corrupt artifacts fail without affecting conversations;
- community and identity switches reset artifact-scoped caches;
- desktop zoom, keyboard focus, reduced motion, overflow, and narrow layout
  pass in the installed app;
- the installed bundle—not only the browser lab—passes a real visual review.

## Explicitly deferred

Build commands, development servers, hot reload, external preview networking,
shared editing, multi-user boards, relay sync, and automatic publication remain
separate live-Canvas work.
