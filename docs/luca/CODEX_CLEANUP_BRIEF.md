# Cleanup brief — read all of this before touching anything

*Written 2026-08-20 by Claude, at Riley's direction, after the exchange-object chunk shipped
(`agent/exchange-object` @ `8b386c2b`). This brief is the authoritative context for the tasks below.
Where it conflicts with older plans, milestone kits, or your memory of this codebase, THIS WINS.*

---

## First: what changed on purpose. Do not "fix" any of it.

Riley made deliberate product decisions on 2026-08-19/20 that changed the security posture of this
app. If you last saw this code before then, several things you built will look broken, missing, or
bypassed. **They are not. They were removed or demoted intentionally, by Riley's explicit decision.**
Restoring any of them is the one way to fail this task.

1. **The dispatch ledger is a receipt, not a gate** (`79e1fa94`, `c493fadf`). Turns that arrive
   without a locally staged dispatch row now stage their own row from their signed trigger event
   (`stage_wake_from_trigger`, `ensure_wake_dispatch`). `validate_dispatch` checks *shape* (depth ≤ 1,
   well-formed ids, non-empty valid recipient set), not causal pedigree. The old strict rules refused
   the store's own file after an exchange widened a row and bricked every send. Do not tighten the
   validator. Do not remove the self-staging. Do not re-add per-depth causal invariants.
2. **In-house tool permissions auto-approve** (`79e1fa94`). `await_local_decision` selects the
   runtime's own allow-flavoured option without raising a card. `LUCA_ASK_TOOL_PERMISSIONS=1`
   restores the cards. This is the intended default while building. Do not remove the auto-approve.
3. **The resident's shell carries no relay credential** (`69438bf3`). The `buzz` MCP a managed
   resident gets receives only `BUZZ_RELAY_URL` — no private key, no auth tag, no owner pubkey. The
   old behavior (key in the shell env) let a model sign as the resident from a shell; a live test
   showed a model doing exactly that. Do not hand any signing material back to the MCP child.
4. **`luca_managed_prompt.md` was rewritten** (`69438bf3`). It no longer teaches the Buzz CLI. A
   resident reaches a sibling by writing `@Name` in its ordinary reply; the host opens a bounded
   **exchange** (kind 30178, turn-tagged messages, relay-enforced budget, owner Stop/Go). Do not
   re-add CLI instructions or the old "open an owner-visible DM via the CLI" flow.
5. **F10's one-hop descendant rule is superseded inside an exchange.** The exchange bucket is the
   ceiling on resident↔resident volleys now. `stage_descendant_event` has no production caller; it is
   part of task 1 below (deletion), not something to wire back in.
6. **`TODO(ship)` comments are frozen wording.** They say "review the security posture before
   shipping and confirm we are happy with it." They are review reminders, NOT re-implementation
   orders. Do not expand them, act on them, or reword them.
7. **The F-series communication-action machinery is not a template.** New features are built on plain
   events + relay rules + UI. Nothing new threads the authority machinery, adds permission checks,
   approval bindings, capability types, or protocol contracts. If a task below seems to require one,
   STOP, leave a `NOTE(claude):` comment describing what you wanted to do, and move on.

