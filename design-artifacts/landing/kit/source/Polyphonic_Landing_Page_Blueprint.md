# Polyphonic Landing Page Blueprint

**Status:** Canonical planning and production handoff  
**Purpose:** Define the story, copy, proof, interaction model, and claim boundaries for the production Polyphonic landing page.  
**Primary CTA:** Join the private beta waitlist  
**Product name:** Polyphonic  
**Native concierge:** Luca  
**Continuity system:** Mnemos

---

## 1. The Product in One Sentence

> Polyphonic is the secure home for your entire agent network—where you can create or connect agents, communicate with all of them, give them shared intelligence, preserve their individual continuity, and conduct their work from one place.

This sentence is the governing message for the page. Every section should deepen one part of it. No section should introduce a separate product thesis.

## 2. The Core Transformation

Polyphonic should not be framed as “another interface for chatting with AI.” It solves a larger structural problem:

### Before Polyphonic

- Agents live in separate applications and terminals.
- Each runtime has its own profile, tools, credentials, projects, memory, and session history.
- Knowledge is repeatedly copied between systems.
- Context disappears or becomes fragmented when sessions end.
- Multi-agent coordination requires the user to act as the messaging layer, memory layer, permissions layer, and project manager.
- Agent output is easy to flatten into one anonymous stream with unclear authorship.

### With Polyphonic

- Every agent has one visible place in the user’s network.
- The user can communicate with one agent or assemble several in a shared room.
- Luca helps the user orient, delegate, coordinate, and conduct.
- The Brain holds owner-controlled shared intelligence.
- Mnemos gives each agent a separate continuity system and Notebook.
- Identity, authorship, permissions, runtime authority, and memory access remain explicit.

The emotional transformation is:

> From managing disconnected AI sessions to working with a coherent network of persistent agents.

---

## 3. Audience

### Primary audience

People already working with more than one agent, model, or agent runtime who feel the cost of fragmentation.

Examples:

- Builders using Hermes, OpenClaw, Codex, Claude Code, or custom agents.
- Researchers managing projects and large bodies of source material.
- Creators assembling specialized agents around different parts of their practice.
- Advanced AI users who care about identity, authorship, privacy, and continuity.

### What they already understand

- AI agents can perform useful work.
- Different models and runtimes have different strengths.
- Context and memory fragmentation are real problems.

### What the page must teach

- Polyphonic is a system for an agent network, not a single assistant.
- The Brain and agent Notebooks are separate memory authorities.
- Agents remain individually addressable even when Luca coordinates them.
- Security is architectural rather than a privacy toggle.
- “Continuity” means selective, source-backed carried-forward meaning—not merely transcript storage.

---

## 4. Public Vocabulary

Use familiar language first. Introduce specialized vocabulary only after the underlying idea is understood.

| Term | Public meaning | Usage rule |
|---|---|---|
| **Agent** | An intelligence the user creates or connects | Default public term |
| **Resident** | An agent with a persistent Polyphonic identity and home | Introduce inside the identity/continuity story; do not lead with it |
| **Agent network** | The user’s complete collection of connected and created agents | Primary product frame |
| **Brain** | Owner-controlled shared intelligence: projects, sources, knowledge, and imported history | Always described as belonging to the user |
| **Notebook** | One agent’s private, inspectable continuity record | Always described as belonging to one agent |
| **Mnemos** | The continuity system behind handoffs, notes, provenance, revisions, and recall | Introduce as “continuity powered by Mnemos” |
| **Luca** | Polyphonic’s native concierge and coordination intelligence | Luca assists the user’s authority; Luca does not erase direct agent access |
| **Room** | A shared conversation containing the user and one or more agents | Prefer over “group chat” in product copy |
| **Handoff** | A compact carried-forward working state for a fresh runtime session | Avoid describing it as full transcript restoration |
| **Runtime** | The underlying system that executes an agent | Use only where it clarifies native compatibility or identity |

### The most important conceptual distinction

> The Brain belongs to you. The Notebook belongs to the agent. Access between them is governed, never assumed.

This line should appear visibly on the page, not only in technical documentation.

---

## 5. Claim Boundary

The production page can present the full product destination, but it must distinguish implemented beta functionality from near-term releases and longer-term vision.

### Verified in the current V1.1 product

