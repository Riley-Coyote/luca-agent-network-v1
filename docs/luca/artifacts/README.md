# Luca Artifact Canvas — Production Finish Packet

**Status:** implementation activated by Riley on 2026-08-21.

**Purpose:** add a local-first Artifact Library and an in-app Canvas so a
resident can create something visible, the owner can inspect it immediately,
and the result survives beyond the conversation that produced it.

This packet is additive. It does not modify or reinterpret the vendored
`.codex/luca-v1/` contracts. If implementation later changes those contracts,
the integrator must record a narrow authorized amendment or correction instead
of editing them silently.

## Read order

1. [Product and scope](00-product-and-scope.md)
2. [Decision log](01-decision-log.md)
3. [System contracts](02-system-contracts.md)
4. [Experience and rendering](03-experience-and-rendering.md)
5. [Security and lifecycle](04-security-and-lifecycle.md)
6. [Source map](05-source-map.md)
7. [Milestones and gates](06-milestones-and-gates.md)
8. [Task graph](TASK_GRAPH.yaml)
9. [Codex kickoff](CODEX-KICKOFF.md)
10. [Agent-neutral live preview amendment](07-agent-neutral-live-preview.md)

## Product outcome

The first complete demonstration is intentionally narrow:

1. The owner asks a resident to create a standalone HTML prototype.
2. The resident publishes it through Luca's scoped artifact tool.
3. Luca stores an immutable version, shows a local artifact card in the
   conversation, and opens the Canvas.
4. A follow-up request creates version 2 of the same artifact.
5. The owner can preview, inspect source, compare versions, revert by creating a
   new version, close and reopen the Canvas, and find the artifact in Library
   after relaunch.

Images, Markdown, text, code, non-executing SVG, PDF, arbitrary catalogued files,
and source-bound app records use the same substrate. Agents may attach a
loopback dev server they started through their existing harness tools; Luca does
not become the server process owner.

## Activation rule

Production work begins only after:

- current G1 is passed, **or** Riley explicitly changes priority. Riley supplied
  that priority override on 2026-08-21;
- Artifact Gate `GA0` reconciles this packet with the then-current source tree;
- the selected task's dependencies pass;
- its owned paths, tests, outputs, and stop conditions are accepted.

Packet authoring does not satisfy any of those gates.

## Core invariants

- Buzz remains the conversation and signed chronology foundation.
- There is no conductor and no privileged Luca routing path.
- Artifact failure never prevents a resident's final response from succeeding.
- Artifact bytes and absolute local paths are local-only by default.
- The relay may receive only an explicitly designed safe reference; the first
  implementation requires none.
- Agent/model descendants receive no owner key, resident key, signing broker,
  or generic filesystem capability from the artifact system.
- Versions are append-only. Revert creates another version.
- Generated HTML never executes in Luca's application DOM or with Tauri IPC.
- Static preview and agent-attached loopback live preview are the authorized
  product. The harness remains the process owner; Luca never runs or restarts a
  development server.

## Anti-drift question

> Does this make the resident's output visible, durable, attributable, local,
> and safely reopenable without changing conversation authority?

If not, it is outside this packet.
