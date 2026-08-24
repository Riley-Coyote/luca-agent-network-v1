# Core chat audit — the 1:1 experience, measured against the frontier

*Opened 2026-08-24. Mandate from Riley: forget agent-to-agent UI; the bar is a
complete, frontier-grade human↔agent chat experience — "not sophisticated,
complete." This doc is the working inventory: what exists, what's missing,
what's architecturally blocked. The measuring stick (the exhaustive checklist
of what every shipped chat app does) is being compiled in parallel and gets
crossed against this.*

## Findings so far (code recon, pass 1)

**F1 · THE ACTIVITY CEILING — the headline.** The presentation protocol
(`crates/luca-protocol/src/managed_presentation.rs`) carries exactly four
coarse phases — Thinking / Working / Writing / Finalizing — and deliberately
excludes tool payloads ("never prompts, thoughts, tool payloads, secrets").
That was a considered privacy decision from the autonomy-posture era.
Consequence: ChatGPT-style rich activity lines ("Reading example.com" +
favicon, per-step one-liners) are impossible with today's data, for every
runtime. Achieving them requires a protocol extension — an optional
public-safe activity descriptor (label + optional URL/domain), designed
deliberately against the same privacy posture that excluded payloads.
This is a DECISION for Riley, not a task: dose of disclosure vs. the
"never payloads" rule.

**F2 · Phases do reach the UI.** managedPresentationStore (+ scheduler at
40ms paint interval, grapheme-aware chunking) → MessageRow renders a quiet
word beside the name ("thinking", …) and ManagedResponseRow exists;
managedPresentationActivityStore keeps a per-conversation activity map with
4s terminal linger. So the streaming/thinking pipeline is genuinely wired;
the audit question is the QUALITY of each transition (thinking→streaming
handoff, terminal collapse), not existence.

**F3 · Motion foundation solid, incomplete.** motion.css has the right
shape (instant/fast/standard/arrival, two easings, blur-arrival, reduced
motion) but: no exit easing, no tap duration (choreographer specced both),
`motion-enter-conversation` wired ONLY to the welcome kickoff — own sent
messages and arriving replies get no motion at all.

**F4 · The logo fill-sweep is feasible, cleanly.** HarnessLogo draws via
CSS mask filled with currentColor; animations.css already contains
text-fill and mask-sweep techniques from the glyph era. Driving an animated
fill inside the logo mask for thinking/working states is straightforward —
branded mark and living state, no compromise.

**F5 · Known regressions already on the board** (from the choreographer's
review): send spinner + accent SENDING label (to delete), no border-color
transition on composer focus, no arrival motion on own rows.

## Still to audit (hands-on)
- Live-app session driving a real agent: actual thinking→stream→final
  choreography, interruption/stop, failure states, follow-up-while-streaming.
- Message anatomy prototypes: user-vs-agent differentiation (both schools),
  timestamps-to-hover, grouping rules.
- Scroll behavior end to end (pin, break-pin, jump-to-latest, growth).
- Empty/edge states inventory.
- Cross against the frontier checklist when it lands.

## Hotspot pass 1 — lab-testable items (2026-08-24, late)

Run live against the built shell (mock bridge). Checklist IDs from
`frontier-checklist.md`:

- ✅ S1.11/H10 — focus stays in the composer after send; next keystroke types
- ✅ S1.13/H1 — optimistic message renders exactly once (no echo duplication)
- ✅ S1.4 — send control disabled on empty composer
- ✅ S1.7 — held/repeated Enter sends exactly once
- ✅ S1.25/S1.27/H4 — draft survives a conversation switch and does not leak
  into the other conversation
- ✅ S1.9 (observed) — composer clears immediately on send

**Early read: the messaging PLUMBING inherited from Buzz is healthier than
feared** — the classic fork failures (dup sends, draft loss, focus loss) all
pass. The losses are concentrated in the EXPERIENCE layers: motion (F3),
activity display (F1 ceiling), streaming choreography, message anatomy.

**Scene bug found by the audit itself:** the group-conversation conversion
renamed the rooms (field-notes → "Vektor", polyphonic → "ziggy, Luca") — the
room-naming task is confirmed real and affects the scene AND the product.

## Next: the live session

Streaming/awaiting/interruption items (S2.*, S3.*, S8.*) and real activity
choreography can only be judged against a running agent — needs the relay up,
the Dev app rebuilt (or lab against a live harness), and a real multi-step
task driven end to end. That session produces the rest of the gap inventory.
