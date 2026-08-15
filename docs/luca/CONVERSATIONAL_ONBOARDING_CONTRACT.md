# Luca conversational onboarding contract

Status: decision-complete product contract

Scope: desktop first-run experience

Authority: Riley-approved product direction, current `luca/v1.1` source, and
Apple's onboarding principles of fast entry, reasonable defaults, optional
instruction, and learning through use

## Product decision

Luca's default onboarding is a short path into a real conversation with Luca.
It is not a configuration wizard and it does not require a new user to
understand agents, runtimes, residents, native profiles, Brain sources, or
identity architecture before receiving value.

The default path performs safe prerequisite work automatically, asks only for
information that cannot be inferred, and opens Luca's canonical conversation as
soon as one usable runtime is available. Agent import, Brain connection,
recovery backup, and detailed runtime selection remain available through a
quiet **Set up manually** path and their permanent product surfaces.

There is no temporary onboarding bot. The Luca who greets the owner is the same
persistent Luca resident they can continue speaking with later.

## Problem

The current Polyphonic first-run flow makes identity, runtime selection, native
agent import, Brain connection, and readiness review consecutive mandatory
chapters. This is understandable to an experienced agent user, but it asks a
newcomer to make technical decisions before they know what Luca does. Long
inventories and configuration language make first use feel like system
administration instead of meeting a capable assistant.

The cost is delayed time to first value, unnecessary cognitive load, and the
impression that a person must already understand agent infrastructure to use
Luca.

## Goals

1. A person with one ready supported runtime reaches a usable Luca conversation
   after one required personal choice: the name Luca should use for them.
2. A person never has to select a runtime, import an agent, connect a Brain
   source, or create a recovery backup before starting a conversation.
3. Luca greets the owner first and can continue setup through ordinary natural
   language without turning the conversation into an intake questionnaire.
4. Existing agents and work are discovered without being imported, connected,
   or granted access silently.
5. Every optional setup choice remains reachable later and every consequential
   conversational action receives the existing concise review and approval.
6. First launch follows the Mac's appearance by default, with complete Light and
   Dark themes available immediately and later in Settings.

## Non-goals

- Do not introduce a second onboarding agent, new conversation type, new public
  IPC schema, new runtime catalog, or new setup storage system.
- Do not bundle a model, store direct-provider credentials, or automatically
  install or authenticate third-party runtimes in this slice.
- Do not silently import native Hermes/OpenClaw agents, copy native credentials,
  modify native configuration, connect work sources, or grant Brain access.
- Do not redesign the existing advanced runtime, agent-import, Brain, recovery,
  or Agent Forge review surfaces beyond what is necessary to make them
  reopenable and optional.
- Do not automatically create Vektor, Anima, or a starter team for a new owner.
- Do not require mobile, Activity, Mnemos, Notebook, or new security work for
  first conversation success.

## User model

### Beginner

The beginner may not know what an agent or runtime is. Luca chooses sensible
defaults, uses ordinary language, and introduces concepts only when the person
needs them.

### Existing agent user

The experienced user can enter the app immediately, review detected agents
through **Set up manually**, or ask Luca to bring specific agents in later.

### Returning or interrupted user

The returning owner bypasses completed onboarding. An interrupted first run
resumes from the earliest incomplete prerequisite without duplicating identity,
Luca, a DM, imports, or messages.

## Default journey

### 1. Welcome

The first screen contains:

- Luca's name and identity mark;
- one short explanation of the product;
- the owner's display-name field;
- a quiet appearance control with **System**, **Light**, and **Dark**;
- primary action: **Begin**;
- secondary action: **Set up manually**.

Rules:

- **System** is selected initially and follows the current macOS appearance.
- Appearance changes preview immediately and persist locally.
- The appearance control is optional; it is not a separate step.
- Recovery backup is not requested here. It remains in Security & Backup and
  may be suggested contextually after the person has entered the app.
- The product does not present runtime or agent terminology on this screen.

### 2. Automatic preparation

After **Begin**, Luca performs one idempotent preparation sequence:

1. save the owner's display name;
2. discover supported runtime readiness concurrently through existing runtime
   discovery;
3. resolve the default through the existing saved-preference and recommendation
   logic;
4. provision or reuse the canonical Luca resident only;
5. create or reuse the canonical owner-Luca direct conversation;
6. start Luca only when the conversation requires it;
7. enter that conversation and publish exactly one first greeting.

The interface stays in one stable frame while this happens. It may show a short
plain-language status such as **Getting Luca ready…**. It must not expose a
scanner log, rapidly changing checklist, artificial progress percentage, or a
full list of detected infrastructure.

The sequence has no artificial delay. A visible working state appears
immediately, and the conversation opens as soon as the existing operations
finish.

### 3. Runtime-required recovery

