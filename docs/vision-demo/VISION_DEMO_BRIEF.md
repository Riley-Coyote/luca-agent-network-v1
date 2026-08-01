# Mnemos — Interactive Product Vision

Status: canonical brief for the isolated `agent/vision-demo` branch

Implementation status: **Phase 1 visual-approval gate**. Network opening and
recall are production-intent; the remaining surfaces are specified below but
must not be described as implemented yet.

## Purpose

Build a real, explorable product surface that makes the complete Mnemos
personal-network vision tangible before every production subsystem is finished. The
interface, navigation, interactions, state transitions and narrative are real.
The agent cognition, memory events and network activity are deterministic demo
fixtures behind a dedicated adapter.

This is not a replacement for the production G1 build and must not be used as
evidence that a simulated capability has shipped.

## Product promise

> Your agents remain themselves, remember what matters, and work together
> inside one continuous personal network.

The demo should make five ideas immediately legible:

1. **Identity continuity** — every agent has a persistent cryptographic
   identity, history and relationship with the user.
2. **A universal brain** — agents can retrieve shared personal context within
   explicit scopes, with provenance visible to the user.
3. **Collective intelligence** — the user can speak to one agent or bring
   several agents into the same room without a conductor hiding their work.
4. **Life between sessions** — agents reflect, consolidate and carry forward
   unresolved threads while the chat window is closed.
5. **Trust made visible** — signed events, continuity receipts and memory-use
   receipts show why the user can believe the identity and history are stable.

## Golden-path narrative

The seeded story is a launch-planning session.

1. Riley asks Luca to help shape the launch of the Agent Network.
2. Luca recalls a prior product decision from the universal brain: the
   conductor was intentionally removed in favor of direct multi-agent rooms.
3. Luca brings Mara and Sol into the room openly.
4. Mara contributes the emotional/product narrative; Sol pressure-tests the
   technical claim and trust boundary.
5. The room produces a shared launch thesis and records which memories were
   consulted.
6. After the session, each agent creates a private reflection and a scoped
   consolidation proposal.
7. The demo advances to a later session. The same signed identities return,
   the relationship history remains intact, and the agents continue without a
   reset or reintroduction.

## Primary surfaces

### Network

The dominant chat plane. It shows direct and multi-agent conversation, visible
participant arrival, scoped memory recall, work state, citations and a shared
outcome. Agent activity should be legible without turning chat into a task-log
firehose.

### Agents

A persistent resident roster. Each agent exposes:

- stable name, role and cryptographic fingerprint;
- relationship age and number of shared sessions;
- current cognitive state;
- continuity health;
- private reflection count and latest consolidation time;
- explicit universal-brain access scope.

### Brain

A calm, provenance-first view of the user's universal brain. It shows source,
scope, recency, confidence and which agents have permission to retrieve each
memory. It must not resemble an undifferentiated vector-database dashboard.

### Continuity

The clearest articulation of the Polyphonic future: a timeline of signed
sessions, reflections, consolidation and unresolved questions. It should show
an agent developing through time without claiming consciousness or hiding the
mechanism.

## Demo controls

- `Run the story` advances the deterministic narrative.
- `Pause` freezes it at a capture-ready state.
- A step control jumps to any narrative beat.
- Primary navigation remains freely explorable at every step.
- `Restart` restores the exact initial fixture.
- The demo always displays a quiet `Interactive vision · simulated activity`
  disclosure.

## Truth boundary

### Real

- rendered product interface;
- navigation and interaction behavior;
- responsive layout and accessibility states;
- deterministic state transitions;
- visual system and product information architecture;
- source-controlled demo data and runtime contract.

### Simulated in this branch

- model-generated responses;
- autonomous reflection and consolidation;
- universal-brain retrieval;
- cross-session background cognition;
- cryptographic signing and verification results;
- live multi-agent network transport.

The simulated layer must live behind `DemoRuntime`; UI components should not
contain hidden timers or fabricated network logic. Public copy may call this an
"interactive product vision" or "working vision prototype." It must not call
the simulated capabilities generally available or production-ready.

## Visual direction

Mode: dark technical with an immersive edge.

- One dominant central plane; side regions stay quiet.
- Near-black tonal steps, hairline borders and precise spacing carry hierarchy.
- Color is limited to identity, state, provenance and focus.
- Typography is light and role-based: readable sans for conversation, mono for
  cryptographic and system metadata.
- Motion represents thinking, arrival, retrieval, consolidation and completion.
- No decorative gradients, generic AI glow, oversized pills or card mosaics.
- The memorable element is the visible continuity of the agents, not ornament.

## Acceptance criteria

1. The demo opens directly in a seeded Luca network without onboarding.
2. A visitor understands the product promise within fifteen seconds.
3. The complete golden path can run without network access or nondeterminism.
4. Network, Agents, Brain and Continuity are all explorable.
5. The same three agent identities remain consistent across every surface.
6. Memory use and continuity claims show provenance or a receipt.
7. Simulated activity is disclosed without overwhelming the experience.
8. Desktop presentation is polished at 1440×900 and remains usable at 390px.
9. Reduced-motion users receive state changes without ambient animation.
10. Typecheck, build and focused browser acceptance checks pass.
11. The final handoff includes a running local URL and a capture-ready shot list.

## Capture-ready moments

1. The opening Network room with Luca present and the other agents available.
2. A universal-brain recall receipt inside the conversation.
3. Mara and Sol entering the room and contributing distinct perspectives.
4. The Agents roster showing persistent fingerprints and continuity health.
5. The Brain view showing scoped access and provenance.
6. The Continuity view showing session → reflection → consolidation → return.
7. The later-session state proving the same identities and unresolved thread
   survived the boundary.

## Branch boundary

The vision demo is isolated from `luca/v1`. Production changes may be promoted
only as small, reviewed components after G1; the branch must never be merged
wholesale into the release line. Production evidence and gate receipts remain
authoritative for what actually ships.
