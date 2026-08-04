# G1 autonomous verification run — live log

Candidate commit: `82685a4f` (branch `agent/runtime-reliability`)
App: `Luca Agent Network Dev.app` — bundle `com.luca.agent-network.dev`
Run started: 2026-08-04

Status key: PASS = observed working · FAIL = observed broken · BLOCKED = could not test
Claims here come from observed runtime output only.

## Environment (candidate lock)

| Item | Value |
|---|---|
| Commit | `82685a4ff736806acaec2ab905365dffa8daecaf` |
| rustc / cargo | 1.95.0 / 1.95.0 |
| node / pnpm | v24.14.0 / 11.4.0 |
| Hermes | v0.17.0 (2026.6.19), 7 profiles |
| OpenClaw | CLI 2026.6.5, gateway up on 127.0.0.1:18789, 16 agents |
| claude CLI | 2.1.220 (authenticated) |
| codex CLI | 0.145.0 (authenticated) |
| OS | macOS 26.3.1 arm64 |
| Relay | buzz-relay :3000 (HTTP 200); Postgres + Redis healthy |

## Phase 0 — Candidate lock

- PASS — candidate committed (`82685a4f`); working tree had no unrelated tracked changes at lock time.
- PASS — app rebuilt from `527b7361` by the rebuild script; `82685a4f` changes **no** file under
  `desktop/src`, `desktop/src-tauri/src`, or `crates/` (verified via `git diff --name-only`), so the
  running binary is source-equivalent to the candidate.
- PASS — clean environment: no stale app or ACP processes; app data, caches, WebKit state, prefs and
  keyring entries removed before the run.

### Defect found and repaired (Phase 0)
`scripts/reset-desktop-standalone-state.sh` refused the current dev bundle id — its allowlist still
only accepted `xyz.block.buzz.app.dev*` after the rename to `com.luca.agent-network.dev`, so the dev
instance could not be reset at all. Extended the allowlist to cover both identities; verified it still
refuses an arbitrary id (`com.example.someapp`). Safety property preserved.

## Phase 1 — Automated gates (10/11 PASS)

| Gate | Result | Detail |
|---|---|---|
| `cargo test -p luca-protocol` | PASS | 18 passed / 0 failed |
| `cargo test -p buzz-acp permission --lib` | PASS | 12 / 0 |
| buzz-acp descendant isolation | PASS (needs audit) | 1 / 0 — see open question below |
| desktop `native_runtime --lib` | PASS | 10 / 0 |
| desktop `managed_dispatch_store --lib` | PASS | 18 / 0 |
| desktop `managed_cancel_status --lib` | PASS | 2 / 0 |
| desktop `resident_registry --lib` | PASS | 4 / 0 |
| `cargo check` (desktop) | PASS | 0 errors |
| `pnpm typecheck` | PASS | clean |
| `pnpm exec biome check src` | **FAIL** | 12 errors / 2 warnings — see below |
| `pnpm build` | PASS | built OK |

Logs: `evidence/G1/logs/`.

**biome failure is pre-existing, not a regression from this session's work.** The reported errors are in
files untouched here (`ChannelPane.tsx` `noUselessFragments`, two `noImportantStyles` in globals CSS,
`AgentIdentitySpecimen.tsx` `noArrayIndexKey`) plus formatter-only diffs in 11 files. Biome run against
the 5 onboarding files changed in `527b7361` reported clean.

**Open question to audit:** a scout's static analysis concluded the HANDOFF-documented command
`cargo test -p buzz-acp luca_descendant_isolation_managed_spawn_uses_pipe_and_scrubs_nested_shell --lib`
*cannot* reach its test, because the file lives at `tests/luca-conformance/message_publish/descendant_environment.rs`
— a tree that is not a workspace member and is referenced by no manifest. The gate worker nonetheless
reported 1 test passed. These conflict; the log must be inspected to confirm the **named** test actually
ran rather than an unrelated filter match. Until resolved, do not claim the descendant-socket-isolation
item from this command.

## Phase 2a — Clean personal-home onboarding (live, native app)

Driven on a genuinely clean profile (app data + keyring wiped, backup taken first).

- PASS — clean profile boots to Luca onboarding: "A personal home for the agents you work with".
- PASS — no Buzz branding, no community/workspace setup, no Fizz/Honey/Bumble, no conductor anywhere
  in the flow.