Conversation cannot be fabricated without a usable runtime. If none is ready,
the automatic sequence stops on the only permissible blocking setup screen:

> Luca needs one AI runtime to begin.

That screen:

- names a detected runtime in ordinary language when one only needs connection
  or authentication;
- offers the existing supported connection or recovery action;
- offers **Choose another runtime** through manual setup;
- explains failures in human terms without exposing raw command output;
- automatically resumes preparation after readiness succeeds;
- keeps identity and prior successful preparation intact.

This release does not pretend to offer conversational setup before a model can
run. A future bundled or direct-provider bootstrap may remove this final
prerequisite, but it is not part of this contract.

### 4. First real conversation

The destination is Luca's ordinary canonical DM, using the production
conversation surface, history, identity, composer, and managed final-response
path.

Luca sends one first message:

> Hi, {name} — I'm Luca. I'm ready. What would you like help with first?

The greeting is durable, authored by the real Luca resident, and published once
even after relaunch or reconciliation. No invisible onboarding transcript is
created.

Luca's first obligation is to respond to the person's actual request. Luca does
not force an interview before helping.

## Conversational commissioning

Luca may learn what the owner needs over time and offer setup when it is useful.
This is called conversational commissioning; it is ordinary conversation plus
existing reviewed product actions, not a parallel wizard.

### Conversation rules

- Ask at most one setup-oriented question in a turn.
- Prefer completing or advancing the user's current task before asking for
  personalization.
- Do not ask questions whose answers can be inferred safely from local
  readiness, current conversation, or existing profile state.
- Do not teach runtime or identity vocabulary unless the owner asks or opens
  manual setup.
- Never claim that an agent, import, connection, project, room, or grant exists
  before the underlying operation commits.
- A declined suggestion changes nothing and is not repeated insistently.

### Natural-language actions

Luca may propose, through existing product commands and review surfaces:

- creating one Polyphonic Agent for a stated purpose;
- choosing a supported runtime using the current recommendation system;
- importing selected already-discovered native agents;
- creating or opening a DM or shared conversation;
- connecting a selected work source;
- granting a specific agent access to a connected source.

The model supplies intent and user-facing semantics. Existing trusted desktop
commands remain responsible for validation, identity, storage, provisioning,
membership, and publication.

### Review boundary

Read-only discovery and conversational suggestions do not require confirmation.
Any action that creates, imports, connects, grants, invites, or otherwise changes
persistent product state displays a compact inline review before execution.

The review uses the existing Agent Forge or relevant production confirmation
surface and shows only what the owner needs to decide:

- what will happen;
- which agent, runtime, conversation, or source is involved;
- what access will be granted;
- **Approve**, **Edit**, and **Cancel**.

Approval executes the existing operation. Success produces a concise receipt in
the source conversation. Failure leaves the conversation usable and offers one
clear recovery action.

## Detected agents and work

Discovery begins in the background after identity is available. Discovery is
read-only and must not delay entry when Luca is otherwise ready.

Luca may mention a useful result once, for example:

> I found some agents already on this Mac. We can bring them in whenever you
> want.

Rules:

- Nothing is selected or imported by default.
- The first greeting is not delayed for a complete native inventory.
- The owner can say which agents to import, open the detected-agent review, or
  ignore the suggestion permanently.
- Brain sources are discovered as metadata only and are never connected or
  granted silently.
- Unavailable sources and agents remain honest but do not interrupt ordinary
  conversation.

## Manual setup

**Set up manually** is a quiet secondary route, not a competing primary journey.
It reuses the advanced setup capabilities already implemented in Luca:

1. **Agents and runtimes** — inspect readiness, choose a default, and import
   selected native agents.
2. **Brain and work** — review discovered repositories, sessions, and files;
   connect only explicit selections.
3. **Security and backup** — create or restore protected owner recovery from the
   existing Settings surface.

Manual setup is also reopenable from Agents, Brain, and Settings after entry.
Closing it returns to the welcome screen before entry or the originating product
surface afterward. It never resets completed work.

The current ready-summary chapter is removed from the default journey. The
successful first conversation is the readiness confirmation.

## Current-to-target mapping

| Current mandatory surface | Target disposition |
|---|---|
| Owner name and identity | Keep only the display name on Welcome; identity remains automatic |
| Recovery backup disclosure | Move to Security & Backup and contextual suggestion |
| Default runtime selection | Resolve automatically; keep in manual setup and Settings |
| Luca selection | Provision/reuse Luca automatically |
| Native agent inventory | Optional manual setup or later conversational import |
| Brain connections | Optional manual setup or contextual conversation action |
| Ready summary | Remove from default path; enter Luca's DM instead |
| Luca, Vektor, Anima welcome team | Replace with canonical Luca only |
| Dark-only first impression | Follow macOS; offer System, Light, and Dark |

