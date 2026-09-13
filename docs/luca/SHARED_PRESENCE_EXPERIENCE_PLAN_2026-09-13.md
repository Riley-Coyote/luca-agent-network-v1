# Polyphonic — shared presence experience

Experience roadmap, September 13, 2026. Riley authorized autonomous Stage 1
implementation and integrator visual review, then approved beginning Stage 2.
Stages 3–4 remain later work with their own decisions and delivery gates.

> A place whose beauty deepens as the relationship accumulates, and whose
> behavior earns the sense of presence its visuals convey.

## Starting point and delivery decision

- Verified clean source: `b5a825f37`, `codex/agent-experience-hardening`,
  `/private/tmp/luca-activity-integration`.
- Installed Dev receipt identifies that desktop revision; its preserved ACP
  helper is from `4689a7a55`. This is a deliberately mixed component receipt,
  not a claim that all installed binaries were rebuilt at the desktop revision.
- Riley chose: **polish the core journey for beta.6; deliver deeper features in
  later stages**. The September 12 beta plan's STATE block is historical and
  predates the current integrated Activity, theme, and runtime work.
- Stage 1 is delivered on `codex/shared-presence-stage1` from that base.
  Beta release, versioning, distribution, and the second-Mac test stay separate.

## Stage 1 delivery — September 13

Installed desktop source: **`75b8470d3208cd7301a075217138e8ff50528f0c`**.
The subsequent documentation commit does not change the built executable.

- `ce7f6afa6`: Canvas can be dismissed during pending native seating; stale
  callbacks cannot reopen it. Repeated close/open retains the existing origin.
- `047882581`: conversation-scoped resident drawer states; restored traces
  cannot invent live work; quiet states return the identity glyph; a mounted
  turn's retained record settles once. No new runtime polling or authority.
- `40786e137`: Notebook dendrite feathered into a circular edge beside its
  introduction, with light-theme structural dots and the existing engine.
- `75b8470d3`: bounded owner/community/resident Notebook location storage,
  safe stale-response handling, same-resident section preservation, semantic
  return focus, and ordinary Notebook metadata typography.

Verification:

- 22 focused unit tests, TypeScript, scoped Biome, and `git diff --check` pass.
- Nine focused browser cases cover dark/light/Obsidian Notebook rendering,
  narrow width plus zoom and reduced motion, tab/item restoration, keyboard
  activation, Canvas interruption/preview/focus, resident drawer navigation,
  Quick Chat draft separation, and activity completion/cancellation/history.
- One native Dev build passed. Existing chunk-size and ineffective dynamic
  import warnings remain; no dependency or runtime changes were made.
- Installed app inspected in the foreground: animated Notebook edge, real Opus
  progress and `PRESENCE_OK` completion, distinct cancelled turn, and both
  retained activity records after restart. Journal Pages survived navigation
  away/back and app restart. An existing HTML artifact opened in Canvas and
  Escape returned to Library.
- Pre-install helpers exited with Dev; eight replacement ACP helpers were
  correctly parented. A later idle spot showed the desktop process at 0.1%
  CPU / about 369 MiB RSS and ACP helpers at 0% / about 13 MiB each. This is a
  process spot check, not a whole-app benchmark. No newly orphaned Dev helper
  was observed through the restart checks.

Dev remains `/Users/rileycoyote/Applications/Luca Agent Network Dev.app`,
`com.luca.agent-network.dev`, with its existing Dev keyring and sidecars.
ACP was preserved from `4689a7a5571c0fb2d1f2b3e1ce92c196e7ba8af7`;
the signed bundle's `Contents/Resources/luca-source.json` records the mixed
component provenance. `codesign --verify --deep --strict` passes.

Rollback executable and original receipt:
`/Users/rileycoyote/Applications/Luca Dev Rollbacks/shared-presence-stage1-2026-09-13`.
Rendered fixture evidence:
`/private/tmp/shared-presence-review-2026-09-13`.
Native screenshots are in the execution conversation. Beta was untouched.

Boundaries: Notebook restoration keeps semantic item/section anchors, not an
exact pixel offset; list restoration searches up to 225 rows, then safely falls
back, while direct selected-item lookup is not page limited. The live Anima
Notebook was empty, so selected-item restoration was verified with fixtures;
native tab restoration was verified with real data. The drawer reports only
available signals: no fabricated runtime readiness or separate user-input-wait
claim. The Stage 2 delivery below supersedes its earlier future-work status.

