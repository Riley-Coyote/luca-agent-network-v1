# G1 continuation handoff — Claude → Codex

Written: 2026-08-04. Candidate commit at handoff: `bea0212f` (branch `agent/runtime-reliability`).

Read `evidence/G1/RUN_LOG.md` first — it is the authoritative pass/fail record of the live run.
This file adds the things that were learned during the session but are **not** otherwise in the repo.

---

## 1. State of the work

Three commits landed this session:

| Commit | What |
|---|---|
| `527b7361` | Fixed onboarding readability broken by the Buzz-branding strip (white-on-white primary buttons, blown-out card glow, unreadable badges, wrong step-dot count) |
| `82685a4f` | Aligned the dev bundle identity to `com.luca.agent-network.dev` / "Luca Agent Network Dev"; added `scripts/rebuild-luca-dev-app.sh` |
| `bea0212f` | Fixed `scripts/reset-desktop-standalone-state.sh` (its allowlist still rejected the renamed bundle); added `evidence/G1/RUN_LOG.md` |

**G1 is NOT claimed.** Roughly two-thirds of the checklist now has observed runtime proof; the
cancellation, permissions, crash/recovery and attachment/search sections are untested. See RUN_LOG.

## 2. Two decisions still open for Riley

1. **Which finish line counts.** The operative contract used by this run is
   `docs/luca/G1_CHECKLIST.md` (named authoritative by `HANDOFF.md` and `CLAUDE.md`, and it permits
   documented scope decisions). The *formal* machine validator
   (`python3 scripts/validate_planning_kit.py --evidence-only --gate G1 --candidate <40-hex>`) is
   currently unreachable — see RUN_LOG "Blocked queue" for the full analysis (missing task folders,
   10 different candidate commits across existing receipts, and no `evidence/M0/` at all so G0's
   recursive validation cannot pass). Rebuilding that pack is a separate, largely clerical project.
2. **Lint.** `pnpm exec biome check src` fails with 12 errors. All pre-existing, in files untouched
   this session (`ChannelPane.tsx` `noUselessFragments`, two `noImportantStyles` in globals CSS,
   `AgentIdentitySpecimen.tsx` `noArrayIndexKey`) plus formatter-only diffs. Fix or descope.

## 3. Automation map — what can and cannot be tested headlessly

This is the most time-saving section. Verified during this session.

- **Playwright CANNOT prove G1 runtime behavior.** Every spec funnels Tauri `invoke` through a mock
  (`desktop/src/testing/e2eBridge.ts`, `mockIPC(handleMockCommand)`) — this is unconditional, even
  with `installRelayBridge` (which only makes the *relay* real). `discover_native_residents`,
  `cancel_managed_turn`, `list_pending_managed_permissions` and `resolve_managed_permission` are
  **unmocked** and throw if a spec calls them.
- **The one exception:** `desktop/tests/e2e/luca/f11.spec.ts` launches the actual compiled app as a
  real OS process. It maps to relaunch/recovery and clean-profile/owner-recovery. macOS-only, serial,
  needs the bundle prebuilt (or `LUCA_F11_NATIVE_APP` to point at the installed app).
- **No headless path exists for import / cancellation / permissions.** There is no
  `tauri::test`/`mock_builder` harness anywhere in `desktop/src-tauri/src`; the `_tests.rs` files test
  pure helpers, not commands through IPC. These sections require driving the real GUI.
- **`buzz-cli` can drive the messaging matrix at protocol level** (`buzz dms open`,
  `buzz messages send/get/thread/search`, `buzz upload file`). Env: `BUZZ_RELAY_URL`,
  `BUZZ_PRIVATE_KEY`, `BUZZ_AUTH_TAG`. Caveat: it is relay-level only and has no awareness of Luca's
  resident registry, native discovery, cancellation or permissions. Also note the owner's key lives in
  the macOS keychain and should not be extracted to feed the CLI.
- **Upstream regression suite** = `just test-integration` (runs `cargo test -p buzz-db` plus workspace
  `cargo test --test '*'`). Needs Postgres + Redis, which are already up. Result this run: 285 passed,
  0 failed.
- **Gaps with no automated coverage at all** (must be proven live): managed-permission timeout expiry
  (`MANAGED_PERMISSION_TIMEOUT_SECS = 120`), the 5-second-grace → process-group restart
  (`sweep_system_agent_processes_with_grace`, `managed_agents/runtime.rs`), and "permission payloads
  never appear in relay events".
