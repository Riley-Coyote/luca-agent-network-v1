# M0 Runtime Parity Source Map

Date: 2026-08-02
Disposition: read-only reconciliation complete; no product implementation performed
Baseline: `luca/v1` at `e487d238e25bfd6b0795b6059ad66fdf07ce955a`
Buzz ancestor: `7e34bee62cacaa9d8a96c14d5892a471b59a1983` (verified ancestor)
Upstream reference: `upstream/main` at `a5dbdf5e61e4c512acd99c219c79c154ddb57295`

## 1. Review inputs and integrity

- Replacement handoff: `/Users/rileycoyote/Downloads/luca-runtime-parity-handoff-v1(1).zip`
- External SHA-256: `13dfc2b2ec27122be96a1ea6a197d4f5119a8660621acab5717de98e9d71ad62` (match)
- Internal `CHECKSUMS.sha256`: all entries passed.
- Read order followed: `00_START_HERE.md`, then the review prompt and all required specification, contract, acceptance, routing, and research documents.
- Review boundary followed: source inspection and these two M0 documents only. Existing dirty worktree files were not modified.

## 2. Current Luca source of truth

| Concern | Current authoritative source | Current state | Planning consequence |
|---|---|---|---|
| Runtime catalog | `desktop/src-tauri/src/managed_agents/discovery.rs` (`KNOWN_ACP_RUNTIMES`, `KnownAcpRuntime`) | Static Goose, Claude Code, Codex, Buzz Agent catalog; no Hermes/OpenClaw | Add exact native bindings through this Rust authority or a compatible descriptor resolver; do not create a second frontend catalog |
| Resident record | `desktop/src-tauri/src/managed_agents/types.rs` (`ManagedAgentRecord`) | Persists resident identity, runtime snapshots/overrides, args, env, model, provider, launch and supervision data | Extend compatibly with native binding and fingerprint fields; migrations must preserve existing residents |
| Runtime discovery UI contract | `desktop/src-tauri/src/managed_agents/types.rs` (`AcpRuntimeCatalogEntry`) and `desktop/src/features/agents/` | Catalog entries expose readiness/auth/install facts; UI consumes Rust results | Imported native identities need separate candidate records rather than pretending each is only an installed executable |
| Spawn and supervision | `desktop/src-tauri/src/managed_agents/runtime.rs` (`spawn_agent_child`) | Desktop spawns `buzz-acp`, which launches the selected ACP runtime through `BUZZ_ACP_AGENT_COMMAND` and args | Keep this one-host/one-transport topology; Hermes/OpenClaw are descriptors/bindings, not new messaging stacks |
| Child authority boundary | `desktop/src-tauri/src/managed_agents/runtime.rs`; `desktop/src-tauri/src/luca/signing_transport.rs`; `local_broker_session.rs`; `signing_broker.rs` | Resident/private relay keys are removed from child env; an exclusive inherited broker channel provides typed authority | Already satisfies the central host-owned-key architecture. Extend, do not replace |
| Managed response capture | `crates/buzz-acp/src/acp.rs`; `crates/buzz-acp/src/luca_final_publisher.rs`; `crates/buzz-acp/src/luca_managed_prompt.md` | Managed turns capture user-facing `agent_message_chunk` output; managed prompt forbids runtime-side ordinary message publication | G2.1 is substantially present; audit normalization differences instead of rebuilding it |
| Host reply signing/publication | `desktop/src-tauri/src/luca/managed_message_publisher.rs`; `managed_message_outbox.rs`; `managed_dispatch_store.rs`; `signing_broker.rs` | Desktop signs and publishes resident-authored kind-9 replies, with durable dispatch/outbox reconciliation and exact idempotency | G2.2 and G2.3 are already implemented for the current owner-authored room/thread slice |
| Trigger admission and reply tags | `crates/buzz-acp/src/luca_final_publisher.rs` | Valid signed owner-authored kind-9 triggers only; strict room/thread tags; owner-only recipient tags | Safe but intentionally narrower than runtime-parity group, DM, and agent-to-agent requirements |
| ACP client | `crates/buzz-acp/src/acp.rs` | Initialize, authenticate, `session/new`, prompt/update streaming, cancellation and Goose steering; hardcoded protocol version 2 | Add an isolated protocol/capability adapter. Current local contract conflicts with handoff's ACP v1 production target |
| Permission handling | `crates/buzz-acp/src/acp.rs::handle_permission_request` | Automatically selects native `allow_once`, with reject fallback | Must be replaced by a Luca permission broker before safe interaction parity |
| ACP content input | `crates/buzz-acp/src/acp.rs::build_prompt_params` | Text blocks only | Existing Buzz media UX does not yet mean runtime attachment parity |
| ACP sessions | `crates/buzz-acp/src/pool.rs::SessionState` | In-memory channel-to-session map plus turn counters/core/canvas; invalidation and max-turn rotation | Sufficient for a first live messaging slice, not durable restart/load/resume/bounded-session parity |
| Event and mention filtering | `crates/buzz-acp/src/filter.rs`, `queue.rs`, `pool.rs`, `lib.rs` | Signed event filtering, p-tag mention gating, thread parsing, response queueing, steering/cancel behavior | Reuse; generalize only at the managed publisher/router boundary and keep stable-pubkey routing |
| Composer mentions | `desktop/src/features/messages/ui/useMentionSendFlow.ts`, `MessageComposer.tsx`; `desktop/src/features/messages/lib/threading.ts`; `messageMentionPubkeys.ts` | Frontend resolves visible mentions to stable pubkeys and emits tags through the existing message path | Preserve UI behavior; the host router must consume signed tags, not display-name text |
| Human message/media path | `desktop/src/features/messages/hooks.ts`; `imetaMediaMarkdown.ts`; `useMediaUpload.ts`; `desktop/src/shared/api/tauri.ts` | Buzz chat already uploads/renders attachments and writes imeta tags | Reuse for Luca messaging, but add an explicit bounded attachment-to-ACP broker |
| Agent activity | `crates/buzz-acp/src/observer.rs`, relay observer frame path; `desktop/src/features/agents/observerRelayStore.ts`, `activeAgentTurnsStore.ts`, `agentWorkingSignal.ts` | Existing normalized observer/activity pipeline tracks turns and tool updates | Adapt runtime event mapping into this shared surface; do not build a second activity UI |