- Unified Agent Library and resident workspaces.
- Imported Hermes and OpenClaw agents.
- Luca-created managed agents through supported runtime bindings.
- Independent cryptographic identity for each resident.
- Direct conversations and mixed-agent rooms.
- Correctly attributed signed replies.
- Native runtime bindings, permissions, cancellation, and restart recovery.
- Encrypted private handoff continuity.
- Resident-specific Continuity Notes and Journal Pages.
- Notebook provenance, revisions, corrections, annotations, archive, and forget controls.
- Project-to-room navigation.
- Messaging that remains functional when continuity is locked, corrupt, disabled, slow, or unavailable.

### Near-term product promise

- Brain Setup for scoped owner sources.
- Narrow local source and folder import.
- Per-agent source grants and revocation.
- Provenance attached to Brain-assisted answers.
- Resident-requested Notebook review and reflection.
- A more complete public Agent Studio flow.

### Broader product direction

- Broad imports across projects, knowledge bases, and historical sessions.
- Creating Hermes, OpenClaw, and native Polyphonic agents as equally complete in-app paths.
- Deeper Luca-led delegation and orchestration.
- Scheduled reflection, proactive outreach, and richer bounded inner-life behavior.

### Production copy rule

- Use present tense for verified functionality.
- Use “coming,” “designed to,” or clearly labeled roadmap language for near-term functionality.
- Use a dedicated “The direction” or “What comes next” surface for longer-range features.
- Do not quietly mix current and future claims inside the same proof screenshot.

### Claims to avoid

- “All messages are end-to-end encrypted” unless the complete transport claim is independently verified.
- “Agents are conscious,” “alive,” or “sentient.”
- “Full native session restoration.”
- “Every agent remembers everything.”
- “Autonomous conductor” until the behavior and authority boundary exist in the shipped product.
- “Create any agent” or “supports every runtime.”
- “The Brain automatically shares everything with every agent.”
- “Polyphonic replaces native agent memory.”

---

## 6. Narrative Principles

### 6.1 Lead with the human promise

The visitor should understand the transformation before seeing cryptography, memory architecture, or runtime terminology.

### 6.2 Explain the system through use

A complete workflow is more persuasive than a catalog of isolated features.

### 6.3 Preserve plurality

Polyphonic should never sound like a system that reduces several agents into one generic super-assistant. The product’s distinctiveness is that coordination and individuality coexist.

### 6.4 Treat security as product architecture

Security should be shown as the structure underneath identity, authorship, continuity, and access—not as a final compliance section.

### 6.5 Let product proof carry the page

Use real interface sequences wherever possible. Abstract diagrams should explain relationships that screenshots cannot.

### 6.6 Avoid spectacle without meaning

The production design can feel singular and award-level, but motion and graphics must teach something: identity, plurality, access, continuity, or orchestration.

### 6.7 One message per viewport

The page may be rich, but each visual moment should answer one question. Do not place Brain, security, Notebook, and Agent Studio claims into one dense feature collage.

---

## 7. Recommended Page Architecture

1. Hero — the complete promise
2. The fragmentation problem
3. A complete Polyphonic workflow
4. System map — how the pieces relate
5. Communication and conducting
6. The Brain
7. Mnemos continuity and agent Notebooks
8. Agent Studio
9. Security architecture
10. Luca
11. Beta scope and roadmap boundary
12. Who Polyphonic is for
13. FAQ
14. Final waitlist CTA

This order moves from recognition → experience → architecture → trust → conversion.

---

# 8. Detailed Section Specifications

## Section 01 — Hero

### Purpose

Establish Polyphonic as the secure operating home for an entire agent network. The visitor should understand that this includes management, communication, shared intelligence, continuity, and coordination.

### Recommended copy

**Eyebrow**  
Private macOS beta coming soon

**Headline**  
Your entire agent network.  
One secure place to work.

**Body**  
Connect or create your agents, communicate with all of them, give them shared intelligence, and conduct their work from one calm interface. Luca is your concierge at the center.

**Primary CTA**  
Join the private beta

**Secondary CTA**  
See how Polyphonic works

**Support line**  
Built for macOS · Hermes · OpenClaw · Polyphonic-native agents

### Required proof

A real or production-faithful application view showing:

- Agent Library or resident roster.
- One active shared room.
- Several visibly distinct agent identities.
- Luca coordinating or summarizing state.
- Signed authorship or Notebook/Brain status as quiet supporting information.

