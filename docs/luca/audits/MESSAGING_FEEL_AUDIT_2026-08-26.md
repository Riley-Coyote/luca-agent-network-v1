# Messaging Feel Audit — why it doesn't feel like ChatGPT/Claude

2026-08-26, Fable. Method: instrumented live runs in the e2e harness
(timestamped DOM observation of a real send → reply sequence) plus a full
code recon of the motion/feedback layer. Measurements are from the mock
harness; absolute latencies vary in the real app, but every mechanism
cited is real-app code. Branch: `codex/polyphonic-glass-shell-integration`
(same messaging code as the installed build).

The one-sentence diagnosis: **the pipeline is engineered well (batching,
memoization, reconciliation) but the FEEDBACK layer is missing its
moments — send is delayed and silent, replies pop in unanimated, the
first seconds of thinking show almost nothing, and failures erase
themselves.** World-class chat apps win on exactly these moments.

---

## The punch list, ranked by feel impact

### P1 — Your own message takes ~1 second to appear after Enter (BLOCKING)
Measured in-harness: Enter at t=2978ms → own row in the DOM at t=4050ms
(**1072ms**). ChatGPT/Claude: <50ms.
Cause: the composer is NOT cleared synchronously. `completeSend`
(`useMentionSendFlow.ts:419`) awaits `onPrepareSendChannel` (`:458`) and
`ensureManagedAgentMentionsReady` (`:467`) — which can hit
`managedAgentsQuery.refetch()` (`:201-205`) — before `clearComposer`
(`:505`) and before the optimistic insert (`hooks.ts:685-741`). The
comment at `:501-503` claims the clear precedes "the async network send";
it does not precede the readiness awaits. (The EDIT path clears
synchronously — `MessageComposer.tsx:669-677` — proving the pattern.)
**Fix direction:** clear the composer and insert the optimistic row
immediately on submit; run channel-prep/readiness after (restore content
on failure — the restore machinery already exists,
`useMentionSendFlow.ts:539-549`). Alternatively pre-warm readiness on
typing-start. Single highest win in the product.

### P2 — Agent replies appear with ZERO animation
A finished, beautiful arrival animation exists —
`motion-enter-conversation` (`motion.css:31-48`: 500ms, blur 2px→0,
translateY 0.75rem→0, `--motion-ease-arrival`) — but its only producer is
the onboarding welcome (`useWelcomeKickoffEntrance.ts:23-42`). Ordinary
replies mount with nothing (`MessageRow.tsx:1022-1035`: `playEntrance`
false, `motion-land-own` is own-side only). The design intent is even
written down (`message-anatomy.css:283-291`: "A resident's turn
ARRIVES... Your own message LANDS") — the arriving half was never wired.
**Fix:** wire the arrival (or a lighter 200–300ms variant) to every
non-own message mount that is genuinely fresh. Cheap; transformative.

### P3 — The first ~3 seconds after sending are near-silent
The activity shelf's `indicator` tier (< 3s,
`conversationAgentActivityShelf.ts:229-242`) renders an EMPTY label —
name + a slow 1.8s pulse only (`ConversationAgentActivityStrip.tsx:184-185`).
The first phase word appears at 3s, elapsed clock at 10s. The most
anxious window (did it hear me?) has the least feedback. ChatGPT shows an
immediate animated signal at t=0.
**Fix:** show "Thinking…" (or the phase word) immediately; drop
`ACTIVITY_PHASE_WORD_AFTER_MS` from 3000 to ~300; consider a livelier
indicator in the first tier (typing-dot rhythm or shimmer instead of the
0.42↔0.86 pulse). Also: without a seeded `audience` the shelf waits for
the first wire frame (`hooks.ts:711-716`) — seed a `waking` presentation
on every managed send so t=0 feedback is unconditional.

### P4 — Failed sends erase themselves (P0 family)
On error the optimistic row is rolled back (`hooks.ts:744-772`), content
returns to the composer, and the only signal is a transient toast. No
failed row, no inline retry on the message.
**Fix:** keep the row, mark it failed (the unused `pending` plumbing
shows the pattern), inline "Retry" on it. This also answers the 08-24
audit's self-erasing-failure P0 for the send path.

### P5 — There is no "sending" state at all
`pending: true` is set (`hooks.ts:157`) and rendered by nothing; the
optimistic→confirmed swap is deliberately invisible
(`localKey` reuse, `hooks.ts:792`). Invisible-when-instant is fine —
after P1 lands, add a whisper of pending (e.g. plate at 0.85 opacity
until ack) as honesty insurance on slow relays.

### P6 — Completion has no moment
The shelf flips to a grey "Done" with no exit choreography
(`conversationAgentActivityShelf.ts:140-143`, settled styling
`activity-states.css:227-241`); the stream-final reconcile flash fires
only on divergence (`managedResponseRow.css:1-14`).
**Fix:** a small settle — the shelf item's pulse resolving into a still
dot, or a 140ms exhale on the finished message. Subtle, not confetti.

### P7 — Streaming re-renders the whole bubble every tick (engineering)
Cadence is good (40ms scheduler, grapheme typewriter 50–175/s,
`managedPresentationScheduler.ts`), but each paint replaces the full
`body` string through `MessageRow` (`ManagedResponseRow.tsx:44-69`) —
the exact pattern the tree has repeatedly had to defend memos against
(`messageRowEquality.ts:13-17`, `MessageRow.tsx:1159`,
`useChannelPaneHandlers.ts:97-99`). Consider an append-shaped tail node
for the streaming region. Not user-visible while the memos hold; a
standing fragility.

### P8 — Small
- Scroll-to-bottom is always an instant jump (`behavior:"auto"`
  throughout `useAnchoredScroll.ts`); consider a short eased settle on
  own-send only.
- Conversation switch is a 90ms fade from 97% opacity
  (`NavigationTransition.tsx:11-14`) — effectively a hard cut; possibly
  intentional minimalism, worth one taste pass.
- The lifecycle runs on hardcoded 120/140/160ms literals while the motion
  token system sits mostly unused by it (`motion.css:8-28` vs
  `conversationAgentActivityShelf.css`) — hygiene.
- Typing indicator: emitting a mock typing event produced no visible UI
  in a DM during the run — verify whether human-typing indicators are
  intended surface at all.

## What is already good (don't break it)
Elapsed-time readout exists past 10s with a tabular-nums clock that never
slides; tiered disclosure is a sound idea (the tiers are just too slow);
failure states on the shelf persist deliberately with retry + dismiss;
the streaming scheduler is genuinely well built; own-message "land"
(160ms rise) exists and reads correctly; reduced-motion is handled
almost everywhere.

## Suggested order
P1 → P2 → P3 (one coherent "the send feels alive" change set, each
independently verifiable in the harness with the timestamp instrument
used for this audit) → P4 → P6 → P5 → P8 taste passes → P7 as an
engineering follow-up.
