# Locked Source and Reuse Map

Line numbers are orientation aids. Paths and symbols at the recorded commits are
the durable coordinates. Current Luca, Mnemos and Polyphonic checkouts remain
read-only evidence sources.

## Source snapshots

| Source | Path | Snapshot | M0 state |
|---|---|---|---|
| Buzz | `/Users/rileycoyote/Documents/Codex/2026-07-21/will-you-look-into-this-new/work/buzz` | `7e34bee62cacaa9d8a96c14d5892a471b59a1983` | clean |
| Luca v2 | `/Users/rileycoyote/clawd-luca/luca-terminal-v2` | `c0aca265c91e73607dada86303833605beed32cc` | clean; branch ahead of remote |
| Mnemos | `/Users/rileycoyote/Documents/Repositories/mnemos` | `bd394748cd3cc0175e3bc31b27148a4760972b57` | substantial pre-existing user changes |
| Polyphonic v2 | `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-v2` | `91bda36be79895c2be27cfa059bf1eae03bece3b` | substantial pre-existing user changes |

## Buzz - adopt

| Capability | Coordinates | V1 use |
|---|---|---|
| NIP-AE wire/crypto/head rules | `docs/nips/NIP-AE.md`; `crates/buzz-core/src/engram.rs` | Adopt protocol validation and vectors; layer Luca schema/commit pointer over it |
| ACP engram bootstrap | `crates/buzz-acp/src/engram_fetch.rs`; `crates/buzz-acp/src/pool.rs` session creation around `1206+` | Slow Capsule load at fresh session |
| Turn prompt seam | `crates/buzz-acp/src/pool.rs` around `1680-1732`; `crates/buzz-acp/src/queue.rs::format_prompt` | Fast Capsule plus fail-soft brain context before runtime prompt |
| Turn IDs/liveness/completion | `crates/buzz-acp/src/pool.rs`; `crates/buzz-acp/src/observer.rs` | Preserve turn identity and visible lifecycle; add durable Luca receipts |
| Queue/replay/cancel | `crates/buzz-acp/src/queue.rs`; `relay.rs`; `pool.rs` | Conversation foundation and regression surface |
| Same-owner agent messages | `crates/buzz-acp/src/lib.rs::author_allowed`; `is_owner_or_sibling`; desktop `managed_agents/types.rs::RespondTo`; runtime `build_respond_to_env` | Existing author gate accepts cryptographically verified same-owner siblings even in owner-only mode; adapt mention/dispatch with root causal limits |
| Personas/residents | `crates/buzz-persona/`; `docs/nips/NIP-AP.md`; `desktop/src-tauri/src/managed_agents/`; `commands/personas/`; `desktop/src/features/agents/` | Three directly addressable residents; no conductor |
| Rooms/threads/messages/search/media | relay crates plus desktop feature modules | Preserve as conversation plane |
| Activity/archive UI | `desktop/src-tauri/src/archive/`; `commands/observer_archive.rs`; `desktop/src/features/local-archive/` | Adapt safe activity states; do not treat process-local observer data as durable checkpoint receipt |
| Key custody | `desktop/src-tauri/src/secret_store.rs`; `managed_agents/storage.rs`; ACP environment construction | Retain OS keyring/fail-closed patterns, but replace raw ACP environment injection with a structured desktop signing broker before any identity claim ships |
| Human identity recovery | `commands/identity.rs::get_nsec`; `import_identity`; pairing modules | Reuse same-owner recovery concepts; replace plaintext export UX with protected file |
| Graceful process cleanup | `desktop/src-tauri/src/shutdown.rs`; `managed_agents/process_lifecycle.rs`; `lib.rs` Exit path | Preserve and regression-test Quit behavior |

## Buzz - adapt or explicitly reject

| Capability | Evidence | Decision |
|---|---|---|
| Core cached for channel session | `engram_fetch.rs`; `pool.rs` | Keep for slow segments; add per-turn fast pointer/pair load |
| Process-local observer buffer | `crates/buzz-core/src/observer.rs` and ACP observer pipeline | Cannot prove crash-durable checkpoint completion; add durable local receipt/outbox |
| Agent/team snapshots | `managed_agents/agent_snapshot.rs`; `team_snapshot.rs`; `commands/team_snapshot.rs` | Keep as secret-free templates. Import deliberately mints new keys; never call this identity backup/restore |
| Team import fresh identities | `commands/team_snapshot.rs:475-546` | Preserve semantics; build separate protected resident backup/restore |
| Identity archive | `commands/identity_archive.rs` | Lifecycle/deactivation evidence only, not a portable agent key archive |
| Workflows/schedules | `crates/buzz-workflow/`; desktop workflow modules | Hide/disable as Luca V1 product behavior; preserve upstream compatibility |
| Relay topology | relay deploy/compose configuration | Managed Luca relay for V1; add a conditional Capsule coordinator and operator backup/restore/outage evidence; embedded relay is later work |