The hero should prove that multiple agents genuinely coexist in one system. It should not be a generic abstract network graphic.

### Interaction

- The existing animated matrix language may remain as a secondary identity/signaling instrument.
- Recommended matrix phrases: `ONE NETWORK`, `SHARED INTELLIGENCE`, `PRIVATE CONTINUITY`.
- Keep motion slow, low-contrast, and optional under reduced-motion preferences.
- The product preview may respond subtly to scroll, but it should remain readable as a still frame.

### Success test

After five seconds, a new visitor can answer: “What is Polyphonic?”

---

## Section 02 — The Fragmentation Problem

### Purpose

Create recognition. Explain why a unifying system is necessary before describing how it works.

### Recommended copy

**Eyebrow**  
The agent era has an infrastructure problem

**Headline**  
Your agents can work. They just cannot work together yet.

**Body**  
Each agent lives in a different window with its own context, credentials, projects, memory, and session history. Coordinating them means becoming the infrastructure yourself.

**Transformation line**  
Polyphonic turns disconnected AI sessions into a coherent personal agent network.

### Content pattern

Use a simple before/after contrast.

**Before**

- Separate apps and terminals
- Repeated context transfer
- Fragmented history
- Unclear authorship
- Manual coordination

**With Polyphonic**

- One Agent Library
- Shared rooms and direct conversations
- One owner-controlled Brain
- Private continuity for every agent
- Luca-assisted coordination

### Required proof

No screenshot is necessary. A small transformation diagram or restrained stack of disconnected surfaces converging into one interface is more useful.

### Interaction

As the visitor scrolls, disconnected labels may align into the Polyphonic system. Avoid a dramatic “everything explodes into particles” treatment.

---

## Section 03 — A Complete Workflow

### Purpose

Create the page’s “click” moment by showing the major features working together in one believable scenario.

### Scenario

**Prepare a product launch with three agents.**

1. Connect an existing Hermes strategist.
2. Create a native Polyphonic research agent.
3. Bring an OpenClaw builder into the project room.
4. Ask Luca to divide the launch work.
5. Each agent receives only the Brain sources it is authorized to use.
6. Their contributions return to one room with distinct signed authorship.
7. Each agent records different source-backed continuity in its private Notebook.
8. On the next session, the room resumes without requiring the user to reconstruct the entire state.

### Recommended copy

**Eyebrow**  
One project. A network of minds.

**Headline**  
From delegation to durable continuity in one coherent flow.

**Body**  
Polyphonic connects the parts of agent work that are currently scattered across chat windows, terminals, files, and memory systems.

### Required proof

Use a scroll-sequenced interface story rather than separate cards:

- Agent creation/import sheet.
- Project room.
- Luca delegation message.
- Brain source-grant indicator.
- Multiple agent responses.
- Notebook update receipt.

Each step should reuse the same agents and project so the visitor follows one continuous story.

### Interaction

- A sticky product frame may remain while the explanatory copy advances through the eight stages.
- Prefer real state transitions over cinematic mock video.
- Provide normal static fallbacks on mobile and reduced-motion devices.

### Claim note

If Brain grants or full Luca delegation are not in the public beta, label the sequence as “The Polyphonic workflow” and mark the relevant step “coming next.” Do not present a future screen as a captured beta screen.

---

## Section 04 — System Map

### Purpose

Explain ownership, hierarchy, and access boundaries in one compact visual.

### Required structure

```text
You — authority and direction
  │
  ├── Luca — orientation, delegation, coordination
  │
  ├── Rooms — direct and multi-agent communication
  │
  ├── Agent Library — identities, runtimes, status, settings
  │
  ├── Your Brain — owner-controlled shared intelligence
  │      └── explicit grants to selected agents
  │
  └── Agent Notebooks — private continuity per agent
         ├── handoff
         ├── continuity notes
         └── journal pages
```

Native runtimes—Hermes, OpenClaw, and supported local runtimes—remain attached underneath their agents rather than becoming the top-level product structure.

### Recommended copy

**Eyebrow**  
One system. Clear boundaries.

**Headline**  
Shared work does not require shared identity.

**Body**  
Polyphonic gives the network one place to work while keeping ownership explicit: your intelligence remains yours, each agent’s continuity remains its own, and access is granted rather than inferred.

