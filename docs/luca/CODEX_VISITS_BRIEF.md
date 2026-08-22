# Visits brief — the mentioned resident answers in place

*Written 2026-08-20 by Claude at Riley's direction. Read ALL of this before touching anything.
Authority order: this brief → `docs/luca/AUTONOMY_POSTURE.md` (including "The house rule") →
`docs/luca/CONVERSATION_MODEL.md` → everything else. `docs/luca/CODEX_CLEANUP_BRIEF.md`'s
"do not restore" preamble remains fully in force — reread it first.*

---

## What this feature is, in one breath

When anyone in a conversation — the owner or a resident — writes `@Name` for a same-owner resident
who is **not in that room**, that resident **visits**: they are added to the room from that moment,
answer right there, and quietly leave when the conversation moves on. **Nothing forks. No room is
created. No card, prompt, or approval appears.** This is conversation-model rule 3 exactly as
written, and it was re-confirmed by Riley on 2026-08-20 in these words: effortless, natural, no
ceremonial event, and **nothing anywhere may special-case "two agents"** — the same mechanism must
hold for 3 or 8.

## Decisions already made — do not reopen any of them

1. **The pair-DM redirect is dead.** A branch `agent/pair-dm-placement` exists that implements
   "asking an absent sibling opens their DM and redirects the reply there." Riley rejected that
   design after it was built. Commits `4c52c3aa`, `a26f1cac`, `f20998e7` and every uncommitted
   change on that branch implement the rejected design: **do not merge, cherry-pick, or imitate
   them.** Leave the branch untouched as reference.
2. **Three commits on that same branch are approved salvage** (design-independent, solve a real
   pre-existing bug — exchange notes never published because kind 40099 has no client-write scope):
   - `a659b066` — new relay command kind `KIND_LUCA_EXCHANGE_NOTE = 41013`: the owner submits it,
     the relay validates and publishes the note as its own relay-signed system message.
   - `32b22182` — the desktop's note publisher rides that command kind.
   - `899c2674` — the note renders with a clickable room reference + spec coverage.
   Cherry-pick exactly these three (in that order) as your step 1; resolve conflicts toward their
   intent. This also resolves the `NOTE(claude)` left in `exchange_relay.rs` by the cleanup task —
   remove that comment when the cherry-picks land.
3. **A visit is a membership row, not a permission system.** Per the house rule: no interior gates,
   no approval, no capability types, no new protocol contracts. If any step seems to need one, STOP
   and leave a `NOTE(claude):` describing what you wanted.
4. **The exchange machinery is reused unchanged.** Budgets, the strip, Stop/Go, turn tags, the
   relay's turn rules — none of it changes. The only new relay behavior is the note kind from the
   salvage; there is no read-filter work in this brief (see B).
5. The contract (`crates/luca-protocol/src/exchange.rs`), `luca_managed_prompt.md`'s house rules,
   and all `TODO(ship)` wording stay frozen.

## Branch setup (step 0) — corrected 2026-08-21, read this even if you read the brief before

The two branches have **diverged** since this was first written (merge base `c94295d2`):
`agent/exchange-object` has eleven commits the cleanup branch does not, including the whole visit
UI; `codex/cleanup-after-exchange` has four the other does not. The original instruction — branch
off the cleanup branch — would silently drop the UI this brief depends on, so:

```
git switch agent/exchange-object          # has the visit UI; pushed, df89297c or later
git switch -c codex/visits
git merge codex/cleanup-after-exchange    # brings the machinery deletion + CI fixes
```

Then the three cherry-picks (decision 2). **Those three commits live only on the local branch
`agent/pair-dm-placement`, which has never been pushed** — they are reachable from any worktree of
this repository on Riley's machine and from nowhere else. Do not try to fetch them; do not recreate
them by hand. If `git cat-file -e a659b066` fails you are in the wrong checkout — stop and say so.

Two more things before feature work starts:

- **Work in a clean tree.** The canonical worktree may hold uncommitted work from a parallel session
  (a typography/ink-ladder pass was in progress on 2026-08-21). `git status` must be clean, or the
  parallel work committed, before you branch. Never stash or revert someone else's changes.
- Gates green first: `just desktop-tauri-clippy`, `cargo test --manifest-path
  desktop/src-tauri/Cargo.toml`, `cd desktop && pnpm exec biome check . && pnpm test`.

## The design, fully decided

### A. Starting a visit
Two entry points, one helper:
- **Owner mentions a non-member resident** (owner types `@ziggy` in any room, including a 1:1 DM):
  on the owner's send path (`desktop/src-tauri/src/commands/message_send.rs`), before staging, any
  mentioned same-owner resident not in the channel is added via the existing membership-add path
  (`add_channel_members` / relay put-user) with a **visit marker** (section B). The message then
  proceeds normally — the new member's harness subscribes on the membership notification (proven
  live 2026-08-19) and wakes from the mention.