## Stage 2 delivery — September 13

Desktop source: **`d263662319ffb940faa1b7d05794538006b53eb6`**, on
`codex/shared-presence-stage2`, based on the Stage 1 documentation checkpoint
`2a708d7d4`. Two reviewable commits:

- `d7f1f9559`: body-free exact-turn context receipts in the existing managed
  dispatch store and a scoped native read operation.
- `d26366231`: distinguish available sources, saved conversation attachment,
  bridge delivery evidence, and saved Notebook/handoff state.

The conversation context sheet separates its saved selection from unsaved
choices. Finished private activity records expose an on-demand “Context for
this turn” disclosure. Closed records mount no receipt reader; shared rooms
do not expose the private disclosure. Scope changes discard pending results.
Notebook guidance describes stored material without implying future retrieval.

Receipts are written only after a successful authorized write to the local
runtime bridge, are best effort, and cannot block already-delivered chat. They
retain owner, relay, conversation, resident, turn, session epoch, and selection
revision checks. The displayed revision describes the source selection, not a
file version. Current source listings never backfill old receipts. No source
bodies, credentials, hidden reasoning, or absolute paths are added to them.

Focused checks: 17 JS tests, two native receipt tests, TypeScript, scoped Biome,
and four browser cases pass. One browser test needed to await sheet closure
before reopening its menu; the corrected case passes. Browser inspection
covered wide and narrow/zoom presentation, lazy exact-turn fetch, stale results
after navigation, unavailable legacy evidence, and shared-room exclusion.
One cached native Dev build passed with existing warnings.

Native acceptance: attached one existing connected source in Sol's private
conversation, sent one bounded no-tools prompt, and received
`CONTEXT_RECEIPT_OK`. The receipt showed selection revision 26 and working
context delivered. Restoring the original empty attachment selection did not
change that earlier receipt, including after quitting and reopening Dev.
The real saved handoff was inspected separately. Foreground screenshots and
keyboard disclosure navigation were reviewed. Pre-install and restart helpers
exited with Dev; replacement ACP helpers remained children of Dev. This is a
short lifecycle check, not a performance benchmark.

Installed Dev remains
`/Users/rileycoyote/Applications/Luca Agent Network Dev.app`, with bundle ID
`com.luca.agent-network.dev`, keyring `buzz-desktop-dev.luca-v1`, and preserved
ACP helper from `4689a7a5571c0fb2d1f2b3e1ce92c196e7ba8af7`.
The mixed component receipt is `Contents/Resources/luca-source.json`.
Full rollback bundle:
`/Users/rileycoyote/Applications/Luca Dev Rollbacks/shared-presence-stage2-2026-09-13/Luca Agent Network Dev.app`.
Beta is untouched; no version bump or release build was made.

Limits: delivery proves a write to the runtime bridge, not model consumption or
file reads. Legacy or missing evidence remains unavailable. Receipt retention
follows the existing dispatch row; this adds no permanent archive. The native
acceptance turn confirmed working-context delivery, while continuity delivery
was not recorded for that turn and is labeled accordingly. Sol's existing
saved handoff was inspected with its own revision/date; his Notebook note and
journal lists were empty, and no extra model jobs were generated to populate them.

## Design contract

The core journey is: arrive → choose a resident → work together → inspect what
they made → leave → return. Reading and working remain calm; movement explains
changes of place and real activity. Individuality comes from authored work and
stable identity rather than decorative randomness.

Preserve the approved rail and side cards, 4px card gaps, 8px outer lip,
Instrument Sans chrome, Inter conversation text, theme preferences, runtime
brand marks, Quick Chat phosphor slider, and three-layer activity surface.
Keep keyboard focus visible, text readable, rem-based zoom, and reduced motion.
No new visual framework, universal accent, wallpaper requirement, sound layer,
or replacement animation engine.

Residents participate through their identity, contributions, requests, and
continuity. That does not imply human-equivalent system authority or establish
subjective experience. The owner retains access and permission control. Native
runtimes retain execution, model, and tool ownership. Conversation continues
when continuity is unavailable.

## What already exists

