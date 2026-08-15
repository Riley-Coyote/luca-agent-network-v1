# Luca conversational onboarding contract

Status: decision-complete product contract

Scope: desktop first-run experience

## Design authority

Onboarding follows this hierarchy, in order:

1. [Apple Human Interface Guidelines — Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/) for platform behavior, keyboard and pointer interaction, typography, and desktop control conventions.
2. [Apple HIG — Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) for a fast, focused flow that defers nonessential setup and teaches through use.
3. [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout) and [Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls) for hierarchy, alignment, logical grouping, and progressive disclosure.
4. [Apple HIG — Motion](https://developer.apple.com/design/human-interface-guidelines/motion) and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) for brief purposeful feedback, reduced motion, keyboard access, status announcements, and macOS-sized controls.
5. Luca's production shell for tokens, iconography, typography, and interaction continuity.
6. Linear, Vercel, and Stripe as secondary references for restraint, density, tonal hierarchy, and precise state copy, not as substitutes for macOS conventions.

The Riley design-language guide is explicitly excluded from this onboarding work. This contract and the platform guidance above are authoritative.

## Product decision

Luca's default onboarding is a short path into a real conversation with the canonical Luca resident. It asks for the owner's name and requires the owner to confirm one ready runtime that will power Luca. Runtime selection is separate from optional import of native Hermes and OpenClaw agents.

Onboarding does not require a person to understand residents, identity architecture, Brain sources, provider keys, or native profiles. It uses ordinary language, performs read-only discovery automatically, and postpones nonessential setup until it becomes useful.

There is no temporary onboarding bot. The Luca who greets the owner is the same persistent Luca resident they can continue speaking with later.

## Goals

1. A new owner confirms one genuinely ready supported runtime before entering a conversation.
2. A ready recommendation may be preselected, but the owner confirms it through Continue.
3. A person with existing native agents may optionally choose which ones to import; nothing is selected by default.
4. A person without existing agents never sees an empty import chapter.
5. Luca greets the owner once, then responds to the person's actual request instead of forcing another questionnaire.
6. First launch follows macOS appearance by default, with complete Light and Dark themes available immediately and later in Settings.
7. Optional Brain connection, backup, and advanced setup remain available without blocking first conversation success.

## Non-goals

- Do not introduce a second onboarding agent, public IPC schema, runtime catalog, setup store, or identity system.
- Do not store direct-provider credentials or ask for an OpenRouter key. Hermes and OpenClaw keep provider configuration in their native systems.
- Do not silently import agents, copy native credentials, change native configuration, connect sources, or grant Brain access.
- Do not automatically create Vektor, Anima, or a starter team.
- Do not require mobile, Activity, Mnemos, Notebook, or new security work.
- Do not turn first conversation into a personality intake or mandatory commissioning interview.

## Default journey

### 1. Welcome

The first screen contains:

- Luca's exposed dot glyph and name;
- a short explanation of the product;
- the owner's display-name field;
- **System**, **Light**, and **Dark** appearance choices;
- primary action: **Begin**;
- secondary action: **Set up manually**.

Rules:

- System is initially selected and follows current macOS appearance.
- Light uses graphite dots with no backing tile. Dark uses light dots with no backing tile. Geometry and size are identical.
- Appearance previews immediately and persists through the journey.
- The product does not present runtime or agent terminology on this screen.

### 2. Choose what powers Luca

This screen is required. It uses a compact radio list in recommendation order:

1. Codex
2. Claude Code
3. Kimi Code
4. Grok
5. Hermes
6. OpenClaw

Copy:

> **Choose what powers Luca**
>
> Pick the AI Luca should use on this Mac. You can change it later without changing who Luca is.

Each row shows its existing runtime icon, name, and one status: **Ready**, **Sign in**, **Set up**, **Checking**, or **Unavailable**. The selected row may show one concise explanation.

Capability truth:

- ACP runtimes support conversations and Luca collaboration.
- Hermes and OpenClaw support direct conversations and existing native agents; advanced collaboration remains limited.

Behavior:

- A recommended ready runtime may be preselected.
- Continue is disabled until the selected runtime is Ready.
- Selecting an unready runtime reveals one inline recovery area, never a separate error page.
- Use **Sign in** only when a supported auth action exists.
- Use **Install** only when Luca already supports automatic installation.
- Use **Open setup guide** for externally managed setup.
- Use **Check again** after external setup.
- Hermes and OpenClaw retain their native provider configuration, including OpenRouter where configured. Luca never requests or stores that provider key.
- If no runtime is ready, this screen remains the focused recovery experience.

Choosing a runtime determines what powers canonical Luca. It does not import, create, or mutate any other agent.

### 3. Existing agents

Read-only native discovery begins during setup. The user is never asked whether they have agents.

When candidates are available in time, show:

> **Bring in agents you already use**
>
> We found {N} agents on this Mac. Nothing is imported unless you choose it.

The summary includes Hermes and OpenClaw source counts, a primary **Choose agents** action, and a quiet **Not now** action.

Choosing agents expands the same surface into a searchable, grouped inventory:

- no candidates selected initially;
- one contained list with an internal scrollbar;
- disabled candidates preserve their real reason;
- **Import N and continue** when selected, otherwise **Continue**;
- Back returns to the summary without losing current selection.

If discovery returns no candidates, fails, or is not complete when runtime selection finishes, skip this screen. Onboarding remains usable. Luca may mention a later discovery once in ordinary conversation.

### 4. Preparation

After the owner confirms a ready runtime and resolves the optional import screen, Luca performs one idempotent preparation sequence:

1. save the owner's display name and appearance;
2. provision or reuse canonical Luca with the confirmed runtime;
3. import only explicitly selected agents;
4. create or reuse the canonical owner-Luca direct conversation;
5. start Luca only when the conversation requires it;
6. open the conversation and publish exactly one first greeting.

The interface shows one stable status:

> **Getting Luca ready…**

Use one restrained native-feeling progress indicator. Do not show a scanner log, pulse loop, checklist, percentage, or artificial delay. Reduced Motion uses a static status indicator. Production advances immediately when real work completes.

### 5. First real conversation

The destination is Luca's ordinary canonical DM, using the production conversation surface, history, identity, composer, and managed response path.

Luca sends one durable greeting:

> Hi, {name} — I'm Luca. I'm ready. What would you like help with first?

Luca answers the owner's first substantive request. A natural-language request to create an agent can produce the existing compact Polyphonic Agent review, but the first conversation is not another setup questionnaire.

## Conversational commissioning

Luca may learn what the owner needs over time and offer setup when useful. This is ordinary conversation plus reviewed product actions, not a parallel wizard.

Rules:

- Ask at most one setup-oriented question in a turn.
- Prefer advancing the person's current task before asking for personalization.
- Do not ask questions whose answers can be inferred safely.
- Never claim an agent, import, connection, project, room, or grant exists before the operation commits.
- A declined suggestion changes nothing and is not repeated insistently.

Any action that creates, imports, connects, grants, invites, or otherwise changes persistent product state displays the existing concise review before execution.

## Appearance and layout

- One centered content column, approximately 560–640 px wide.
- One dominant action per state.
- Use SF system typography and existing Luca runtime icons.
- Use spacing, tonal surfaces, and typography before borders or dividers.
- Do not stack cards or draw a border around every group.
- Light uses a warm neutral foundation; Dark remains intentional rather than mechanically inverted.
- Color is reserved for semantic status.
- Header and footer stay stable. Only a long agent inventory introduces a local scroll region.
- There is no step counter because the import screen is conditional.
- Transitions use brief 160–220 ms fades or small positional changes. Reduced Motion removes translation.
- The supported 800×500 desktop minimum must keep the outer frame and footer visible.

## State and recovery

The production implementation may evolve the existing onboarding transaction but must not add a second competing state machine. Durable phases are:

1. owner identity available;
2. owner profile and appearance saved;
3. confirmed runtime ready;
4. optional import choice resolved;
5. canonical Luca resident available;
6. canonical owner-Luca DM available;
7. first greeting accepted or safely reconciling;
8. first-run gate complete.

Every phase is idempotent. Relaunch resumes the earliest incomplete phase without duplicating identity, Luca, a DM, imports, or messages. A failed optional discovery never blocks ordinary messaging.

## Prototype contract

The deterministic prototype uses preview-local state only:

- `welcome`
- `runtime`
- `agents-summary`
- `agents-select`
- `preparing`
- `conversation`
- `proposal`

Direct visual review uses `prototypeState` and `prototypeScenario` query parameters. Fixtures cover mixed readiness, Codex and Claude authentication, automatic installation, Hermes-only, OpenClaw-only, no-ready-runtime, setup success and failure, agents found, no agents, delayed discovery, and failed discovery.

The prototype invokes no production installation, authentication, provisioning, import, or messaging command. Production connection is a separate implementation package after journey approval.

## Acceptance criteria

### Runtime

- A ready recommendation is preselected and still requires owner confirmation.
- Native radio behavior, keyboard focus, and status announcements are correct.
- Sign-in, install, guide, checking, unavailable, retry, success, and failure states preserve layout.
- Hermes-only and OpenClaw-only fixtures can reach the conversation.
- A no-ready fixture cannot enter a broken conversation.

### Existing agents

- Found candidates produce the optional summary and selection states.
- No candidates, delayed discovery, and failed discovery skip the import screen.
- Nothing is selected or imported silently.
- The inventory never clips the footer or outer frame.

### Conversation

- The canonical greeting appears once in the representative production DM shell.
- The first conversation remains task-led rather than setup-led.
- The natural-language Polyphonic Agent proposal remains demonstrable.

### Accessibility and presentation

- System follows current macOS appearance; Light and Dark remain complete.
- Every state works at 1440×900, 1024×768, and 800×500.
- Keyboard-only navigation, focus order, labels, live status, and reduced motion are correct.
- No blank transition or theme flash occurs.

## Deferred

- Production onboarding wiring and persistent migration.
- Direct-provider execution and provider-key storage.
- Bundled local inference or hosted bootstrap for machines with no runtime.
- New third-party installation or authentication mechanisms.
- Voice-led commissioning, mobile onboarding, and proactive setup beyond ordinary conversation.