## 3. Existing host-publication commit line

The branch already contains the work the handoff labels as future G2:

- `795a9920` — managed resident signing broker
- `eaf3fc07` — managed ACP final-turn handoff
- `e89387ed` — final-turn routing hardening
- `547e0087` — resident-authority publication
- `45d107c3` — exact publication recovery
- `b9a93642`, `cc9c848d` — later managed-publication fixes

This implementation is an asset, not disposable scaffolding. The remaining work is to broaden its admitted conversation kinds/participants while retaining its authority, idempotency, and recovery properties.

## 4. Native systems available for read-only reuse

### Hermes

- Installed executable: `/Users/rileycoyote/.local/bin/hermes`
- Observed version: `0.17.0`; `hermes acp --check` succeeded.
- Native profiles observed: `default`, `axiom`, `builder`, `cortex`, `fable`, `weaver`, `ziggy`.
- Old Luca reference implementation:
  - `/Users/rileycoyote/clawd-luca/luca-terminal-v2/server/hermes-bridge.js::detectHermesProfiles()`
  - `/Users/rileycoyote/clawd-luca/luca-terminal-v2/server/cli-agent-runtimes.js`
- Reuse: the discovery/binding idea and exact-profile semantics.
- Reject: old Node/SSE transport and any profile switching or migration.
- Probe note: ACP initialized under the current host's v2 request, but the bounded model/session probe timed out while a configured optional Mnemos MCP retried. Treat identity/readiness and optional-MCP health as separate facts.

### OpenClaw

