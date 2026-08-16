# Polyphonic conversational commissioning handoff

Updated: 2026-08-15

Canonical branch: `luca/v1.1`

Starting product commit: `9eff2bbb905f64159b00c28e5f2546ffdd369152`

## Purpose

Continue the fresh-user experience after onboarding without reopening the
approved onboarding design or inventing another setup system. The next slice is
the ordinary, persistent conversation with Luca: the user can begin working
immediately, while Luca can help connect useful knowledge or create another
agent through natural language when either becomes relevant.

This handoff is an implementation-planning boundary. Begin with a short,
read-only source inspection and produce a decision-complete plan before editing
product code.

## Current product state

The production flow now provides:

1. Polyphonic's existing dendrite threshold.
2. Owner name and appearance selection.
3. A required, genuinely ready runtime for Luca.
4. Optional import of discovered Hermes or OpenClaw agents, with nothing
   selected by default.
5. Preparation of the canonical persistent Luca resident.
6. Entry into the canonical owner-Luca DM with this durable greeting, exactly
   once:

   > Hi, {name} — I’m Luca. I’m ready. What would you like help with first?

Relevant implementation:

- `desktop/src/features/onboarding/ui/PolyphonicOnboardingFlow.tsx`
- `desktop/src/features/onboarding/ui/PolyphonicPreparingStep.tsx`
- `desktop/src/features/onboarding/polyphonicOnboardingState.ts`
- `desktop/tests/e2e/luca/polyphonic-production-onboarding-v3.spec.ts`
- `docs/luca/CONVERSATIONAL_ONBOARDING_CONTRACT.md`

The onboarding contract's older statement that production onboarding wiring is
deferred is superseded by commits `646ebf43` and `c4f784a6`. Its identity,
greeting, progressive-disclosure, and conversational-commissioning decisions
remain authoritative.

The connected Brain repair is complete in `9eff2bbb`. Large repository and
session indexes now fit durable storage, generated token metadata stays
bounded, and startup avoids rebuilding every connected source. Do not redo that
work.

## Settled product decisions

- Polyphonic is the application and personal agent home. Luca is its canonical
  resident concierge, not a temporary onboarding bot or privileged conductor.
- Luca's identity and owner-Luca DM persist beyond onboarding.
- The first conversation is a real conversation, not another wizard, intake
  form, or mandatory personality questionnaire.
- The user may start any task immediately. Setup must never block ordinary
  conversation after a ready runtime exists.
- Luca may offer one relevant setup action at a time, preferably in service of
  the user's current task. Advance the task before asking optional setup
  questions.
- Declining an offer changes nothing and must not produce repeated nagging.
- Never silently connect knowledge, grant access, import an agent, create an
  agent, install a runtime, copy credentials, or mutate native configuration.
- Persistent changes use the application's existing preview, review, grant,
  and commit surfaces. Luca never claims a change succeeded before the product
  confirms it.
- Existing-agent discovery and import remain optional. Newly discovered agents
  may be mentioned once later, without interrupting the user's work.
- Brain is an optional shared, curated, local knowledge layer across residents
  and runtimes. It complements direct machine/tool access; it does not replace
  it or become mandatory.
- Keep direct provider credentials in their native runtimes. Do not add direct
  OpenRouter credential storage to Polyphonic.

## Desired next experience

The canonical greeting lands in the normal DM. From there:

1. The user can simply ask for help and Luca begins the task.
2. If that task would benefit from local work or prior sessions, Luca can make
   one concise offer such as: “I found relevant work on this Mac. Would you like
   me to connect it?”
3. Accepting opens or embeds the existing truthful Brain discovery/preview and
   access review. No source is connected merely because Luca suggested it.
4. If the user asks for another agent, Luca gathers only missing essentials,
   proposes the agent using the existing creation/review path, and waits for
   approval before creation.
5. If useful agents were discovered but not imported, Luca may mention that
   once at a natural moment and let the user choose.
6. Relaunching never repeats the canonical greeting, completed setup, declined
   offers, or the same discovery announcement.

Natural language is the primary interface. Existing product review surfaces are
the confirmation boundary for durable actions.

## Required source inspection

Keep this bounded. Map and reuse the existing seams for:

- Brain source discovery, preview, connection, refresh, grants, and private
  file/folder import in `desktop/src/features/luca/brain/` and their existing
  Tauri commands.
- The current Polyphonic/native agent creation proposal, preview, approval, and
  resident creation flow.
- Canonical Luca DM creation, message markers, normal message publication, and
  any existing one-time owner-visible notice mechanism.
- Existing UI affordances that can be opened from a message or concise inline
  review without creating a new conversation architecture.

Determine from source where one-time conversational cues can live durably.
Prefer an existing message marker, event, or established onboarding state. Do
not create a general commissioning engine or another persistent state machine.

## Planning work packages

The decision-complete implementation plan should separate:

1. **Commissioning cues** — the smallest durable mechanism for relevant,
   one-time, non-blocking suggestions after the greeting.
2. **Conversational knowledge connection** — reuse existing Brain discovery,
   preview, connection, and grant boundaries; no new Brain architecture.
3. **Conversational agent creation** — reuse the existing reviewed creation
   flow and collect only information the product genuinely requires.
4. **Fresh-user verification** — installed-app walkthroughs for empty and
   discovered states, decline paths, relaunch behavior, and normal task use.

Do not implement all four before the source map identifies the smallest reuse
path and Riley approves the resulting plan.

## Explicit boundaries

- No onboarding visual redesign or new threshold animation.
- No new communications broker, transport, outbox, security layer, encryption
  scheme, identity model, credential store, public wire protocol, or runtime
  abstraction.
- No Brain rearchitecture, mandatory Brain setup, or automatic source grants.
- No agent taxonomy overhaul unless an existing creation seam cannot express
  the approved experience; report that contradiction before expanding scope.
- No Activity, mobile, voice, direct OpenRouter integration, P4/P5, release
  orchestration, Docker, or broad repository gate.
- No parallel team program unless Riley explicitly requests it.
- Preserve Buzz messaging as the underlying communication system and preserve
  the normal host-published final-response path.

## Acceptance scenarios

The eventual implementation plan must cover:

- Fresh owner with a ready runtime, no sources, and no other agents.
- Sources discovered and one connected through explicit review.
- Existing agent discovered, offered once, accepted or declined.
- User asks Luca to create a new agent and reviews the exact proposal.
- User ignores all setup and completes a normal task successfully.
- Relaunch produces no duplicate greeting, action, or repeated declined offer.
- Brain unavailable or empty leaves messaging fully usable.
- Every durable action reflects real committed state and every failure remains
  recoverable without losing the conversation.

Verification should remain focused: relevant unit/E2E coverage, frontend
typecheck and build, then one installed fresh-profile walkthrough. Do not call
the slice complete from browser fixtures alone.