- PASS — custody copy is honest: "Its private signing key stays in your system keychain and is never
  shown or copied during setup" and "Never share a private key. Anyone with one can act as its owner."
- PASS — **owner recovery is real and usable**: created a protected recovery file, UI confirmed
  "Protected backup saved as luca-owner-backup.luca-owner.age". Verified on disk: 596 bytes, header
  `age-encryption.org/v1` with an `-> scrypt` stanza (work factor 15) — genuine passphrase-derived age
  encryption, not a stub. (Throwaway dev passphrase; never recorded.)
- PASS — runtime setup step detected real runtimes: Claude Code READY, Codex READY.
- PASS — default runtime/model config accepted (Claude Code / Default model).
- PASS — **reached the main app**; internal personal-home tenancy auto-provisioned ("Personal workspace"
  under the owner npub). Sidebar: Agents, Activity, Brain Setup, Settings, Channels, Direct messages.

### Observations (not failures)
- Model list took ~15s to populate on a clean profile ("Loading models…" then "Default model").
  Latency, not a hang — it resolved on its own.
- The onboarding readability fixes from `527b7361` are confirmed live in the native app: primary
  buttons legible, runtime cards flat with no white glow, 4 step dots.

## Phase 2a — Native import and identity (live)

- PASS — **Hermes discovery reports visibly**: 7 profiles found (default, axiom, builder, cortex, fable,
  weaver, ziggy), each labelled "Exact Hermes profile found; ACP readiness not yet tested" — honest, not
  overclaiming readiness.
- PASS — **OpenClaw discovery reports visibly**, including a real *degraded* signal surfaced in the UI:
  "Gateway service was installed by OpenClaw 2026.6.11; current CLI is 2026.6.5."
- PASS — **import idempotency (Hermes)**: imported profile `default` → one resident, pubkey
  `35653885e1eeb9c1…`. The entry then renders "Imported" (action disabled), and after a **full
  re-discovery cycle** it still resolves to the same single resident — re-association by semantic
  identity, no duplicate. On-disk registry confirms exactly one record with that identity.
- PASS — **OpenClaw import**: agent `main` (xai/grok-4.5) → resident pubkey `09c26e21c06c123a…`,
  distinct from the Hermes resident. Mixed-runtime pair established.
- PASS — **Luca does not modify native configuration**: SHA-256 of the Hermes profile tree and of
  `~/.openclaw/openclaw.json` are byte-identical before and after both imports.

### Defect found (Phase 2a) — wrong product name in shipped copy
The native-import card reads "**Mnemos** does not copy their credentials." Should be "Luca". Wrong-brand
string in a user-visible surface; relevant to G1's public-brand audit.

### Correction to an earlier static finding (recorded for honesty)
A scout's code read suggested `registry_from_records()` hard-errors the entire resident registry if any
record has an invalid/empty pubkey, and inferred `list_luca_residents` was failing closed. **Not
reproduced live.** Empty-pubkey records are the normal representation of *un-added starter residents*
(Luca / Vektor / Anima — "Identity created on add"); the Agents view lists residents correctly with three
such records present. No defect claimed.

## Phase 2b — Messaging matrix (live, real runtimes)

- PASS — **Hermes DM**: opened a DM with resident `default` (Hermes profile `default`), sent
  "Reply with exactly: OK". Received **exactly one** resident-authored final: `default` → "OK"
  (04:39), rendered inline in the conversation with the resident's identity specimen.
- PASS — **OpenClaw DM**: same test against resident `main` (OpenClaw agent `main`, xai/grok-4.5).
  Received **exactly one** resident-authored final: `main` → "OK" (04:41).
- PASS — **conversation-first shell**: selecting a DM opens its timeline directly (no inbox
  intermediary); the resident reply expands **inline** in the main conversation
  ("1 reply · Collapse replies"), not in a separate thread drawer.
- PASS — both residents auto-started and reported running (green state) after import; the app
  exposes a "Stop running agents" control.

Note: on a clean profile the owner renders as a raw hex pubkey in the timeline (no display name set).
Cosmetic, not a correctness failure.

- PASS — **upstream Buzz messaging regression suite**: `just test-integration` →
  **285 passed / 0 failed** across 40 test binaries (buzz-db + workspace `--test '*'`; remaining
  ignores are Postgres-tenant-gated and fixture-refresh tests that are `#[ignore]` by design).
  Log: `evidence/G1/logs/upstream-integration.log`. Verified no side effects on the running app,
  relay, or containers.