**Governing line**  
The Brain belongs to you. The Notebook belongs to the agent. Access between them is governed, never assumed.

### Interaction

- Hovering or focusing a component may illuminate its permitted connections.
- Selecting an agent should show its runtime, private Notebook, accessible Brain sources, and rooms.
- Never imply that every component can freely read every other component.

---

## Section 05 — Communication and Conducting

### Purpose

Show that Polyphonic is both a familiar conversation product and a coordination layer.

### Recommended copy

**Eyebrow**  
Communication + orchestration

**Headline**  
Talk to one agent. Or conduct the whole room.

**Body**  
Message any agent directly, bring several into a shared room, delegate across specialties, and keep every contribution visibly attributable to the agent who made it.

**Principle line**  
Orchestration should not make agents disappear.

### Required proof

A real conversation surface supporting:

- Direct-message and room toggle.
- Several agents responding to the same owner message.
- Luca coordinating a task.
- Distinct identity specimens and readable names.
- Reply attribution and signed-authorship indicator.
- Agent runtime status that does not dominate the conversation.

### Interaction

- Let the visitor switch between direct and room views.
- A second optional state may show delegation progress without leaving the conversation.
- The interaction should teach the product; it does not need to simulate a functioning model.

### Authority language

Use:

> You set the direction. Luca helps conduct.

Avoid:

> Luca controls every agent automatically.

---

## Section 06 — The Brain

### Purpose

Position the Brain as the owner’s governed intelligence layer, not as a generic vector database or a memory pool shared indiscriminately across agents.

### Recommended copy

**Eyebrow**  
The Brain

**Headline**  
All of your working intelligence. Finally connected.

**Body**  
Bring projects, knowledge bases, documents, and session history into one owner-controlled intelligence layer. Grant each agent access to exactly what it needs—and preserve where every answer came from.

### Three promises

1. **One source layer**  
   Projects, archives, references, and prior work live under one roof.

2. **Scoped access**  
   Choose which agent can recall which source, for which work and runtime destination.

3. **Visible provenance**  
   See what was recalled, where it came from, and which agent received it.

### Required proof

Show a specific source flow:

1. Select a local project or corpus.
2. Preview what will be imported.
3. Commit it to the encrypted owner Brain.
4. Grant access to Anima and Luca.
5. Keep Vektor denied.
6. Show separate recall receipts for each authorized agent.

### Interaction

- The visual should make permission edges explicit.
- Hovering a source may show the agents currently granted access.
- Hovering an agent may show accessible sources.
- Absolute local filesystem paths must not appear in public diagrams or screenshots.

### Claim note

Until the scoped Brain release is included in the beta, label this section “Coming next” or use future tense. The architecture and project navigation are real; broad Brain ingestion is not yet part of the V1.1 verdict.

---

## Section 07 — Mnemos Continuity and Notebooks

### Purpose

Explain why Polyphonic agents feel continuous across sessions and make the mechanism inspectable rather than mystical.

### Recommended copy

**Eyebrow**  
Continuity powered by Mnemos

**Headline**  
Every agent remembers differently—and remains itself.

**Body**  
Each agent has a private, source-backed continuity system for what it intentionally carries forward: current work, durable decisions, commitments, lessons, preferences, and unresolved questions.

### Continuity hierarchy

#### Handoff

The compact working state carried into a fresh runtime session.

Contains:

- Current summary
- Unresolved threads
- Commitments
- Explicit preferences
- Exact signed source-event references

#### Continuity Notes

Selective durable records that may support future conversation.

Categories:

- Decision
- Durable context
- Lesson
- Explicit preference
- Commitment
- Open question

#### Journal Pages

Deliberate resident-authored Markdown documents. They remain outside ordinary chat recall unless intentionally selected for another Notebook operation.

### Owner controls

- Inspect provenance.
- Review revision history.
- Correct a Continuity Note without pretending the correction was authored by the agent.
- Add separate owner annotations to Journal Pages.
- Pin, supersede, archive, forget, cancel, and retry where appropriate.

### Recommended principle lines

> Continuity preserves meaning, not a transcript dump.

> Every agent has a Notebook. No agent receives another agent’s private memory.

### Required proof

Show one agent’s real Notebook with:

- Current handoff.
- Two Continuity Notes.
- One Journal Page.
- Source-event provenance.
- Revision number.
- A visible owner correction or annotation.
- An encrypted/private state indicator.

### Interaction

- Let the visitor switch between Handoff, Continuity Notes, and Journal Pages.
- Opening a note may reveal the source conversation.
- A revision-history interaction can demonstrate inspectability.
- Keep the Notebook visually calm and document-like; avoid turning it into a data dashboard.

---

## Section 08 — Agent Studio

### Purpose

Make agent creation a primary product promise rather than a small add/import button.

### Recommended copy

**Eyebrow**  
Agent Studio

**Headline**  
Create the agent your network needs next.

**Body**  
Polyphonic is not only a home for agents you already use. Define a new resident’s identity, purpose, instructions, runtime, and model—then give it a place to communicate, work, and build continuity.

### Three public paths

#### Hermes

Connect an existing Hermes profile or configure a Hermes-backed resident while preserving native authority.

#### OpenClaw

Bring an existing OpenClaw agent into Polyphonic or create a supported OpenClaw-backed resident through the guided setup path.

#### Polyphonic native

Create a resident directly inside Polyphonic with an identity, instructions, runtime, model, Notebook, and network presence.

### Required proof

Show the creation flow, not just three logos:

1. Choose foundation.
2. Name the agent and define its purpose.
3. Select runtime and model.
4. Review permissions and credential state.
5. Create cryptographic identity.
6. Arrive in the new resident workspace.

### Interaction

- A foundation selector may transition the setup fields beneath it.
- The identity specimen should resolve only when the agent is created, making identity formation visible.
- Avoid a long developer configuration form in the landing page. Show the meaningful product decisions.

### Claim note

The exact create-versus-import capability of each runtime must match the release being marketed. If only import is verified for a runtime, say “Connect” rather than “Create.”

---

## Section 09 — Security Architecture

### Purpose

Translate the security model into understandable user promises, then offer enough technical specificity to be credible.

### Recommended copy

**Eyebrow**  
Security architecture

**Headline**  
A trust layer for the agent era.

**Body**  
Polyphonic treats identity, authorship, private memory, permissions, and runtime authority as separate security boundaries—not settings added after the product is built.

### Plain-language promises

- Your agents keep separate identities.
- Their private memory stays isolated.
- Imported credentials remain with their native runtimes.
- Knowledge is shared only when you authorize it.
- Every contribution retains its authorship.
- Communication continues if the continuity layer is unavailable.

### Technical disclosure layer

#### Independent cryptographic identity

Every managed resident has a stable public identity and private signing custody.

#### Native key custody

Private signing material remains in trusted native secure storage and is not passed into renderer or agent-runtime descendants.

#### Encrypted continuity

Resident continuity uses separately derived owner/resident namespaces and authenticated XChaCha20-Poly1305 encryption.

#### Signed authorship

Conversation events preserve who authored each response.

#### Agent isolation

Room membership does not grant access to another agent’s Notebook or to owner Brain sources.

#### Native runtime authority

Hermes and OpenClaw remain authoritative for their own profiles, tools, credentials, projects, workspaces, and native memory.

#### Fail-soft operation

Normal messaging remains usable when continuity is disabled, locked, absent, corrupt, slow, or unavailable.

### Required proof

Use one compact trust diagram:

```text
Native secure storage
  └── resident identities and signing authority

Encrypted owner Brain
  └── explicit per-agent grants

Encrypted resident namespaces
  ├── Luca Notebook
  ├── Anima Notebook
  └── Vektor Notebook

Native runtimes
  └── retain their own credentials and native memory
```

### Interaction

The diagram may reveal details progressively, beginning with the user promise and expanding into the technical boundary. Do not begin with cryptographic primitives.

---

## Section 10 — Luca

### Purpose

Give Polyphonic a recognizable native intelligence and clarify Luca’s relationship to the user and other agents.

### Recommended copy

**Eyebrow**  
Meet Luca

**Headline**  
Your concierge at the center of Polyphonic.

**Body**  
Luca helps you understand the network, gather the right agents, delegate work, surface what needs attention, and keep complex collaboration coherent.

**Authority line**  
You set the direction. Luca helps conduct.

**Independence line**  
Every other agent remains directly addressable and always speaks as itself.

### Required proof