| Area | Verified source foundation | Work still needed |
| --- | --- | --- |
| Navigation | Directional route choreography, stable shell, section transitions | Review seams and interruptions across one full journey |
| Drawers and artifacts | Anchored drawer travel, Canvas seating, focus restoration, reduced motion | Align entry/return behavior where a real mismatch is observed |
| Presence | Identity mark states for present, thinking, working, responding, unavailable, fault | Some surfaces reduce managed state to Ready/Idle; verify and connect existing signals |
| Notebook | Transparent seeded dendrite; sources, authorship, revisions, correction, annotation, archive/forget | Soft edge, composition, remembered location, clearer retention and change presentation |
| Resident documents | Documents/Notebook/Settings workspace; authored documents and conflict-safe writes | Explicit introduction, exploration, and selected-work presentation contract |
| Library/Canvas | Artifacts, immutable versions, provenance, receipts, previews, pinning | Resident-scoped curation and durable return to the selected artifact/version |
| Continuity/context | Scoped context references, availability states, bounded continuity receipts | A readable distinction between available, attached, loaded, and retained |
| Returning | Quick Chat drafts/scroll/geometry, normal drafts, workspace layout | Resident Notebook and artifact location restoration; later, evidence-backed change view |

These are source findings, not a claim of fresh end-to-end acceptance for every
path. Reuse existing acceptance and recheck only affected behavior.

## Stage 1 — polished core journey for beta.6

### B1. Notebook presence and composition

Apply a soft circular alpha fade to this Notebook mark only. Preserve crisp
central pixels, seeded identity, trails, charge buffer, and existing motion
pausing. No hard circular rim, visible disc, blur over the whole mark, or change
to the global dot engine. Confirm that outer growth fades rather than abruptly
cutting off. The mark remains a Notebook signifier, never a capability, memory,
consciousness, or progress meter.

Review one compact composition using actual resident data, bringing the mark
into a closer relationship with the Notebook introduction and reducing the
isolated empty-band effect. Retain the current placement until that composition
is visually accepted. No broader Notebook or onboarding redesign.

Acceptance: light/dark and selected glass theme, normal/narrow/zoom, live motion,
reduced motion, and unavailable Notebook all remain legible and coherent.

### B2. Connected movement

Walk resident selection, conversation opening, side-card toggle, artifact
opening/closing, Quick Chat, and return. Fix observed discontinuities through
existing choreography. Keep shell landmarks stationary, preserve origins where
available, and use a simple local transition when no visible origin exists.
Do not add a whole-page zoom or animate every surface on every navigation.

Use existing timings as the starting point. Input must never wait for an
animation; reversal, rapid selection, navigation during loading, and reduced
motion must complete correctly. Preserve focus scopes and return focus to the
opening control when it still exists. No focus stealing during streaming.

Acceptance: one keyboard/mouse journey plus rapid open/close and navigation
reversal. Stop at a verified seam; do not refactor all existing motion systems.

### B3. Truthful presence and graceful completion

Define one presentation mapping from existing runtime/turn signals before
wiring more UI. Distinguish available, working/responding, waiting for an
advertised permission or user input, completed, cancelled, failed, and unknown
or disconnected. An idle process is not proof of readiness; an unknown state
must not become an invented emotional or work state.

Check the resident drawer's current Ready/Idle projection and unused replying
input first. Scope activity to the relevant resident and conversation. Express
states through existing marks and concise text; retain text for accessibility
and avoid relying on color alone. Avoid permanent pulse loops and duplicate
working indicators.

Let the existing activity record settle above the published reply. A finished
tool is not a finished turn. Concurrent residents finish independently; Stop
remains visible while needed. Cancellation, failed publication, and interruption
keep their distinct outcomes. No confetti, new work shelf, or hidden reasoning.

Acceptance: representative real completion and cancellation; focused fixtures
for failure, unknown state, permission wait, and concurrent residents. Existing
privacy projection and saved record ordering remain intact.

### B4. Keep your place and remove interaction friction

Preserve existing drafts, scroll, and geometry rather than introducing competing
stores. Add bounded local Notebook view restoration: resident section, note/tab,
selected revision where relevant, and scroll anchor. Restore a semantic item
anchor where possible; handle deleted/inaccessible items with a useful fallback.

Personal view state must be scoped to owner/account, community/workspace, stable
resident identity, and relevant conversation/item. It is separate from resident
authored records. Reset active state on account/workspace switch; never recover
another account's draft or private selection. Store references and small view
state, not duplicated message bodies or private documents.