- **Stale test debt:** ~10 onboarding e2e specs predate the Luca rename — they look for
  "Use an existing key" / "Create a new identity key" (now "Connect an existing identity" / "Create
  owner identity"), `helpers/onboarding.ts:passThroughBackupStep` waits for an `nsec-value` the
  redesigned backup step no longer renders, and `onboarding-docked-cta-screenshots.spec.ts` asserts the
  96px textured border-image on the key-import card that `527b7361` replaced with a flat card.

### One unresolved conflict worth settling
`HANDOFF.md` documents `cargo test -p buzz-acp luca_descendant_isolation_managed_spawn_uses_pipe_and_scrubs_nested_shell --lib`
as passing. A static analysis concluded that command **cannot reach its test**, because the file lives at
`tests/luca-conformance/message_publish/descendant_environment.rs` — a tree that is not a workspace
member, has no `Cargo.toml`, and is referenced by no manifest, Justfile or CI. The gate run nonetheless
reported "1 passed" (`evidence/G1/logs/rust-buzz-acp-descendant-isolation.log`). **Inspect that log and
confirm the named test actually ran** before claiming the descendant-socket-isolation item — this is a
security claim, so it should not be taken on trust either way.

## 4. Live machine state left behind

The app is running a **clean profile created during this run**:

- Owner identity: fresh dev identity, created in-app. Its recovery file was written to the session
  scratchpad with a throwaway dev passphrase (deliberately not recorded anywhere; the identity is
  disposable — recreate rather than try to recover it).
- Prior app data was backed up first to
  `~/Library/Application Support/com.luca.agent-network.dev.g1-prerun-backup-20260804-042250`
  (plus an earlier `…fresh-backup-20260804-0125`). Nothing was deleted without a backup.
- **Two residents imported and running:**
  - `default` — Hermes profile `default` — pubkey `35653885e1eeb9c1a0759c24b502f6105714f0198ee83d04468b9905752ec899`
  - `main` — OpenClaw agent `main` — pubkey `09c26e21c06c123a18f139485cecb259cb0ae14dc72cb70dde17d3043af65201`
- Channel `#g1-mixed` exists containing both residents plus the owner, with a working multi-runtime
  exchange in it. Two DMs exist with prior turns.
- Environment: Hermes v0.17.0 (7 profiles), OpenClaw CLI 2026.6.5 with gateway up on
  `127.0.0.1:18789` (16 agents), relay on :3000, Postgres + Redis healthy, `claude` and `codex` CLIs
  both authenticated.
- **OpenClaw is UP.** An older note claiming the gateway was unreachable is stale. It does report a
  non-blocking version mismatch (service installed by 2026.6.11, CLI is 2026.6.5), which the app
  correctly surfaces as a degraded warning.

### Rebuilding the app
`scripts/rebuild-luca-dev-app.sh` builds, signs, installs, re-registers and relaunches the bundle with
rollback on failure, preserving the bundle id and keyring identity. Note the installed app embeds its
frontend — **frontend source changes do not appear until it is rebuilt**; a reload does not reconnect it
to Vite. For fast UI iteration use the Vite dev server plus a browser with
`?e2e=mock&machineOnboarding=1&resetDevState=1`.

## 5. Defects found, and their status

| Finding | Status |
|---|---|
| Onboarding white-on-white buttons / card glow / bad step dots | **Fixed** in `527b7361` |
| `reset-desktop-standalone-state.sh` rejected the renamed dev bundle | **Fixed** in `bea0212f` |
| User-visible copy says "**Mnemos** does not copy their credentials" (should be Luca), on the native-import card | **Open** — wrong-brand string, relevant to the public-brand audit |
| Model dropdown takes ~15s to populate on a clean profile | **Open** — latency only; it does resolve |
| biome: 12 pre-existing lint errors | **Open** — decision needed |
| Stale onboarding e2e specs (~10) | **Open** — logged in `docs/luca/DESIGN_PUNCHLIST.md` |

**A finding that was withdrawn, recorded so it is not "rediscovered":** a code read suggested
`registry_from_records()` hard-errors the whole resident registry when any record has an empty pubkey,
implying `list_luca_residents` was failing closed. This was **not reproduced live** — empty-pubkey
records are the normal representation of un-added starter residents (Luca / Vektor / Anima, "Identity
created on add"), and the Agents view lists residents correctly with them present. No defect.

## 6. Suggested next steps

1. Settle the two decisions in §2.
2. Drive the **cancellation** and **permissions** sections live (GUI required — see §3). These are the
   highest-value remaining items precisely because they have the least automated coverage.
3. Then crash-during-generation, frozen-final reconciliation, missing-binary-degraded, and the
   attachment/media + search smoke.
4. Assemble evidence to the `evidence/templates/` schemas, run the artifact/secret scan
   (`scripts/evidence/scan_artifacts.py --root <path> --output <report.json>`), and get an independent
   review before any verdict.

**Do not reinterpret a missing proof as a pass** — that is the checklist's own verdict rule, and the
run log is written to that standard.

---

Design/UI work is continuing separately with Claude; see `docs/luca/DESIGN_PUNCHLIST.md` for the
visual backlog. Coordinate before making broad UI changes to avoid collisions.