**What still enforces safety, so you know nothing is "unguarded":** the relay (kind-30178 record
validation, turn budgets under an advisory lock, "resident-to-resident mention needs an exchange",
workflow mention gating), the harness (siblings wake only inside a speakable exchange and never
steer), and key custody (residents' keys never enter model processes). Those stay exactly as they are.

---

## Ground rules

- Branch: create `codex/cleanup-after-exchange` off `agent/exchange-object`. One task = one commit.
  Never amend, never force-push, never `git add .`.
- **Delete, don't refactor.** Every task below is subtractive or mechanical. If a fix tempts you to
  restructure, add a type, add a check, or "improve" neighbouring code — don't. Smallest diff wins.
- No new dependencies, no new protocol types, no new permission or authority code of any kind.
- Do not touch: `crates/luca-protocol/src/exchange.rs` (frozen contract), `luca_managed_prompt.md`,
  any `TODO(ship)` comment, `desktop/src/features/exchange/**` behavior, or anything under
  `.codex/luca-v1/` (stale kit — not in force for this work).
- Hermit first: `. ./bin/activate-hermit` from the repo root before any cargo/pnpm command.
- Build caches live on the LaCie drive. If `/Volumes/LaCie/Luca-Development/BuildCaches/...` is
  missing, STOP and tell Riley — do not build to a local target dir, do not change cargo config.

## Tasks, in order

### 1. Delete the dead communication-action machinery
`just desktop-tauri-clippy` fails with ~197 dead-code errors, almost all in
`desktop/src-tauri/src/luca/communication_action_backend.rs`, `communication_action_outbox.rs`,
`communication_action_publisher.rs`, `communication_bridge.rs`, `communication_event_vault.rs`, plus
single items in `operator_forge.rs`, `resident_documents.rs`, `owner_brain_store/connected.rs`,
`managed_agents/native_runtime.rs`, `commands/channels.rs`, and
`managed_dispatch_store.rs` (`stage_descendant_event`, `resolve_artifact_bindings`).
**Clippy is the oracle**: delete exactly what `-D warnings` flags as never used/constructed/read,
plus tests and helper code that exist only to exercise the deleted items. Iterate (deleting one layer
exposes the next) until `just desktop-tauri-clippy` exits 0. If removing something would break a
LIVE caller, that item is not dead — leave it and list it in your report. Do not delete whole files
unless every item in them is dead. Definition of done: `just desktop-tauri-clippy` green AND
`cargo test --manifest-path desktop/src-tauri/Cargo.toml` green (2058+ tests today).

### 2. Green the remaining pre-existing CI reds
- `cargo fmt --all` (fixes `crates/buzz-cli/src/brain_review.rs` + `commands/brain.rs`); commit only
  those formatting changes. Done: `just fmt-check` green.
- Fix the biome errors (NOT the warnings) shown by `cd desktop && pnpm exec biome check .`:
  `FilamentMark.tsx` (noCommaOperator ×2), `pile-core.ts` (unused private member),
  `ThinkingIndicatorLab.tsx` (aria props + exhaustive deps — for the deps one, follow biome's
  suggested fix; do not redesign the hook), `tests/e2e/luca/agent-library.spec.ts` (format). Done:
  `just desktop-check` green. These are lab/visual files — change nothing about what they render.

### 3. The missing "who isn't here" note (bug, tightly scoped)
Repro: in a 1:1 DM with a resident, the owner asks it to reach another resident; the reply correctly
gets no p-tag and no exchange (this part WORKS — do not touch it), but the owner-key kind-40099
exchange-note ("<Resident> mentioned <Name>, who isn't here — asking across rooms comes next.") is
never published. Note publication is best-effort by design and failures are logged via `eprintln!`
(`luca-exchange:` prefix) — start from that log line. Likely area: the mint/notes path in
`desktop/src-tauri/src/luca/exchange_plan.rs` / `managed_message_publisher.rs` when the conversation
has no exchange authority attached or membership lookup behaves differently in a 1:1 DM. Fix the
publication of the note ONLY; add one focused test in the existing `_tests.rs` style. Do not change
when notes are warranted, their copy, or anything about p-tags/minting.

### 4. Background-room pause badge (small UI wiring)
Known gap (from the UI builder's notes): an exchange that pauses in a room you are NOT viewing does
not badge until something refreshes it, because `useExchangeTurnRefresh` is scoped to the active room
and pausing writes no new relay head. Cheapest acceptable fix (pick ONE, smallest diff): a global
live subscription on kind-9 events carrying the `exchange` tag that calls the existing `get_exchange`
refresh for that id, OR a periodic re-read (≥30s) of open exchanges in the store. Wire it inside
`desktop/src/features/exchange/` only. Done: the existing Playwright suite
(`pnpm exec playwright test tests/e2e/luca/exchange-strip.spec.ts`) still 6/6, plus one new spec case
proving a background-room pause badges. Do not touch `unreadChannelCounts.ts` semantics.

## Report
End with: commits (hash + one line), the gate commands you ran with pass/fail, anything you could NOT
delete in task 1 and why, and any `NOTE(claude):` markers you left. Push the branch. Do not merge.