## Phase 2c — Relaunch and recovery (live)

- PASS — **clean shutdown / process-group lifecycle**: quitting the app terminated both managed ACP
  resident processes (2 → 0). No orphaned runtimes.
- PASS — **residents return under the same public keys**: after a full app restart both residents
  auto-restored with byte-identical keys —
  `default` = `35653885e1eeb9c1a0759c24b502f6105714f0198ee83d04468b9905752ec899`,
  `main` = `09c26e21c06c123a18f139485cecb259cb0ae14dc72cb70dde17d3043af65201`.
  Exactly one ACP process per resident after relaunch (no duplicate spawns).
- PASS — **conversation history survives restart**: both DMs and their finals are intact after relaunch.
- PASS — **continuity from bounded signed history through a fresh ACP session**: after the restart,
  asked `default` "What single word did I ask you to reply with earlier?" → replied "**OK**",
  correctly recalling the pre-restart instruction. The runtime session was new; the understanding came
  from signed Luca conversation history, and Luca makes no claim that the native runtime restored its
  own transcript.

## Phase 2b — Mixed Hermes/OpenClaw room (live)

- PASS — created channel `#g1-mixed`, added both residents (3 members: owner + `default` + `main`).
  Channel system message correctly records "was added by You, along with main".
- PASS — **mixed-runtime addressing with correct attribution and placement**: posted
  "@default @main reply with only your own name" (both mentions resolved through the composer's
  autocomplete to real agent mentions). Received **two** replies in one chronology, correctly threaded
  under the prompt and each correctly attributed to its own resident identity/specimen:
  - `default` (Hermes-backed) → "Hermes"
  - `main` (OpenClaw-backed) → "Vektor"
  Authorship and placement are correct; the reply *text* is each model's self-description (a persona /
  system-prompt matter), not an attribution defect.

## Not yet executed in this run

These G1 items remain **untested** — they are NOT passes and must not be recorded as such:
- Cancellation section (cancel long Hermes turn, cancel long OpenClaw turn, conversation-wide Stop,
  5-second grace + process-group restart, `publication_ambiguous` truthfulness, provisional activity
  clearing).
- Permissions section (real runtime-triggered request, approve/reject via advertised options,
  cancel-while-pending, timeout expiry, app close while pending, stale epoch rejection, no permission
  payloads in relay events, descendants do not inherit the control socket, legacy unmanaged ACP
  unchanged). Note: a scout found **no automated coverage** for timeout expiry, the 5s-grace restart,
  or the relay-non-leak assertion, so these can only be proven live.
- Crash during generation (no duplicate final, honest interrupted state); frozen-final reconciled
  exactly once after restart; missing executable/profile/gateway after restart → degraded.
- Attachment/media send + render smoke; search smoke against the installed app; unread boundaries,
  pagination and scroll-anchoring checks.
- Evidence assembly to `evidence/templates/` schemas, `just luca-contracts` validation, artifact/secret
  scan of candidate evidence, and the independent review.

## Verdict so far

**G1 is NOT claimed.** A large and load-bearing portion of the checklist now has real, observed runtime
proof — clean-profile onboarding, owner recovery, native discovery/import/idempotency, native-config
immutability, both DM paths, the mixed-runtime room, relaunch key stability, cross-restart continuity,
and the full upstream regression suite. But the cancellation, permissions, crash/recovery and
attachment/search sections are untested, and the biome gate fails, so the checklist's verdict rule
("do not reinterpret a missing proof as a pass") is not satisfied.

## Blocked queue (for one batch descope decision)
1. **Formal machine-validated G1 is unreachable from the current corpus** —
   `scripts/validate_planning_kit.py --evidence-only --gate G1` requires all 19 M1 task receipts at one
   identical candidate commit plus recursive G0 validation. Today: 5 of 19 task folders are absent
   (F10, F12, F16, F17, F19); every existing `results.json` carries a different candidate commit (10
   distinct hashes); `evidence/M0/` does not exist at all, so G0's machine-checked pack is missing;
   F03/F06 are explicitly superseded for G1 by `G1_ONBOARDING_CORRECTION.md`; F09/F11/F15 are partial.
   This run therefore targets the operative repository checklist (`docs/luca/G1_CHECKLIST.md`), which
   `HANDOFF.md` and `CLAUDE.md` name as authoritative, and which permits documented scope decisions.
