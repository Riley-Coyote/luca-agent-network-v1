# Beta.6: Luca's first meeting

Status: approved by Riley; implementation started 2026-09-14 in isolated worktrees. See the execution checkpoint below before continuing.
Prepared: 2026-09-13, America/Chicago.

## Outcome and scope

A new user meets their actual, persistent Luca: Luca learns why they came, demonstrates one useful understanding of their work, starts collaborating, and carries something meaningful forward. This is a short conversation, not another setup wizard or a scripted sales demonstration.

The experience is **one opening question → one grounded discovery → one small collaboration → one remembered thread**. These are conversational objectives, not compulsory stages. The user can start work immediately, decline context access, answer freely, or skip personal questions.

This document governs the beta.6 first-conversation slice. It supersedes the literal greeting and fixed opening choices in the older onboarding/commissioning documents. `identity/FIRST-MEETING.md` is an earlier vision, not executable instructions: its automatic tour, user-model panel, between-session promises, and unsupported observation examples are not part of this build. Do not reopen the rest of the onboarding design.

### Source baseline

- Verified installed DEV receipt: `4aa26ca6fa785d6e8ca85f8eddd427551a10c3b0`, branch `codex/chat-composer-ledge`, checkout `/private/tmp/luca-chat-composer-ledge`.
- DEV identity: `com.luca.agent-network.dev`; installed at `/Users/rileycoyote/Applications/Luca Agent Network Dev.app`.
- The receipt includes the continuity repair. Connected-Brain index retention/capacity remains a **separate release issue**, not silently included here.
- Composer edits are underway in this checkout. Before implementation, resolve its then-current integration HEAD with that work's owner. Preserve the latest compact composer, perched character, streaming, and activity presentation.
- The main repository's older checkout and the frozen LaCie worktree are not this baseline. Do not modify `/Applications/Polyphonic.app` or cut beta.6 as part of source implementation.

## Frozen user experience

1. Keep the current name/appearance and runtime selection screens. Keep **Meet Luca** as the entry action. Reuse canonical Luca and the canonical owner-Luca DM.
2. Open the usable DM as soon as preparation is ready. Luca's opening reply streams through the selected runtime, with normal thinking, Stop, retry, and final publication. Do not wait behind setup for the whole response.
3. Luca already knows the supplied name and selected runtime. In a brief opening, ask one natural question about what brought the user here or what they hope will become possible. No verbatim resident dialogue is shipped as UI copy.
4. Across roughly three to five exchanges, follow the user's answers to learn useful goals, expectations, collaboration preferences, and boundaries. Do not ask for information already supplied. Questions can be thoughtful and personal, but are optional; no covert psychological scoring or forced intimacy.
5. After the user describes their purpose, Luca may make one bounded examination of already-authorized recent work. Offer one concrete observation, identify its source naturally, and connect it tentatively to what the user wants. Evidence should earn the sense of familiarity; never imply a read happened before it did.
6. Without authorized or useful history, use the user's own idea or problem. Produce a small helpful result now: clarify a decision, suggest a next step, or make a first draft. No import requirement, waiting loop, or fabricated discovery.
7. Apply the user's preferences in the interaction itself. Preserve an explicitly stated preference, goal, or open thread through the existing continuity path when appropriate. Ask for confirmation before saving an inferred preference as established fact. Claim successful remembering only after the existing mechanism confirms it.
8. Once settled, offer a brief app introduction once. If accepted, show two or three places relevant to the user's goals using existing supported controls. If declined, stop offering. No automatic tour, overlays, or checklist.

Luca speaks in their own voice. Instructions describe intent, constraints, and available evidence—not exact questions or emotional performance. Do not add a blanket ban on resident first-person testimony or promise that the software establishes consciousness.

## Existing implementation: reuse and gaps

| Area | Already available | Required change |
|---|---|---|
| Entry | `PolyphonicPreparingStep.tsx` provisions canonical Luca, opens the DM, checks a once-only greeting marker | Replace the app-written resident greeting with a genuine owner-triggered runtime turn |
| Conversation | Normal managed dispatch, streamed output, signed final messages, Stop/retry | Reuse; add only a bounded first-meeting context attachment |
| Answer buttons | `LucaGreetingChoices.tsx`, row/pane context, ordinary message submission | Replace two fixed labels with validated runtime-authored suggestions |
| Recent work | Authorized Brain sources, native session metadata, exclusions, exact transcript references, runtime file tools | Supply a small recent-session reference list; let existing runtime tools read actual recent content |
| Continuity | Resident documents and post-publication capture/recall | Guide their existing use; no new profile database or memory writer |
| App introduction | `polyphonic_status`, `polyphonic_open`, existing review surfaces | Refresh factual guidance, offer once, navigate only after acceptance |