- **Resident's reply mentions a non-member same-owner resident** (owner-triggered turn, draft says
  `@ziggy`): in the mint path (`exchange_plan.rs`), where today the non-member case yields the
  "isn't here" note — instead: create the visit (same helper, executed by the desktop with owner
  authority), then proceed **exactly as the in-room case already works**: mint the exchange in THIS
  room, p-tag the guest, tag turn 1. Remove the "asking across rooms comes next" copy; it is
  obsolete. A resident already inside an exchange mentioning a third resident: same thing — visit +
  they join the existing exchange's room via a fresh mint if they are not a member of the exchange
  (exchange members are immutable per the frozen contract, so a new mention mints a NEW exchange
  with members = {speaker, new guest}; both exchanges coexist in the room; nothing keys on count).

### B. What a visit is, concretely
A visit = **ordinary channel membership**, plus a recorded arrival time used for display only.

**POLICY CHANGE, 2026-08-21, Riley — read this before you look at any older text.** An earlier
draft of this brief (and of `CONVERSATION_MODEL.md`) had the relay filter a visiting member's reads
to `created_at >= since`, so a guest could see nothing from before they arrived. **That is
cancelled.** A visiting agent gets the conversation: the room's history is readable by them for as
long as they are a member, exactly like any other member. The reason is plain — an agent that steps
into a conversation it cannot read cannot help with it, and answering one mentioned sentence
without its context is worse than not answering. It is also the house rule applied consistently:
inside the house family is trusted by default and the checks live at the door; a same-owner
resident invited into the owner's own room is family. A visit is bounded in **time and presence**,
never in what may be read.

- **Relay: nothing to build.** No `since` on the membership row, no read filter, no changes to
  `check_channel_membership` or any read path. Do not add a since column, a since parameter on
  put-user, or a filtered read path "for later" — if that boundary is ever wanted it will be
  designed then, and dead half-built machinery is exactly what the cleanup brief spent a day
  removing.
- **Desktop:** record the visit (channel, guest, arrival time, and the exchange id that brought
  them, if any) in the exchange store beside the heads. The arrival time is for the UI and for fade
  (D) — the timeline draws the threshold at that moment — and grants no read permission of its own.
  The visit grant must be recorded on the frozen per-final decision (same replay discipline the mint
  already uses) so a crash replay does not re-add or double-note.

### C. What people see — the UI is already built; you emit the events it reads
The visuals of a visit are finished, reviewed and merged on `agent/exchange-object` (design session,
2026-08-21): the two thresholds that bracket the passage, the inset column between them, the hairline
connecting the speakers' marks, `· visiting` after a guest's timestamp, the "visiting" mark in the
header rail, the sticky presence mark in the margin, and the drawer's "Between agents". They live in
`desktop/src/features/messages/lib/visitEvents.ts`, `visitSpans.ts`, `ui/VisitNoteRow.tsx`,
`ui/VisitPresenceRail.tsx`, `ui/TimelineRowShell.tsx`, `features/channels/ui/ConversationPresenceRail.tsx`,
`ConversationContextPanel.tsx`, `features/exchange/ui/ExchangeHistory.tsx`, and the visit block of
`shared/styles/globals/conversation-shell.css`.

**Do not add, change, restyle or "improve" any of it, and do not touch its geometry** — the
connector's position is derived arithmetic that `desktop/scripts/lab-shots.mjs` measures to 0.5px.
Run `node desktop/scripts/lab-shots.mjs` once before you start and once at the end: it must pass both
times, and if it fails after your work, your change reached the UI and should be reverted rather than
patched. Your job is the data those components read:
- On arrival, the relay speaks one note in the room (the new 41013 kind, from the salvage) whose
  body is this JSON, exactly these keys:
  `{"type":"visit_arrived","resident":"<guest hex pubkey>","exchange_id":"<hex>","text":"ziggy is visiting."}`
  (`text` is for clients that do not know the payload; the desktop writes its own line. It says
  nothing about what the guest can read — an earlier draft's "they can see this conversation from
  here on" described the cancelled since-filter policy and must not come back; see B.) The desktop
  already routes 41013 into the timeline once the salvage commit's kind wiring is in (check
  `CHANNEL_EVENT_KINDS` / `CHANNEL_TIMELINE_CONTENT_KINDS` in `desktop/src/shared/constants/kinds.ts`
  include it); `timelineItems.ts` treats any row whose body parses as a visit payload as a system row.
- The header's "visiting" mark and the drawer's visitor labels are derived from those notes on the
  desktop (`openVisitors()` in `visitSpans.ts`). No header/title wiring for you.