## Appearance contract

- First launch defaults to **System** and reacts to macOS appearance changes
  until the owner chooses Light or Dark explicitly.
- Light and Dark use the same semantic tokens and hierarchy; neither is a
  mechanically inverted afterthought.
- Light uses a warm neutral foundation, softly differentiated elevated
  surfaces, graphite text, restrained borders, and semantic color only where it
  communicates state.
- Dark remains available and intentional, but pure black is not the universal
  brand default.
- Appearance applies to onboarding and the main shell without a flash of the
  other theme during transition.
- The permanent control lives in Settings > Appearance.

## State and recovery

The implementation may evolve the existing local onboarding transaction but
must not add a second competing state machine. Durable phases are:

1. owner identity available;
2. profile saved locally, with relay sync allowed to complete later;
3. runtime ready or explicitly blocked;
4. canonical Luca resident available;
5. canonical owner-Luca DM available;
6. first greeting accepted or safely reconciling;
7. first-run gate complete.

Every phase is idempotent. Relaunch resumes the next incomplete phase. A
successful prior phase is reused, not repeated. Optional discovery, imports,
Brain, backup, and theme customization cannot prevent ordinary messaging after
the runtime and Luca conversation are ready.

## Acceptance criteria

### Ready runtime

- Given a clean profile and one ready supported runtime, when the owner enters a
  name and selects **Begin**, then Luca chooses the existing recommendation,
  prepares one Luca resident, opens one canonical DM, and greets the owner once.
- The owner makes no mandatory runtime, agent-import, Brain, backup, or theme
  decision.
- Returning to the app opens the existing conversation without replaying the
  greeting or onboarding.

### No ready runtime

- Given no ready runtime, **Begin** preserves the owner profile and displays one
  focused recovery surface instead of entering a broken conversation.
- Completing the existing connection flow resumes automatically without
  starting onboarding again.
- Cancelling manual runtime setup returns safely and does not delete identity.

### Existing agents and sources

- Discovery does not delay the first conversation once Luca is ready.
- No discovered agent or source is imported, connected, or granted access until
  the owner approves the exact action.
- The owner can import through conversation or reopen the existing manual
  inventory.

### Conversation

- The first message is in the real production DM and survives relaunch.
- Luca answers the owner's first substantive request instead of forcing more
  setup questions.
- A natural-language request to create an agent produces the existing review
  surface before any persistent mutation.
- Approval, editing, cancellation, success, and failure remain visible in the
  source conversation without duplicate messages.

### Appearance

- With no Luca preference, onboarding and the main shell match macOS appearance.
- Choosing Light or Dark previews immediately, persists, and prevents system
  changes from overriding the explicit selection.
- Transition from onboarding to conversation has no theme flash.

### Accessibility and presentation

- Welcome and runtime recovery are fully keyboard navigable at the supported
  minimum desktop window.
- Status changes are announced without repeatedly interrupting assistive
  technology.
- Reduced motion removes nonessential transitions without delaying work.
- Working, failure, and retry states preserve layout and keep the primary action
  understandable.

## Success measures

- Required pre-conversation decisions with a ready runtime: one (owner name).
- Required first-run product screens with a ready runtime: one welcome screen,
  followed by the real conversation.
- Silent imports, source connections, grants, or native configuration writes:
  zero.
- Duplicate Luca residents, DMs, or greetings across retry/relaunch: zero.
- A working state appears immediately after **Begin**; no blank or ambiguous
  transition is permissible.

## Delivery order

1. Freeze this contract and deterministic fixtures for ready, unavailable,
   interrupted, returning, and detected-inventory states.
2. Establish complete semantic System/Light/Dark appearance behavior across the
   onboarding frame and destination shell.
3. Replace the default four-chapter Polyphonic flow with Welcome, automatic
   preparation, runtime recovery when necessary, and direct DM entry.
4. Reuse the current advanced agent and Brain surfaces behind **Set up manually**
   and their permanent destinations.
5. Reduce welcome provisioning from the three-agent starter team to canonical
   Luca only.
6. Connect Luca's first greeting and idempotent completion to the existing
   production welcome/conversation path.
7. Add conversational creation/import/connect proposals by composing existing
   discovery, Agent Forge, Brain, membership, and confirmation operations.
8. Verify the installed desktop app from a clean profile; do not claim success
   from preview fixtures alone.

## Deferred considerations

- Bundled local inference or a hosted bootstrap model for machines with no
  supported runtime.
- Automatic installation or authentication of third-party runtimes.
- Voice-led first-run commissioning.
- Mobile companion onboarding.
- Proactive setup suggestions beyond the first owner-initiated conversation.
- Additional personalization that is not needed for the owner's first useful
  exchange.