- Installed executable: `/opt/homebrew/bin/openclaw`
- Observed CLI version: `2026.6.5`; native machine-readable agent enumeration works.
- Observed agent IDs include `main`, `anima`, `luca`, `jerry`, `iris`, `flux`, `sage`, `rune`, `drift`, `axiom`, `praxis`, `synthesis`, `scout`, `chronicle`, `mirror`, `fifty`.
- Old Luca reference implementation:
  - `/Users/rileycoyote/clawd-luca/luca-terminal-v2/server/settings.js`
  - `/Users/rileycoyote/clawd-luca/luca-terminal-v2/server/cli-agent-runtimes.js`
- Installed ACP bridge implementation: `/opt/homebrew/lib/node_modules/openclaw/dist/acp-cli-CXPY3ZDR.js`.
- Confirmed bridge behavior:
  - `session/new`, load, resume, list, and close capabilities are advertised.
  - OpenClaw reads `_meta.sessionKey` / `_meta.sessionLabel` per ACP session.
  - CLI-level `--session` / `--session-label` provide only bridge-wide defaults.
- Consequence: Luca's ACP client must add per-session `_meta` routing to let one resident bridge safely serve multiple Luca conversations. A single fixed CLI `--session` is not conversation-isolated.
- Degraded state observed: Gateway was stopped/unreachable, its service/CLI versions differed, and no live OpenClaw ACP turn could be proven. Discovery must report this precisely and must not start/update the Gateway automatically.

## 5. Upstream Buzz reuse map

Reference commit: `95fdf978` (`feat(acp): bring your own harness (BYOH)`).

### Port or adapt narrowly

- Backend `HarnessDefinition` shape (`id`, label, command, array args, bounded env, install guidance).
- Reserved-environment validation and ID-collision rejection.
- Loaded descriptor registry/warm-on-launch concept.
- Typed effective descriptor resolving command + args + layered env once for spawn, readiness, summaries, probes, and restart hash.
- Dangling-runtime error behavior; never silently fall back after an explicit binding disappears.
- PATH/readiness check for custom commands.

### Do not port wholesale

- Buzz settings gallery, logos, copy, presets, onboarding, or visible product surfaces.
- Remote/custom avatar behavior.
- Silent `buzz-agent` fallback semantics.
- Entire upstream commit or current main: local Luca authority/publication work has diverged, and upstream has continued refactoring since the BYOH commit.

## 6. Recommended implementation ownership

| Slice | Primary files | Avoid concurrent edits with |
|---|---|---|
| Descriptor/binding schema | `managed_agents/types.rs`, `discovery.rs`, new focused binding modules | spawn/supervision lane until serialized contract freezes |
| Spawn/env/readiness | `managed_agents/runtime.rs`, readiness modules, spawn hash | publication and frontend lanes |
| ACP protocol/session metadata | `crates/buzz-acp/src/acp.rs`, `pool.rs` | permission/attachment event normalization until method shapes freeze |
| Native discovery | new Hermes/OpenClaw adapter modules under `managed_agents/` | generic descriptor resolver only at agreed interfaces |
| Routing/publication extension | `luca_final_publisher.rs`, managed publisher/outbox/dispatch files | ACP transport and UI lanes |
| UX/import/readiness | `desktop/src/features/agents/` and onboarding/import surfaces | Rust schema until generated/serialized types freeze |
| Permission/activity/attachments | existing observer/activity and message/media modules plus narrow brokers | each other only after shared event vocabulary freezes |

## 7. M0 conclusion

The local branch is farther along than the handoff assumes. It already owns identity keys, ACP process supervision, managed final capture, authenticated publication, idempotency, and activity telemetry. The shortest safe route is therefore not G1-through-G7 as a greenfield sequence. It is:

1. freeze a generic runtime/binding descriptor;
2. add Hermes and OpenClaw exact native discovery;
3. add ACP v1/capability negotiation and per-session metadata;
4. prove one host-published DM and one room mention per native runtime;
5. then add durable lifecycle, permission, attachment, and wider multi-agent parity in bounded stages.