- The guest's own prompt (harness side, where the exchange sentence already renders —
  `exchange_prompt_line` in `crates/buzz-acp/src/queue.rs` is the pattern): one sentence — "You are
  a guest in <host label>'s conversation; you have the conversation, so answer in context. When the
  exchange pauses or closes, you step back out." No new prompt machinery — one more line in the same
  place. (The old wording promised the guest could only see from their arrival onward; that policy
  is cancelled, see B.)
- No badges change, no new settings, no permission surfaces. The strip works as it already does.

### D. Ending a visit (fade)
V1 rule, deterministic: when every exchange in that room that includes the guest is closed or
expired — and for owner-initiated visits with no exchange, when the exchange that FOLLOWS their
first reply (if any) ends, else after the room is idle — simplest honest implementation: **a visit
with no open exchange involving the guest ends when the owner's next message in the room does not
mention them, or on `resolve_exchange` stop of their exchange.** On fade: remove the membership
(existing remove-member path), and the relay speaks the matching note, same keys:
`{"type":"visit_left","resident":"<guest hex pubkey>","exchange_id":"<hex>","text":"ziggy left."}`
(the desktop renders "stepped out" and closes the plate from it). Their memory of the visit is
theirs; nothing is deleted. A later mention starts a fresh visit with a fresh arrival time. Keep the
fade check in ONE desktop function with tests; do not distribute the rule.

### E. Explicitly out of scope
The delegation card, "start a room from here" (stays the owner's manual, not-yet-built button),
carry-back summaries, project-room preference lookup, N-messages fade tuning, and anything touching
who may create rooms. Do not build ahead.

## Order of work, each with its done-condition

1. Step 0 + salvage cherry-picks → all gates green, `NOTE(claude)` removed.
   *(The relay since-membership + read-filter task that used to be task 2 is deleted — see the
   policy change in B. There is no relay read work in this brief at all.)*
2. Desktop visit helper + both entry points + decision-record replay → sibling `_tests.rs` tests:
   owner-mention visit, resident-mention visit + in-place mint (assert conversation stays the SAME
   room), replay stages once, third-resident mention mints a second exchange in place.
3. Arrival/left notes + guest prompt line → relay/desktop unit tests that the note bodies are exactly
   the JSON payloads in C/D (keys `type`, `resident`, `exchange_id`, `text`; `resident` lowercase
   hex) and that 41013 reaches the desktop timeline kinds; harness unit test for the prompt line.
   **No UI work and no Playwright UI spec** — the rendering is design-owned and checked by
   `desktop/scripts/lab-shots.mjs`.
4. Fade → the one-function rule + tests; e2e: stop the exchange → membership removed + a
   `visit_left` note emitted.
5. Full gates: `just desktop-tauri-clippy` · full tauri tests · `cargo test -p buzz-relay --lib`
   (skip `api::mesh_demo`, known flake) · `cargo test -p buzz-acp` · desktop `pnpm test` + the
   Playwright luca suite (pre-existing failures listed in the cleanup work are not yours).

## Report
Commits (hash + one line) · gates run with results · every `NOTE(claude):` left · anything from the
dead branch you consciously did NOT take and why it tempted you. Push `codex/visits`. Do not merge.
A Claude session will review the diff before Riley merges.

---

## Review outcome — 2026-08-21, after Codex's implementation

Reviewed at `6c436742`. The contract held: the note payload matches the desktop
parser key for key, the notes arrive as relay-signed kind 40099 (so 41013 stays
a relay command kind and needs no client wiring), and the cancelled since-filter
stayed cancelled — no `since` anywhere in the diff, and `check_channel_membership`
is untouched. `is_guest` is a membership label that adds the prompt line, not a
gate. Nothing from the cleanup brief's do-not-restore list came back. The UI was
not touched, and `lab-shots.mjs` measures green in all three themes.

Three follow-up commits were pushed to this same branch rather than a second one:

1. **`f4cac0db`** — the arrival note's `text` said the guest "can see this
   conversation from here on", which describes the cancelled policy. **That error
   was in this brief's example payload, not in the implementation** — the prose was
   corrected on 2026-08-21 and the example was not, so it was implemented
   faithfully. Both are fixed now; the payload example above carries a line saying
   why the wording must not return.
2. **`788b565b`** — `fade_visits` read a missing exchange head as an *open*
   exchange, which strands a guest: neither trigger can then fade them. An unknown
   head now fades.
3. **`c4aaefae`** — the three `communication_turn_registry` tests cleared one
   process-wide map while running in parallel and could wipe each other. A
   pre-existing race, surfaced (not caused) by the visit work; they now serialize.

Open, deliberately not done here: the branch is not merged, and Codex's three
implementation commits have empty bodies — the reasoning for that work exists
only in this brief.