## Luca v2 - extract/adapt

| Capability | Coordinates | V1 use |
|---|---|---|
| Source discovery | `server/memory-knowledge.js:286-396` | Adopt opt-in local source inventory |
| Provenance-rich import | `server/memory-knowledge.js:569-635,728-730` | Adapt one folder/notes corpus path and normalize metadata |
| Garden isolation/read-only SQLite | `server/memory-knowledge.js:445-473,733-765` | Reuse explicit isolated DB/read-only connection pattern |
| Scope selection | `server/memory-knowledge.js:768-834` | Adapt profile/garden preference; never make project authority |
| Direct FTS | `server/memory-engine-daemon.mjs:243-274,485-507` | Reuse query shape behind immutable, authenticated service |
| Fail-soft bridge | `server/luca-memory.js:212-238,256-313` | Preserve send-without-memory behavior |
| Supervisor | `server/daemon-supervisor.mjs:38-59,161-269` | Adapt spawn/health/backoff/stop; tighten health to explicit success |
| Runtime/profile resolution | `server/brain-runtime-status.js:55-71` | Fold into one V1 authenticated resolver |

## Luca v2 - do not use in turn critical path

| Capability | Coordinates | Reason |
|---|---|---|
| JS store constructor | `lib/mnemos/store.mjs:293-418` | Creates directories/schema/meta/WAL and violates strict zero-write |
| Rich JS default retrieval | `lib/mnemos/retriever.mjs:151-267` | Reconsolidation is enabled by default and writes |
| Compatibility folder ingest | `server/memory-engine-daemon.mjs:292-356` | Hardcoded Luca owner; drops title/path/project provenance |
| Existing background tasks | `server/background-tasks.js` | Marks interrupted work after restart; not exactly-once infrastructure |
| Current agent comms | `public/js/agent-comms.js`; `public/js/sub-agents.js` | Replaced by Buzz conversation plane |

## Mnemos - adapt behind service

| Capability | Coordinates | V1 use |
|---|---|---|
| Canonical schema/store | `mnemos/store/sqlite_store.py` | Canonical writes/ingestion reference; add separate immutable reader |
| FTS/embedding/ranking data | store and `mnemos/store/embedding_index.py` | Retrieve only from preauthorized candidates with no mutation |
| Rich retrieval | `mnemos/retrieval/reactive.py:76-260` | Never default in turn path; behavior reference with reconsolidation off |
| Scope | `mnemos/simple_scope.py:40-93`; `simple_runtime.py:1119-1164` | Adapt fields but authorize before hydration/ranking |
| Functional title | `sqlite_store.py:168-190,793-824`; `interface/context_packet.py:125-137` | Preserve title plus `(untitled)` fallback |
| Consolidation/reflection | `mnemos/consolidation/daemon.py`; `decay.py`; `reflection.py` | Release 2 engine; no synchronous V1 dependency |

Mandatory regressions from M0:

- default rich retrieval writes access/reconsolidation/version state;
- a wrong-project Python retrieval currently withholds text only after mutating
  the hidden record;
- current archive tables/search omit owner/person/project/visibility and an
  owner predicate;
- consolidation logs lack direct resident identity;
- current schemas do not implement V1 visibility plus `local_only`.

Archived rows are therefore excluded from V1 agent recall.

## Polyphonic - behavior only

| Behavior | Coordinates | Extract |
|---|---|---|
| Conservative salience | `supabase/functions/_shared/mnemos/salience.ts` | Pure qualification shape and fixtures |
| Explicit abstention | Hypomnema salience prompt; `anima-consolidate`; `anima-reflect` prompts | `no_change` is valid; never manufacture significance |
| Revision provenance | `_shared/hypomnema/write.ts::writeHypomnemaEntry` | Source-event lineage pattern |
| Layered degradation | `_shared/continuity/kernel.ts::loadContinuityPacket`; `loadLayer` | Typed partial failure, with stricter deadlines/statuses |
| Post-turn ordering | `_shared/continuity/write.ts`; chat call sites | Response before continuity, but replace fire-and-forget topology |
| Basic uniqueness idea | `_shared/continuity/jobs.ts`; related migration | Replace with local lease/epoch/outbox plus managed conditional-commit state machine |
| Bounded continuation ideas | `subagent-run/index.ts` | Future reference only; Keep Thinking excluded after the failed Orphan gate |

Do not transplant Supabase Edge Functions, service-role access, OpenRouter
coupling, `pg_cron`, fire-and-forget writes, broad consolidation or current job
finalization. Several useful Polyphonic refinements are uncommitted user work;
their hashes are preserved in M0 evidence and they are design evidence only.

## Licenses

- Buzz: Apache-2.0; retain license, copyright/attribution and modification
  notices, and avoid implying an official Block product.
- Mnemos: MIT; retain notice for substantial reused/distributed portions.
- Luca/Polyphonic: Riley-owned sources; confirm final license for new Luca code
  before public distribution.