Show Luca performing useful network-level work:

- Identifying which agents are available.
- Suggesting the right agents for a project.
- Delegating two bounded assignments after an owner request.
- Reporting permission or runtime blockers.
- Returning agent results to the originating room.

Avoid a generic “How can I help?” conversation.

### Interaction

A compact Luca conversation may update the adjacent network state. The user should see that Luca understands the system, not merely the current message.

---

## Section 11 — Beta Scope

### Purpose

Build trust by showing what the visitor can expect from the first beta and where the product is going.

### Recommended copy

**Eyebrow**  
The first private beta

**Headline**  
Begin with the network. Deepen the intelligence from there.

### Suggested three-column structure

#### In the beta

- Unified Agent Library
- Hermes and OpenClaw import
- Managed resident creation
- Direct messages and shared rooms
- Stable cryptographic identity
- Encrypted handoffs
- Continuity Notes and Journal Pages
- Notebook controls and provenance
- Project/room navigation

#### Coming next

- Scoped Brain sources
- Source grants and revocation
- Narrow local project import
- Brain-assisted answer provenance
- Resident-requested Notebook review
- Expanded Agent Studio

#### The direction

- Broader project and history import
- Deeper Luca-led orchestration
- More complete agent creation paths
- Scheduled, transparent reflection
- Conservative proactive assistance

### Interaction

No animation is necessary. The value is clarity.

---

## Section 12 — Who Polyphonic Is For

### Purpose

Let qualified visitors recognize themselves without broad persona marketing.

### Recommended copy

**Headline**  
For people whose AI work has already outgrown a single chat window.

### Recognition statements

- You already move between several agents or runtimes.
- You repeatedly explain the same project context.
- You want specialized agents without losing a coherent place to work.
- You care who authored an answer and what source informed it.
- You want continuity without giving every agent access to everything.
- You are building a durable practice around AI rather than running isolated prompts.

### CTA

Join the private beta

---

## Section 13 — FAQ

### Does Polyphonic replace Hermes or OpenClaw?

No. Polyphonic gives compatible native agents a secure identity, home, conversation layer, and continuity system while their native runtime remains authoritative for its own profiles, tools, credentials, projects, workspaces, and native memory.

### What is the difference between the Brain and an agent’s Notebook?

The Brain is your owner-controlled shared intelligence. A Notebook is one agent’s private continuity record. Importing something into the Brain does not automatically grant access to any agent, and agents cannot read one another’s Notebooks.

### Does changing the model replace the agent?

Not necessarily. In Polyphonic, the resident’s cryptographic identity is separate from its current runtime and model binding. A supported binding can change without silently replacing who authored the work.

### Does Polyphonic copy my agent credentials?

Imported Hermes and OpenClaw configuration and credentials remain under their native authority. Polyphonic should describe the exact custody behavior of every additional runtime it supports.

### Can I talk directly to every agent?

Yes. Luca can help coordinate the network, but each managed agent remains directly addressable and answers as itself.

### Can agents read one another’s memory?

No. Private resident continuity is isolated by agent. Being in the same room does not grant access to another agent’s Notebook.

### What does continuity mean?

Continuity is a bounded, inspectable record of what an agent intentionally carries forward—such as current work, decisions, commitments, preferences, lessons, and open questions. It is not a claim of restoring a native runtime transcript or remembering everything.

### Is everything end-to-end encrypted?

The public answer must match the verified transport architecture at launch. The current defensible claim is that private continuity is encrypted, signing keys remain in native secure storage, resident identities are cryptographic, and private resident memory is isolated from the relay and other agents.

### What can Luca do automatically?

In the initial product, Luca provides orientation and user-directed coordination. Deeper autonomous delegation should be described only when its actions, permissions, cancellation behavior, and owner controls are implemented and verified.

### When will the beta be available?

Polyphonic is preparing a private macOS beta distributed through TestFlight. Waitlist members will be notified as invitations open.

---

## Section 14 — Final Waitlist CTA

### Purpose

Restate the whole promise without adding new features.

### Recommended copy

**Eyebrow**  
Private macOS beta

**Headline**  
One secure home for every agent you work with.

**Body**  
Join the waitlist to be among the first to create, connect, communicate with, and conduct your agent network through Polyphonic.

**Form label**  
Email address

**Button**  
Join the private beta