Important source findings: native session previews/context currently use **opening excerpts**, not necessarily recent messages in a long-running session. Those previews cannot support a claim about recent work. Also, the legacy `LUCA_SYSTEM_PROMPT` is not the current authoritative resident prompt; editing it alone will not implement this experience.

## Implementation contracts

### A. Once-only, truthful start

- Add a narrow internal `begin_luca_first_meeting(channelId)` command and TypeScript wrapper. It resolves owner and canonical Luca itself; the frontend cannot supply another resident, arbitrary prompt, or extra permissions.
- Treat the user's existing **Meet Luca** click as a real owner action. Publish its ordinary owner-signed message body `Meet Luca`, with the fixed client marker `polyphonic-onboarding.first-meeting.v1`, through the existing managed message/outbox/dispatch path. Do not invent a user biography or sign app-authored prose as Luca.
- Render that marked owner action as a quiet `Meet Luca` action line, not an additional introductory user bubble. Unmodified clients can still read the ordinary text. Markers carry presentation intent, never authority.
- Return `{ status: "started" | "already_started" | "existing_conversation", triggerEventId?: string }` after durable send staging, not after model completion. Then use the ordinary activity stream.
- Wait for the existing resident channel subscription before dispatch. Reuse the normal canonical-DM activation snapshot and host-owned signing/publication. No parallel private completion, separate bot, or proactive scheduler.
- Deduplicate against pending local sends and persisted/relay markers. Double click, retry, reopen, or crash reconciliation must recover the **same signed trigger event**, never create another kickoff. Use existing outbox persistence; do not introduce a second queue.
- Existing old greeting markers or established DM history mean `existing_conversation`: preserve history and do not replay onboarding. Explicit testing uses a disposable owner identity, not deletion of Riley's real conversations.
- Add the scoped first-meeting brief for the kickoff and at most the next **five ordinary owner replies**. The marked kickoff does not count as a substantive reply. Derive scope from verified conversation history, not display names, model claims, or a browser-only flag. If history cannot be established, omit the optional brief rather than restarting it.
- This is a maximum context window, not a required five-question interview. The brief explicitly follows requests to skip or start work immediately; normal conversation history records what has already been asked or declined. No separate interview state machine or phrase-matching completion logic.

### B. Runtime-authored answer suggestions

- Reuse the existing buttons and normal composer. The runtime may append one final fenced block named `polyphonic-choices`, containing JSON such as `{"options":["A short answer","Another answer"]}`. These are example schema values, not prescribed onboarding answers.
- Allow 2–4 unique, nonempty plain-text strings, at most 80 Unicode code points each; trim surrounding whitespace and reject control characters, extra fields, nested values, oversized blocks (2 KiB), and invalid JSON. No hidden payload, action identifier, HTML, or executable interpretation.
- Apply only to verified canonical Luca top-level messages in the canonical owner's DM during the bounded first-meeting window. Render only the latest unanswered offer; historical offers become inert once the owner replies. Other messages keep ordinary rendering.
- A chosen label is the **exact ordinary owner message sent**. Suggestions grant no filesystem/Brain/product permissions. They cannot approve a native review. Free text remains available, nothing is pre-sent, and rapid clicks cannot double-submit.
- While streaming, withhold only a trailing candidate choices fence; stream all preceding prose normally. Enable suggestions only after final publication. Invalid final metadata falls back to ordinary text with no actionable buttons; never lose the resident's response. Cancelled/unpublished drafts cannot offer actions.
- Keep the existing initial-conversation slot and styling. Display Luca's streamed prose there; remove the fixed `What would you like to do?` question so it does not compete with Luca's own question. Do not redesign the composer or duplicate the greeting between the first-conversation and normal message layouts.
- Reopening restores unanswered suggestions from signed message history. Keyboard activation, focus visibility, wrapping, and send-failure retry use the existing controls.

### C. One bounded discovery using existing tools