Correct only observed hover/focus, menu alignment, loading jump, or surface-tone
inconsistencies exposed by this journey. Preserve the existing composer design.

Acceptance: navigate away/back and relaunch for changed persistence; verify
draft separation, stale-reference fallback, keyboard access, and narrow layout.

### Stage 1 finish line

One installed Dev candidate demonstrates the complete core journey with real
resident data. The approved Notebook treatment, motion corrections, truthful
states, and retained place work without adding new agent capabilities. Riley
reviews it before the separate beta.6 release process. Stages 2–4 are not beta.6
release dependencies.

## Stage 2 — mutual context and continuity clarity

Make the resident's informational interface understandable to both sides. Reuse
the existing context and continuity surfaces; do not add a competing dashboard.

- Explain available sources separately from material attached to this
  conversation, material confirmed loaded for a turn, and saved Notebook notes.
- Tie loaded claims to exact turn receipts. When a runtime cannot confirm a
  detail, say so. Saving a note does not mean every later turn will retrieve it.
- Let a resident request missing context through ordinary conversation and
  existing attach/approval flows. Do not synthesize resident requests in UI.
- Explain off, locked, unavailable, or failed continuity without blocking chat.
- Preserve source/revision and audience boundaries; receipts disclose only what
  their viewer can access. Never expose credentials or hidden reasoning.

First deliver the readable inspection of existing facts. Add an agent-facing
capability only if the audit proves it is missing and a concrete UX needs it;
use the existing CLI/typed operation and trusted dispatch path.

Acceptance: one attach → send → inspect receipt → inspect saved note journey,
plus unavailable-runtime and private/shared-room boundaries.

## Stage 3 — resident-authored places

Extend the Agent Library's existing resident space with a small curated
introduction, an explicitly authored current exploration, and one selected
artifact. Keep Documents, Notebook, and Settings accessible in that space. Do
not generate a new homepage automatically from private documents or old chats.

Proposed defaults for review before this stage:

- Residents may author or update presentation content through a narrow,
  owner-enabled capability in their own private space. Owner edits retain owner
  attribution. No arbitrary scripts, settings changes, or broader permissions.
- Private by default. Sharing is explicit, destination-specific, and does not
  automatically share the underlying conversation or Notebook sources.
- Selected work pins an immutable artifact version initially. A newer version
  may be offered for selection; it must not silently replace the displayed work.
- “Exploring” is an authored statement with provenance, not a claim that the
  resident is currently running in the background. Stale content can be cleared
  or revised without inventing activity.

Define a versioned presentation record in the existing storage/event model.
Include owner/workspace scope, stable resident key, author, visibility, revision,
and authorized artifact references. Do not use display name or runtime model as
identity. Keep owner reading position out of this authored record. Reuse native
documents only through supported read-only boundaries; do not rewrite native
runtime configuration to supply presentation fields.

Acceptance: resident authors a real change; correct authorship/version is shown;
owner correction and conflict handling work; another resident/account cannot
read or mutate it; unavailable artifacts degrade cleanly.

## Stage 4 — continuity that becomes visible on return

Connect existing saved artifacts, deliberate notes, and conversation links so an
exchange leaves navigable outcomes. Start with explicit selection/pinning and
source links. A decision or open question can use an existing note/document when
sufficient; do not introduce a new record kind merely to give it a new label.

Restore resident, conversation, artifact/version, and Notebook location through
a scoped, versioned location contract built from existing stores. Never resume a
task, grant permission, reopen a browser, or rerun a tool merely because someone
returns to the page.

Offer a quiet, dismissible “Since your last visit” view of actual new artifact
versions, accessible Notebook revisions, and authored updates. Compute it from
durable records and an owner-scoped acknowledged cursor with a stable tiebreaker.
Define first visit, acknowledgement, duplicate events, deletion, and revoked
access explicitly. Only include records authorized in the current context.

No automatic model summaries, fabricated greetings, inferred emotional state,
or private archive mining. Resident reflections are resident-authored; application
change summaries are labeled as such. Keep sourced change counts separate from
the dendrite's decorative growth.

Acceptance: create real changes → leave → reopen/relaunch → inspect changes →
acknowledge → return without duplicates. Include same-timestamp revisions,
account/workspace switching, forgotten notes, and missing artifact versions.

## Performance and accessibility throughout