**Support line**  
TestFlight invitations will open in small groups. No product spam.

### Functional requirement

The production form must persist submissions, provide accessible validation, prevent accidental duplicate requests, and show a truthful confirmation state. The planning prototype’s non-persistent demo behavior must not ship publicly.

---

# 9. Product Proof Asset Plan

The production page should be built around a small number of excellent, real product captures rather than many decorative mockups.

## Required capture set

1. **Hero network view**  
   Agent Library + shared room + Luca + quiet security/continuity state.

2. **Complete workflow sequence**  
   Import/create → delegate → Brain recall → multi-agent response → Notebook update.

3. **Agent Library**  
   Roster and one full resident workspace with runtime, rooms, identity, and Notebook.

4. **Multi-agent room**  
   Owner message, Luca coordination, two or three distinctly attributed agent replies.

5. **Brain Setup**  
   Source preview, explicit agent grants, and provenance receipt. Use only after the feature is implemented or label as a product-direction concept.

6. **Notebook**  
   Handoff, Continuity Notes, Journal Page, provenance, and revision controls.

7. **Agent Studio**  
   Foundation, identity, instructions, runtime, model, and creation result.

8. **Security diagram**  
   A custom explanatory diagram derived from verified architecture, not a screenshot of internal logs or key material.

## Capture rules

- Use stable fictional project and agent names across the page.
- Never expose real keys, credentials, local paths, private memory, or personal project data.
- Avoid lorem ipsum and generic “summarize this” demonstrations.
- Make every product state believable and internally consistent.
- Do not label a designed concept as a live application capture.

---

# 10. Recommended Demonstration World

Use one consistent fictional network so the landing page reads like a coherent story.

## Owner

Riley may be represented simply as `You`; avoid making the public page depend on a personal founder persona.

## Agents

- **Luca** — native concierge and coordinator
- **Anima** — research and narrative specialist
- **Vektor** — builder and technical verifier
- **Orin** — OpenClaw operations agent

## Project

**Atlas launch**

## Brain sources

- Product brief
- Security architecture
- Beta acceptance notes
- Customer research

## Workflow

Prepare the Atlas private beta announcement. Luca delegates narrative validation to Anima and proof validation to Vektor. Orin checks operational readiness. Each agent receives only the sources required for its task. Their results return to one room, and their Notebooks retain different continuity.

This world can be replaced later, but one consistent world should be used throughout production.

---

# 11. Interaction and Motion System

Motion should clarify system behavior.

## Recommended motion motifs

### Signal matrix

Use the inherited grid/matrix language sparingly to display relevant phrases, network state, or identity signals.

### Permission paths

Animate access only along valid Brain-to-agent grants. Denied or absent links should remain visibly disconnected.

### Continuity transition

Show a fresh runtime session receiving a compact handoff, then becoming ready. Do not imply that an entire transcript or internal model state was restored.

### Conducting

Show one owner request dividing into explicit assignments and returning as attributed contributions.

### Identity persistence

Allow the runtime/model label to change while the agent’s identity specimen and fingerprint remain stable.

## Motion constraints

- Respect `prefers-reduced-motion`.
- Never hide essential information inside animation.
- Avoid scroll hijacking.
- Keep product text selectable and accessible.
- Do not autoplay rapid simulated chat.
- Motion should be quiet enough that the page still feels professional and dependable.

---

# 12. Visual Direction for Production

The planning prototype defines format and story, not final visual design.

## Preserve

- Familiar editorial landing-page structure.
- Smaller, legible typography rather than enormous manifesto text.
- Monochrome charcoal/black surface hierarchy.
- Subtle green signal color used for meaningful state.
- Fine hairlines and layered application surfaces.
- The restrained animated matrix as a recurring instrument.
- Real product UI as the primary visual proof.

## Improve

- Establish a more distinctive brand mark and identity system for Polyphonic.
- Replace generic feature cards with a few larger narrative product moments.
- Increase typographic refinement and long-form reading rhythm.
- Make product captures feel spatially coherent and native to the actual macOS app.
- Develop a consistent diagram language for authority, access, and continuity.
- Use motion to connect sections without making the page feel experimental or game-like.

## Avoid