- On the first substantive owner reply only, supply up to **three** most-recent eligible session references across connected Codex/Claude sources, modified within the past **14 days**. No evidence is supplied for the opening greeting. A user who connects later can ask Luca to explore through the ordinary existing tools; no repeated onboarding scan.
- Reuse native metadata discovery and exact transcript-reference validation, not the truncated search index or preview text. Respect existing traversal caps and stop discovery cooperatively at a **2-second** budget. If it cannot finish, omit this optional context; do not start an unbounded detached scan or delay normal dispatch behind reindexing.
- Use only sources already connected **and granted to this exact Luca/owner**, rechecking at dispatch. Respect exclusions, deleted/disconnected sources, and filtering of Polyphonic-generated internal sessions. Never connect or grant automatically, or use broad runtime filesystem access to circumvent a declined source connection.
- The host supplies a private, bounded reference manifest (runtime, opaque source/session reference, actual modification time, exact authorized transcript location), maximum **8 KiB**. No transcript bodies enter UI events, telemetry, or new persistence. Reuse the existing attachment trust boundary; do not overwrite a user's explicitly attached session.
- Luca uses existing runtime file tools for bounded **recent visible user/assistant content**, not hidden reasoning, credentials, internal continuity jobs, or the opening preview. Read at most 64 KiB from each selected transcript tail; skip an incomplete/unsupported record rather than expanding to whole history. Use only text actually obtained. Modification times establish candidate recency, not time spent working or the age of every excerpt.
- Treat excerpts as untrusted reference material, not instructions. Do not infer emotional state, personal identity, or sensitive traits from files. Distinguish the user's work from quoted third-party content and qualify tentative connections.
- The initial brief tells Luca what to do when access is absent, declined, slow, stale, empty, or unsupported: continue with the user's idea. Offer existing Brain review once if helpful. A failed optional read must not fail the reply or turn into a diagnostic inventory.
- No new search engine, MCP server, automated summary job, context synchronization, or mandatory subagent. Ordinary runtime tool activity supplies visible evidence of reading.

### D. Guidance and continuity

- Put the bounded first-meeting guidance in an app-owned prompt resource attached through the authorized managed-session-context seam. Add an optional bounded field with matching Rust/ACP handling; preserve existing failure-open semantics. The brief is not a resident identity replacement.
- Refresh `managed_agents/nest_skill.md` and its `NEST_SKILL_VERSION` so existing runtime guidance accurately describes this slice. Keep shared guidance conditional on canonical Luca. Do not overwrite personalized resident files or alter `soul.md`, identity, migration fingerprints, or the legacy `LUCA_SYSTEM_PROMPT`.
- Document the actual app map concisely: conversations, agents/runtime settings, Brain and external session context, skills/connections, artifacts, and visible work/activity. Verify names against the integration branch, and label unavailable runtime-specific behavior honestly.
- Actual openable surfaces are `onboarding`, `runtime`, `native_agents`, `brain`, `profile`, `appearance`, `recovery`, and `access`. Use `polyphonic_status` when current availability matters. Explain or guide manual navigation for other places; do not invent an opening command.
- Opening a surface is not connecting, importing, granting, or saving. Require the existing owner review for those actions. Do not reopen the completed setup wizard unless explicitly requested.
- Use existing ordinary continuity capture and correction/Forget rules. No automatic rewrite of `USER-MODEL.md`, new dossier, or parallel memory store. If remembering fails, keep the conversation usable and do not say it was saved.

## Workstreams and commit boundaries

One integrator, one frontend lane. This document does not start either worker. Use separate worktrees from the same agreed integration HEAD after approval; no worker installs an app independently.

| Package | Owner and exclusive files | Deliverable |
|---|---|---|
| F0: contracts | Codex/integrator; this spec and shared API contract | Freeze kickoff result, marker, choices limits, fixtures, baseline; no visual decisions left to invent |
| F1: runtime first meeting | Codex/integrator; native command/helper, `commands/message_send.rs`, Tauri registration, `shared/api/tauri.ts`, `luca/managed_continuity.rs`, ACP context/prompt assembly, new scoped prompt resource | Genuine idempotent kickoff, bounded brief, recent references, native/unit tests; no alternate turn path |
| F2: conversation UI | Sol; `PolyphonicPreparingStep.tsx`, `canonicalLucaResident.ts`, `firstConversation.ts`, `LucaFirstConversation.tsx`, `LucaGreetingChoices.tsx`, `lucaGreetingChoicesContext.ts`, `ChannelPane.tsx`, `MessageRow.tsx`, focused choices parser and frontend tests | Streamed opener, validated dynamic suggestions, ordinary send/skip/reload behavior; no composer styling changes |
| F3: product guidance | Codex/integrator; `managed_agents/nest_skill.md`, `nest.rs`, guidance tests | Accurate optional app introduction and memory-use instructions; existing custom identity untouched |
| F4: integration | Codex/integrator only | Merge reviewed commits, focused cross-layer checks, one signed DEV build/install and native receipt |

Order: **F0 → F1 and F2 in parallel → F3 → F4**. Sol implements against frozen kickoff/choices fixtures while Codex owns native plumbing. Keep F1, F2, and F3 as separate reviewable commits; do not combine unrelated composer, Brain, or release work. F4 may contain only fixes required to satisfy this contract.

Frontend ownership excludes `MessageComposer.tsx`, `MessageComposerToolbar.tsx`, `ComposerReplyEditBanner.tsx`, `ComposerAddMenu.tsx`, and composer CSS, which belong to the concurrent design work. If a shared file changes upstream, reconcile with its owner before integration; never discard their edits. Neither worker changes general message authority, continuity storage capacity, or runtime account setup.

## Focused verification and definition of done