- Reuse shared animation scheduling and visibility pauses. No per-frame React
  updates, extra resident polling, model calls on navigation, or new helper
  processes for visual effects. Prefer bounded transforms/opacity and simple
  masks; measure any mask or backdrop cost in native WebKit.
- Capture a brief baseline on the same machine without builds, DevTools, or
  intrusive probes running. Compare representative interactions and idle state;
  report observed regressions rather than inventing an “award-winning” metric.
- Prior CPU spikes were attributed to Brain validation and encrypted outbox
  work in sampled stacks; sustained idle behavior was not established. Profile
  only if reproduced. Do not weaken encryption/durability to improve a number.
- Confirm foreground animation, paused hidden state, keyboard/VoiceOver labels,
  rem zoom, readable contrast, and non-color state distinctions.
- Test changed behavior, not every old acceptance suite. Reuse existing browser
  isolation and lifecycle evidence unless relevant code or a failure invalidates
  it. One short process check at integrated acceptance is sufficient.

## Delegation, review, and delivery

Integrator owns design decisions, actual screenshots, shared interfaces,
cross-surface review, integration, and installation. Sol/Terra receive bounded
execution briefs and may not independently redesign, merge feature branches, or
build native apps. Maximum two workers alongside the integrator.

Before each dispatch, freeze exact write paths and contracts. Suggested lanes:
Sol handles presentation in explicitly assigned components; Terra handles
explicitly assigned state projection/persistence/API modules. Shared theme,
motion, shell, and routing files stay integrator-owned unless assigned as one
exclusive batch. Shared components may need sequential work; never overlap edits.

At implementation start, reverify source/receipt and create an isolated `codex/`
integration branch on the internal drive. Make small reviewable commits per
completed slice. Use current renderable app data for visual review. Reuse caches,
run scoped formatting, typecheck and targeted tests, then one integrated Dev
build per agreed delivery stage after source checks pass. Preserve rollback,
Dev identity/data/keyring separation, and a component-accurate source receipt.

Each stage ends with rendered before/after evidence, concise acceptance results,
actual limitations, and Riley's visual review. No beta app replacement or release
publishing is authorized by this experience roadmap.

## Source map for implementation briefs

- Notebook: `desktop/src/features/profile/ui/notebook/`;
  `desktop/src/shared/ui/dot-display/`;
  `desktop/src/shared/api/tauriNotebook.ts`.
- Resident workspace/documents: `desktop/src/features/agents/ui/AgentLibraryWorkspace.tsx`;
  `desktop/src/shared/api/tauriResidentDocuments.ts`.
- Presence: `desktop/src/features/channels/ui/ResidentDrawer.tsx`;
  `desktop/src/shared/ui/AgentIdentitySpecimen.tsx`.
- Motion: `desktop/src/shared/ui/NavigationTransition.tsx`;
  `desktop/src/app/navigationChoreography.ts`;
  `desktop/src/app/navigationViewTransitions.ts`;
  `desktop/src/shared/styles/globals/navigation-transitions.css` and `motion.css`.
- Conversation: `desktop/src/features/messages/ui/ResidentActivityTrace.tsx`;
  `desktop/src/features/conversation-workspace/ConversationWorkspaceContext.tsx`.
- Quick Chat: `desktop/src/features/quickchat/`.
- Context: `desktop/src/shared/api/tauriContinuity.ts`;
  `desktop/src-tauri/src/luca/conversation_context.rs`.
- Artifacts: `desktop/src-tauri/src/commands/artifacts.rs`;
  `desktop/src/features/artifacts/ArtifactCanvasProvider.tsx`;
  `desktop/src/features/artifacts/ui/artifact-canvas.css`.

## Decisions

Confirmed: the overall experience direction; soft circular Notebook fade; staged
delivery with the core journey for beta.6; integrator as design/visual owner and
bounded delegated implementation; existing runtime ownership and privacy rules.

Review during Stage 1: the single proposed Notebook composition and actual
transition/state specimens. No need to decide future storage schema now.

Review before Stage 3: resident authoring permission/default, introduction and
exploration visibility, and pinned-version behavior. The proposals above permit
planning; they are not permission to expand an agent's authority today.

Review before Stage 4: which durable changes deserve inclusion and when a visit
is acknowledged. Final implementation contracts are frozen at each stage using
the then-current source, so the roadmap does not become a stale parallel spec.