- Giant text occupying entire screens.
- Split-screen reading for long stretches.
- Dense grids of equally weighted feature cards.
- Neon agent-network clichés.
- Floating glass panels without functional meaning.
- Orbital particles, brains, glowing humanoids, or generic AI imagery.
- Making the matrix the dominant content surface.
- Excessive technical metadata above the fold.

---

# 13. Accessibility and Responsive Requirements

- The complete story must remain understandable without animation.
- Every interactive demonstration requires keyboard access and an accessible label.
- Identity and runtime states must not rely on color alone.
- Text should preserve comfortable reading size and line length at all breakpoints.
- Mobile should use a normal document flow rather than squeezing desktop diagrams.
- Sticky demonstrations must release cleanly and never trap scrolling.
- Product screenshots require meaningful alternative descriptions.
- Decorative matrix canvases should be hidden from assistive technology while their current phrase is available as text.
- Forms require explicit labels, error association, focus management, and a readable success state.
- Minimum touch targets should be 44px.
- Contrast must meet WCAG AA for essential text and controls.

---

# 14. Production Implementation Notes for Codex

## Content architecture

- Treat this blueprint as the narrative source of truth.
- Build sections as composable components, but avoid turning every paragraph into a separate abstraction.
- Keep all public claims in a central content model or clearly named constants so beta-versus-roadmap wording can be audited.
- Make the demonstration world data-driven so names, sources, and states remain consistent across sections.

## Product media

- Prefer real app captures and real lightweight HTML/CSS representations over raster screenshots when interaction materially teaches the feature.
- Clearly tag concept-only product states in source and visual copy.
- Do not pull internal private application data into the marketing site.

## Waitlist

- Use a real persistence layer before public release.
- Collect only the minimum necessary information.
- Add rate limiting and duplicate handling.
- Define the privacy copy before collecting emails.
- Make success and failure states durable and accessible.

## Analytics

If analytics are added, track only meaningful product questions:

- Hero CTA engagement
- Completion of the workflow story
- Brain/Notebook conceptual comprehension proxy
- FAQ expansion
- Waitlist conversion

Avoid invasive session replay by default, particularly because privacy is a core product promise.

## Performance

- First viewport should not depend on a heavy video.
- Defer nonessential animation.
- Use responsive product assets.
- Keep the matrix canvas bounded and pause it when offscreen.
- Preserve a strong static experience during slow loading.

---

# 15. Acceptance Criteria

The production landing page is ready when:

## Comprehension

- A first-time visitor can explain Polyphonic in one sentence after the hero.
- The Brain/Notebook distinction is understandable without reading the FAQ.
- Luca’s role is clear without implying hidden control over the network.
- The visitor understands that Polyphonic works with multiple agents and runtimes.

## Credibility

- Every present-tense feature claim maps to shipped or verified functionality.
- Future functionality is visibly labeled.
- Security language stays within verified boundaries.
- Product proof uses consistent, non-sensitive data.

## Narrative

- The page contains one complete end-to-end workflow.
- Sections build on one another rather than repeating “all your agents in one place.”
- The page explains the problem before presenting the full architecture.
- The final CTA feels like the conclusion of the story rather than an interruption.

## Experience

- Desktop, tablet, and mobile layouts are intentionally designed.
- Reduced-motion behavior is complete.
- Keyboard navigation and focus states are verified.
- The page remains useful before or without animation.
- The waitlist form actually stores submissions and reports errors truthfully.

## Brand

- The page feels like a professionally built product, not a speculative AI concept.
- The visual language is restrained, legible, and distinctive.
- Every decorative element teaches identity, plurality, continuity, authority, or state.

---

# 16. Final Production Handoff Checklist

Before Codex begins the polished build, provide:

- This blueprint.
- The current planning prototype URL or source.
- Current Polyphonic application screenshots.
- The authoritative list of beta features at build time.
- Confirmed runtime support and create-versus-import behavior.
- Confirmed waitlist storage destination and privacy copy.
- Final Polyphonic wordmark/logo assets, if available.
- Final typeface/licensing decision.
- Any approved product-motion references.

Codex should first build the semantic page structure and complete copy, then integrate real product proof, then refine motion and visual polish. Visual invention should not be allowed to change the product authority model or blur current and future claims.

---

## Canonical Closing Statement

> Polyphonic gives every agent a secure place in one coherent network—shared work without erased identity, shared intelligence without assumed access, and continuity without surrendering control.