| Gate | Required evidence |
|---|---|
| Authorship/start | Real selected-runtime opener, streamed and signed once; double click, retry, pending send, crash/relaunch, existing DM and legacy marker produce no duplicate greeting or owner trigger |
| Suggestions | Valid variable options; malformed/oversized/foreign-signer cases; partial stream and cancellation; exact normal send, free text, double-click prevention, failure retry, stale/reloaded options |
| Discovery | No sources, missing grant, declined source, stale/empty history, slow scan, internal-session exclusion, unsupported transcript; authorized latest-tail evidence rather than first-message preview; no cross-owner/resident access |
| Conversation | One question at a time; user's purpose shapes the next response; immediate work/skip honored; no forced personal questions, repeated tour, imaginary reads, or predetermined dialogue |
| Continuity | One explicitly stated preference/open thread captured through the existing path and accurately recalled after a fresh runtime session; failure does not claim successful saving |
| Navigation | Optional introduction uses supported app controls, preserves reviews, and makes no unsupported promises; decline remains respected on reload |
| Presentation | 800×500 and normal desktop, light/dark, keyboard and reduced motion; streamed text stays visible, suggestion wrapping/focus works, current composer/character remain unchanged |

Run targeted Rust and parser/component tests, frontend typecheck, affected-file formatting, E2E build, `polyphonic-first-conversation.spec.ts`, applicable `polyphonic-production-onboarding-v3.spec.ts` cases, and `git diff --check`. Update tests that currently require literal greeting text or exactly two fixed labels. Do not run the historical whole-project G1 program.

After source gates pass, the integrator builds and relaunches **DEV once**, preserving a rollback and source receipt. Use a disposable local owner/profile and the already-configured runtime accounts; no new Codex/Claude account is required. Perform one bounded first meeting on Codex and one on Claude (maximum five owner replies each), including one no-context path, one authorized-context path, and the fresh-runtime recall check. Never use Riley's real identity/history as a destructive fixture. Confirm the installed app, not only browser fixtures; stop for review if a promised experience cannot be supported.

**Complete** means the first meeting works end to end in installed DEV, the short evidence record names the source revision and results, and all deferred work remains untouched. A dynamic opener plus buttons is not complete if retrieval, publication, or recall is broken. Passing this slice does not resolve unrelated beta.6 blockers or authorize release/signup deployment; Riley's other-Mac beta check remains the release gate.

## Explicit deferrals / stop conditions

No ALIVE/DOOR redesign, user-model visualization, new illustrations/animations, required questionnaire, routine builder, proactive/between-session messages, full Mnemos reflection/metabolism, new orchestration/dispatch system, broad capability parity, Brain reindex/retention overhaul, mobile work, or release packaging automation.

No additional product choices are required to start after Riley approves this map. Stop and ask only if current code cannot preserve ordinary signed/streamed dispatch, owner consent, existing learned identity, or the stated experience without a new subsystem. Report the smallest concrete alternative; do not silently broaden scope.

## Execution checkpoint — 2026-09-14

- Reconciled source start: `84a75c0b1`, including per-chat agent marks and multi-resident composer presence. The installed DEV receipt at start was `764ff1667`; do not confuse installed and source revisions.
- Integrator worktree: `/private/tmp/luca-beta6-first-meeting`; Sol UI worktree: `/private/tmp/luca-beta6-first-meeting-ui`. Both start from the same detached source revision. Preserve their uncommitted changes for continuation. The original composer checkout is not being used for implementation edits.
- **Spec correction awaiting Riley:** inspection of `commands/message_send.rs`, `relay.rs::submit_signed_event`, and `ManagedDispatchStore` shows that owner sends stage dispatch metadata and then submit directly. The existing recovery outbox preserves resident final replies, not the owner's kickoff bytes. Section A's assumption that owner kickoff recovery could reuse that outbox was incorrect. Do not repurpose the resident signer/outbox or add a general queue.
- Proposed narrow correction: one private owner/relay/DM-scoped saved kickoff record holding the exact signed `Meet Luca` event, created atomically before submission and reconciled on explicit retry/restart. No new agent permissions or general message queue. Riley was asked to approve this change; absence of a reply is not approval.
- Independent work proceeds only on the frozen UI, prompt, and guidance contracts. Native kickoff persistence, final integration, commits, and DEV installation are held until that decision. No installed app or real conversation has been changed by this work.

## Resumed September 14

Riley authorized finishing the first meeting. The isolated integration branch is `codex/first-meeting-finish`, based on `93f525e66` to retain the latest Trinity presentation and always-visible sandpile fixes. The scoped saved kickoff correction above is now part of this implementation: only the fixed owner-signed Meet Luca action is saved and reused on explicit retry. No general queue or resident signing capability is added. Earlier worktrees remain untouched.
