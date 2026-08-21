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
   relay's turn rules — none of it changes. The only new relay behavior is the since-filter (below)
   and the note kind from the salvage.
5. The contract (`crates/luca-protocol/src/exchange.rs`), `luca_managed_prompt.md`'s house rules,
   and all `TODO(ship)` wording stay frozen.

## Branch setup (step 0)

Branch `codex/visits` off `codex/cleanup-after-exchange` (it contains the machinery deletion and CI
fixes; `agent/exchange-object` is its base). Then the three cherry-picks. Gates must be green before
feature work starts: `just desktop-tauri-clippy`, `cargo test --manifest-path
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
A visit = ordinary channel membership plus a recorded **arrival time** (`since`). Two halves:
- **Relay:** the membership row for a visiting member carries `since` (unix seconds). Extend the
  put-user path to accept an optional since (only the channel's creator/owner-authored put-user may
  set it), store it with the membership, and **filter that member's reads of channel events to
  `created_at >= since`** — history fetches, live REQ replay, context queries, COUNT. The choke
  points are the same places that already answer "is this reader a member of this private channel"
  (`check_channel_membership` and the read-path membership checks in `crates/buzz-relay`); extend
  them to also answer "since when." Fail closed: a malformed since behaves as "now." The owner and
  ordinary members have no since (see everything, as today). This is the privacy floor the model
  doc demands — a guest in your private DM must never be able to read what happened before they
  arrived, and "a prompt-window alone is not a boundary."
- **Desktop:** record the visit (channel, guest, since, and the exchange id that brought them, if
  any) in the exchange store beside the heads, so fade (D) and the header (C) can be derived. The
  visit grant must be recorded on the frozen per-final decision (same replay discipline the mint
  already uses) so a crash replay does not re-add or double-note.

### C. What people see
- On arrival, the relay speaks one note in the room (the new 41013 kind, from the salvage):
  "ziggy is visiting — they can see this conversation from here on."
- The room header shows visitors: "Luca · ziggy visiting" (the conversation-model wording). Wire it
  where the header/title renders; visitors come from the desktop's visit records for that channel.
- The guest's own prompt (harness side, where the exchange sentence already renders —
  `exchange_prompt_line` in `crates/buzz-acp/src/queue.rs` is the pattern): one sentence — "You are
  visiting <host label>'s conversation as a guest; you can see messages from your arrival onward.
  When the exchange pauses or closes, you step back out." No new prompt machinery — one more line in
  the same place.
- No badges change, no new settings, no permission surfaces. The strip works as it already does.

### D. Ending a visit (fade)
V1 rule, deterministic: when every exchange in that room that includes the guest is closed or
expired — and for owner-initiated visits with no exchange, when the exchange that FOLLOWS their
first reply (if any) ends, else after the room is idle — simplest honest implementation: **a visit
with no open exchange involving the guest ends when the owner's next message in the room does not
mention them, or on `resolve_exchange` stop of their exchange.** On fade: remove the membership
(existing remove-member path), and the relay speaks: "ziggy left." Their memory of the visit is
theirs; nothing is deleted. A later mention starts a fresh visit with a fresh since. Keep the fade
check in ONE desktop function with tests; do not distribute the rule.

### E. Explicitly out of scope
The delegation card, "start a room from here" (stays the owner's manual, not-yet-built button),
carry-back summaries, project-room preference lookup, N-messages fade tuning, and anything touching
who may create rooms. Do not build ahead.

## Order of work, each with its done-condition

1. Step 0 + salvage cherry-picks → all gates green, `NOTE(claude)` removed.
2. Relay since-membership + read filter → unit tests in the relay handler style + one e2e in
   `crates/buzz-test-client/tests/` proving: guest added with since sees nothing older, sees
   everything newer, owner unaffected, malformed since acts as now.
3. Desktop visit helper + both entry points + decision-record replay → sibling `_tests.rs` tests:
   owner-mention visit, resident-mention visit + in-place mint (assert conversation stays the SAME
   room), replay stages once, third-resident mention mints a second exchange in place.
4. Arrival/left notes + header + guest prompt line → Playwright spec beside
   `desktop/tests/e2e/luca/exchange-strip.spec.ts` (mock a visit: note row renders, header shows
   "visiting", volley counts in place); harness unit test for the prompt line.
5. Fade → the one-function rule + tests; e2e: stop the exchange → membership removed + "left" note.
6. Full gates: `just desktop-tauri-clippy` · full tauri tests · `cargo test -p buzz-relay --lib`
   (skip `api::mesh_demo`, known flake) · `cargo test -p buzz-acp` · desktop `pnpm test` + the
   Playwright luca suite (pre-existing failures listed in the cleanup work are not yours).

## Report
Commits (hash + one line) · gates run with results · every `NOTE(claude):` left · anything from the
dead branch you consciously did NOT take and why it tempted you. Push `codex/visits`. Do not merge.
A Claude session will review the diff before Riley merges.
