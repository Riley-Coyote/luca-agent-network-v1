# Luca/Buzz continuity seam audit

Status: complete source lane audit
Captured: 2026-08-04
Repository: `/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1`
Branch: `agent/runtime-reliability`
Commit: `6da9d059422cad9a692bb4660048240e829ca92a`
This report records the executable Luca/Buzz continuity substrate at the exact
revision above. It deliberately separates working source from design contracts.
No private data, local resident configuration, keys, journals, or conversation
bodies were inspected or copied.

## Executive verdict

The current product has a strong, tested **identity and conversation authority
plane**, but it does not yet have Luca-managed resident continuity beyond bounded
conversation replay:

- Stable resident public-key identity, native-runtime rebinding, signed message
  chronology, typed desktop signing, durable final-message publication,
  restart reconciliation, cancellation, and permission mediation are implemented.
- Buzz's NIP-AE engram crypto, relay storage, owner read surface, legacy ACP core
  bootstrap, and legacy CLI writes are implemented.
- **Luca-managed ACP deliberately disables upstream engram memory** because the
  managed harness receives no resident private key. Consequently the imported
  Hermes/OpenClaw residents used by Luca do not currently receive NIP-AE core
  continuity at session creation.
- Fresh ACP sessions receive bounded recent history only for DMs and thread
  replies. Plain group/channel turns do not perform the same history fetch.
- Continuity Capsules, the typed Capsule broker operations, conditional Capsule
  coordinator, Mnemos sidecar, policy overlay, immutable brain snapshot,
  pre-turn recall, checkpoints, hypomnema, reflection, consolidation, and inner
  life are specifications or future targets, not current executable product code.

The correct next architecture is therefore additive: retain signed Buzz events
as conversation chronology and Luca's desktop as authority; add a typed,
fail-soft continuity plane beside it. Do not treat upstream engrams as the whole
brain, do not inject recalled content into the system-authority prompt, and do
not checkpoint before the final signed response is durably published.

## Status classification

| Capability | Status | Evidence and qualification |
|---|---|---|
| Stable resident cryptographic identity | **Implemented** | The registry is a public-only projection of the keychain-backed managed store and separates runtime/model binding from identity (`desktop/src-tauri/src/luca/resident_registry.rs:1-9,36-58,108-149`). Luca-safe creation revalidates bindings, reuses identities, and zeroizes the temporary legacy nsec before returning to the renderer (`resident_registry.rs:419-497`). |
| Native Hermes/OpenClaw semantic identity | **Implemented** | Discovery is read-only (`desktop/src-tauri/src/managed_agents/native_runtime.rs:1-5`). Hermes identity is canonical home plus profile; OpenClaw identity is gateway identity plus exact agent ID; executable/version belong to a separate binding fingerprint (`native_runtime.rs:206-257`). The refresh invariant has a focused test (`native_runtime.rs:907-931`). |
| Resident key custody | **Implemented with declared fallback risk** | Managed mode gives ACP only public identity and a typed broker, never a secret (`crates/buzz-acp/src/config.rs:56-70,93-117`). Desktop prefers the system keyring; if unavailable, compatibility storage can retain an nsec in an owner-only `0o600` JSON fallback (`desktop/src-tauri/src/managed_agents/storage.rs:14-31,102-165`; `resident_registry.rs:7-9`). Spawn fails closed when the key is unavailable (`storage.rs:151-165`). |
| Signed conversation chronology | **Implemented** | Relay ingest verifies signed events, bounds time/content, and requires event author to match authenticated identity (`crates/buzz-relay/src/handlers/ingest.rs:1427-1503`). Postgres retains event ID, author, timestamp, kind, tags, content and signature idempotently (`crates/buzz-db/src/event.rs:237-295`). Managed final publication freezes one kind-9 response and routes it from the exact signed trigger, not model-selected routing (`crates/buzz-acp/src/luca_final_publisher.rs:1-6,117-204`). |
| Durable final publication/restart reconciliation | **Implemented** | Relay acceptance is the dispatch linearization point, followed by durable outbox finalization (`desktop/src-tauri/src/luca/managed_dispatch_store.rs:898-977`; `managed_message_publisher.rs:274-315`). Prior-epoch work becomes `Interrupted(Restart)` only after frozen outbox reconciliation (`managed_dispatch_store.rs:28-80,515-553`). |
| NIP-AE engram crypto and validation | **Implemented** | I/O-free NIP-44 crypto, HMAC-blinded slug address, strict body parsing, signed kind 30174 construction, decrypt/validate, LWW head selection, monotonic timestamps and reference extraction exist (`crates/buzz-core/src/engram.rs:1-8,133-250,369-473,475-588`). |
| Engram relay persistence and owner/agent reads | **Implemented with privacy caveat** | Engrams are parameterized replaceable events in normal relay ingest (`crates/buzz-relay/src/handlers/ingest.rs:2362-2384`). Global filters are gated to author-self or `#p` owner-self (`crates/buzz-relay/src/handlers/req.rs:174-205,1078-1129`). The desktop owner read command verifies ownership, signatures, decryption, grouping and heads (`desktop/src-tauri/src/commands/engrams.rs:1-19,74-99,105-179,187-274`). |
| Engram writes | **Implemented only in legacy/snapshot paths** | `buzz mem` reads the prior head, applies monotonic time, signs with raw legacy agent keys and publishes (`crates/buzz-cli/src/commands/mem.rs:305-370,683-735`). Team snapshot import mints fresh agent keys and best-effort restores entries as signed kind 30174 events (`desktop/src-tauri/src/commands/team_snapshot.rs:475-496,773-825,893-927`). These are not a Luca-managed continuity write authority. |
| Legacy ACP core bootstrap | **Implemented for non-managed Buzz only** | A new session fetches and decrypts `core`, distinguishes confirmed absence from failure, and never blocks session creation (`crates/buzz-acp/src/engram_fetch.rs:1-12,31-90,93-163`; `pool.rs:1430-1486`). It caches until session invalidation. |
| Luca-managed engram bootstrap | **Intentionally absent** | Managed identity has no legacy keys (`crates/buzz-acp/src/config.rs:93-117`), and configuration explicitly disables `memory_enabled` in managed mode (`config.rs:1138-1185`). `PromptContext.agent_keys` receives only legacy keys (`crates/buzz-acp/src/lib.rs:1600-1641`). Therefore the core-fetch gate cannot run for Luca-managed residents (`pool.rs:1450-1455`). |
| Bounded signed-history rehydration | **Implemented but partial** | Per-turn context is bounded by `context_message_limit`; failures time out/retry and degrade to none (`crates/buzz-acp/src/pool.rs:731-737,2617-2652`). It fetches thread context or recent DM history; plain channel/group messages return no history (`pool.rs:2617-2652`). Rendering includes signed actor, timestamp and content in a bounded labeled block (`crates/buzz-acp/src/queue.rs:1336-1368`). This is conversational replay, not resident hypomnema or a durable native ACP session restore. |
| Continuity-independent conversation failure isolation | **Implemented** | The F10 harness drives production dispatch, signing broker and exact outbox with Capsule, sidecar, and Mnemos all absent (`desktop/src-tauri/src/luca/reliability_f10.rs:1-6,265-388`; `tests/luca-conformance/f10/continuity_absent.json:1-16`). Normal publication succeeds and cancelled publication stays cancelled. |
| Capsule schema/read/write/coordinator | **Planned** | The six-segment schema, 32 KiB render budget, typed write authority, managed conditional commit, read validation and per-turn/session rendering are detailed in `.codex/luca-v1/CAPSULE_IMPLEMENTATION_SPEC.md:1-31,33-46,111-141,184-207`. `crates/luca-capsule/` and the coordinator implementation do not exist. |
| Mnemos continuity sidecar and pre-turn recall | **Planned** | The exclusive-pipe service, operations, access truth table, `context.prepare.v1`, deadlines, receipts, immutable snapshot, and fail-soft behavior are specified (`.codex/luca-v1/BRAIN_AND_CONTINUITY_SERVICE_SPEC.md:1-46,48-104,123-214,266-324`). `services/luca-continuity/`, `continuity_child.rs`, `policy_overlay.rs`, and `brain_snapshot.rs` do not exist. |
| Post-turn checkpoint, hypomnema, reflection, consolidation, inner life | **Planned / deferred** | Current code has no checkpoint protocol/store or resident journal engine. The Capsule contract permits digest/thread proposals after a validated checkpoint (`CAPSULE_IMPLEMENTATION_SPEC.md:111-123`), while the source map explicitly assigns consolidation/reflection to a later release (`.codex/luca-v1/SOURCE_MAP_LOCKED.md:68-89`). |

## Reusable component map

### 1. Conversation and authorship substrate — adopt

- **Canonical chronology:** keep signed kind-9 Buzz/Luca events and their relay
  event IDs as the source of message order, authorship, reply roots, and
  checkpoint provenance. The generic event store is already idempotent and
  replayable (`crates/buzz-db/src/event.rs:237-302`).
- **Managed final handoff:** `ManagedFinalTurn` derives immutable routing from
  the exact owner trigger and produces one typed publication request
  (`crates/buzz-acp/src/luca_final_publisher.rs:117-223`).
- **Post-publication durability:** the combination of
  `ManagedMessagePublisher::mark_accepted`, the dispatch store's `Published`
  state, and `outbox_finalized=true` is the first trustworthy point from which a
  checkpoint job may be scheduled (`desktop/src-tauri/src/luca/managed_message_publisher.rs:274-315`; `managed_dispatch_store.rs:898-962`).
- **Failure contract:** continuity must remain optional. The existing F10
  continuity-absent harness should become a permanent regression for every new
  pre-turn and post-turn component (`desktop/src-tauri/src/luca/reliability_f10.rs:265-388`).

### 2. Resident identity and custody — adopt, extend through typed operations

- The durable resident identity is its public key. Runtime/model/provider are
  replaceable bindings (`desktop/src-tauri/src/luca/resident_registry.rs:36-58`).
- Native import identity already survives runtime executable/version updates
  (`desktop/src-tauri/src/managed_agents/native_runtime.rs:230-257`).
- The desktop signing broker deliberately exposes only two current operations:
  relay authentication and managed message publication
  (`desktop/src-tauri/src/luca/signing_broker.rs:116-125,225-246`). It is the
  correct authority boundary to extend with narrowly typed Capsule
  encrypt/sign/decrypt operations; it must never grow a generic signer.
- `crates/luca-protocol` currently exports only canonicalization, diagnostics,
  frames, IDs, permissions, message publication, owner identity, and relay auth;
  it explicitly contains no continuity behavior (`crates/luca-protocol/src/lib.rs:1-53`).

### 3. NIP-AE crypto and wire format — adopt as portable encrypted substrate

Reuse:

- NIP-44 agent/owner shared key derivation;
- HMAC-blinded `d` tag so the slug is not public;
- strict duplicate-key rejection and body validation;
- outer signature verification before decryption;
- monotonic timestamp and deterministic head selection;
- encrypted kind 30174 envelope and owner-readable semantics.

Sources: `crates/buzz-core/src/engram.rs:133-250,430-588` and
`docs/nips/NIP-AE.md:47-86,109-140`.

Do **not** mistake this for a complete continuity engine. NIP-AE explicitly
excludes provenance, trust levels, attention, working sets and rich taxonomies
(`docs/nips/NIP-AE.md:78-86`). It provides encrypted portable records, not
conditional multi-record commits, history, admission policy, retrieval,
consolidation, or inner life.

### 4. Prompt lifecycle — narrow integration seam

Current lifecycle:

1. Resolve/create an in-memory ACP session.
2. Optionally fetch upstream core at new-session creation.
3. Fetch bounded thread/DM conversation context.
4. Construct labeled prompt blocks.
5. Call ACP and capture the final message.
6. On `EndTurn`, hand the final to desktop publication authority.

Sources: `crates/buzz-acp/src/pool.rs:1318-1329,1430-1486,1800-1932,2106-2166`.

The reusable seams are `PromptContext` (`pool.rs:430-486`) and
`FormatPromptArgs` / `format_prompt` (`queue.rs:1371-1429`). Add typed fields for
the already-authorized Capsule and Mnemos context; do not overload
`agent_core`, `system_prompt`, canvas, or raw event text.

## Recommended integration seams

### Pre-turn: typed, request-bound, untrusted context blocks

Add one application-owned pre-turn coordinator after the responder, trigger,
conversation, provider boundary and current policy revision are resolved, but
before `session_prompt_blocks_with_idle_timeout` is called.

Recommended data flow:

1. Desktop resolves opaque owner/resident/profile/provider-policy handles.
2. A private, epoch-bound continuity channel requests:
   - verified Capsule slow state (on fresh ACP session);
   - current fast digest and open threads (every turn);
   - authorized Mnemos recall (every turn, only when useful).
3. The result returns typed state plus bounded rendered text and a body-free
   receipt. Timeout, unavailable, locked, invalid, or stale all produce visible
   degraded state while the original turn proceeds.
4. ACP adds each result as its own labeled **untrusted continuity data** block,
   between conversation context and triggering event. No recalled body is put in
   the system prompt, observer archive, crash log, or general cache.
5. Desktop reauthorizes the complete outbound provider request immediately
   before transport against the same resident/runtime/provider/policy snapshot.

Why not reuse upstream `agent_core` unchanged: for protocol-v2 ACP agents the
current core is appended to `session/new`'s `systemPrompt`
(`crates/buzz-acp/src/pool.rs:752-796,1186-1197`). Luca's security model says
Capsule plaintext and Mnemos records are untrusted for authority and must be
declarative labeled blocks (`.codex/luca-v1/SECURITY_THREAT_MODEL.md:14-41`).
Persisted or retrieved text must never gain system-level precedence merely by
being called memory.

### Fresh-session continuity: keep history and hypomnema distinct

- Preserve the existing signed thread/DM context as a short chronology replay.
- Extend plain multi-agent rooms to fetch a similarly bounded signed history;
  current plain channel turns return no conversation context
  (`crates/buzz-acp/src/pool.rs:2617-2652`).
- Load stable resident identity, current first-person hypomnema, relationship,
  convictions, current digest and unresolved threads as distinct labeled layers.
- Do not claim native ACP transcript restoration unless a runtime actually proves
  it. A fresh provider session rehydrated from Luca-owned evidence is honest and
  sufficient.

### Post-turn: checkpoint only after durable publication

The ACP `EndTurn` callback is too early to be the checkpoint commit trigger: the
captured draft can still be denied, cancelled, unavailable, or fail relay
publication (`crates/buzz-acp/src/pool.rs:1247-1303`). Schedule checkpoint work
only after desktop records the exact final event as `Published` and finalizes the
encrypted outbox (`desktop/src-tauri/src/luca/managed_message_publisher.rs:274-315`).

Recommended key and ordering:

1. `checkpoint_id = H(final_signed_event_id, resident_pubkey, policy_revision)`.
2. Conversation response is already visible and independent.
3. An asynchronous, durable, bounded job extracts conservative proposals with
   exact source event IDs and explicit `no_change`.
4. Deterministic validation may update current digest/open threads. Durable
   self/relationship/conviction changes remain owner-reviewed.
5. The desktop broker signs allowlisted Capsule candidates; a conditional commit
   path decides current heads; body-free receipts update health.
6. Failure, timeout, cancellation, conflict, or sidecar death never retracts or
   delays the message.

This preserves the current exactly-once publication logic and gives later
reflection/consolidation an evidence-backed input rather than an ACP draft.

## Security constraints that must remain non-negotiable

1. **Memory is data, not authority.** Capsule and Mnemos text cannot add tools,
   change approvals, select providers, change budgets, widen sharing, or request
   arbitrary signatures (`.codex/luca-v1/SECURITY_THREAT_MODEL.md:30-41,206-224`).
2. **Per-resident authorization before retrieval.** Cross-agent sharing is an
   app policy decision, recomputed for every responder, with unknown/ambiguous
   state denied (`SECURITY_THREAT_MODEL.md:43-62`; `BRAIN_AND_CONTINUITY_SERVICE_SPEC.md:48-104`).
3. **No raw resident key in ACP/model descendants.** The managed public-identity
   boundary is already correct and must not be weakened to make `buzz mem`
   convenient (`SECURITY_THREAT_MODEL.md:64-88`; `crates/buzz-acp/src/config.rs:56-70`).
4. **No general sidecar endpoint.** Continuity IPC is exclusive desktop-owned
   pipes with epoch, sequence, byte and deadline bounds; no listener, bearer
   token, arbitrary search or SQL (`BRAIN_AND_CONTINUITY_SERVICE_SPEC.md:10-46`).
5. **No synchronous continuity write in a turn.** Pre-turn preparation is
   read-only and request-bound; recall must not mutate access, embeddings,
   consolidation or source Mnemos state (`BRAIN_AND_CONTINUITY_SERVICE_SPEC.md:295-324`).
6. **No body leakage.** Model-facing provenance uses safe labels/opaque IDs;
   receipts, logs, observer frames, crash artifacts and general caches exclude
   recalled bodies and local paths (`BRAIN_AND_CONTINUITY_SERVICE_SPEC.md:194-214`).
7. **Conversation survives every continuity fault.** This is already a mandatory
   security gate and an executable test principle (`SECURITY_THREAT_MODEL.md:206-227`; `reliability_f10.rs:265-388`).

## Gaps and risks

### Critical build gaps

1. **Managed residents have no encrypted continuity read or write path.** Managed
   mode disables upstream memory and holds no keys. A new typed broker/capsule
   client path is mandatory; enabling `memory_enabled` or injecting the nsec
   would violate the custody architecture.
2. **No Capsule protocol crate or broker operations exist.** Targets named in
   `.codex/luca-v1/TARGET_CODE_MAP.md:20-58` are partly absent, including
   `crates/luca-capsule/` and the continuity-specific signing operations.
3. **No Mnemos service exists in this repository.** All targets in
   `TARGET_CODE_MAP.md:64-77` are absent.
4. **No durable checkpoint scheduler/store exists.** `checkpoint_dispatch.rs`
   and `checkpoint_store.rs` are absent; ACP EndTurn is not an acceptable
   substitute for published-event finality.
5. **Group history rehydration is incomplete.** DMs and replies fetch bounded
   context, but a plain room does not. This can make a restarted multi-agent room
   feel discontinuous even before Mnemos exists.

### Security and privacy risks to resolve during design

1. **Legacy core prompt precedence.** Upstream core is free-form and inserted in
   `systemPrompt` for modern ACP. That is acceptable only as a legacy Buzz
   behavior, not as the Luca continuity rendering model.
2. **Explicit-event-ID engram read exemption.** Relay filter authorization lets
   any authenticated caller query an engram by explicit event ID
   (`crates/buzz-relay/src/handlers/req.rs:1091-1105`). Ciphertext remains
   encrypted, but envelope metadata and write activity leak. Capsule pointers and
   receipts will make IDs more likely to circulate, so managed Capsule reads
   should require author/owner authorization even for exact IDs or use a stricter
   coordinator endpoint.
3. **NIP-AE metadata leak and replacement history.** Public author/owner/timestamp
   links remain visible and generic addressable relays may discard old versions
   (`docs/nips/NIP-AE.md:9-15,156-163`). The planned encrypted local archive and
   managed conditional commit are necessary before claiming authoritative
   history, rollback, or conflict safety.
4. **Compatibility key fallback.** Owner-only `0o600` JSON is not equivalent to
   keychain encryption. Public privacy language and distribution gates must state
   the real storage guarantee.
5. **Team snapshot memory restore is not identity recovery.** It mints fresh keys
   and best-effort republishes plaintext snapshot bodies under new identities
   (`desktop/src-tauri/src/commands/team_snapshot.rs:475-496,773-825`). Do not
   reuse it for resident Capsule portability or describe it as continuity backup.
6. **Current desktop memory UI is read-only and best-effort.** It caps relay
   results and cannot prove complete history. It is useful inspection UX, not a
   commit authority (`desktop/src-tauri/src/commands/engrams.rs:28-37,187-274`).

## Existing relevant tests and fixtures

- `crates/buzz-core/src/engram.rs` tests: key/d-tag vectors, strict JSON,
  encryption round trip, body size, head selection, monotonic time, references.
- `crates/buzz-acp/src/engram_fetch.rs` tests: confirmed absence, unreadable
  candidates, wrong body, valid core.
- `desktop/src-tauri/src/luca/reliability_f10.rs`: conversation publication and
  cancellation with every continuity component absent.
- `desktop/src-tauri/src/managed_agents/native_runtime.rs`: semantic resident
  identity stable while runtime binding fingerprint changes.
- `tests/luca-conformance/f10/continuity_absent.json`: language-neutral absence
  fixture.
- `.codex/luca-v1/CAPSULE_IMPLEMENTATION_SPEC.md:225-246` and
  `.codex/luca-v1/BRAIN_AND_CONTINUITY_SERVICE_SPEC.md:362-383`: required future
  continuity security/conformance proofs; these are test requirements, not
  evidence that the behavior exists.

## Commands executed

Read-only inspection used `rg`, `find`, `git status`, `git branch --show-current`,
`git rev-parse HEAD`, and line-numbered `sed`/`nl` over the paths cited above.

Focused tests executed from the Hermit environment:

```text
cargo test -p buzz-core engram --lib
  PASS: 34 passed, 0 failed

cargo test -p buzz-acp engram_fetch --lib
  PASS: 5 passed, 0 failed

cargo test --manifest-path desktop/src-tauri/Cargo.toml \
  luca_f10_real_publication_and_dispatch_cancellation_survive_total_continuity_absence --lib
  PASS: 1 passed, 0 failed

cargo test --manifest-path desktop/src-tauri/Cargo.toml \
  semantic_identity_survives_binding_refresh_while_fingerprint_changes --lib
  PASS: 1 passed, 0 failed
```

No full-repository CI, live-agent mutation, relay mutation, native configuration
mutation, or product-source change was performed in this audit lane.

## Suggested build order from this lane

1. Freeze the narrow Continuity V1 product boundary using the cross-repository
   audit: stable resident, bounded first-person hypomnema, current digest/open
   threads, scoped read-only Mnemos recall, post-publication checkpoint, and
   owner review. Keep autonomous consolidation/inner life out of the messaging
   critical path.
2. Add language-neutral continuity/access/checkpoint vectors and Rust protocol
   types before any service or UI work.
3. Add the private continuity child transport and a fake sidecar. Prove every
   failure state while F10 still passes.
4. Add typed Capsule broker operations and managed read/cache without exposing
   keys or copying legacy system-prompt precedence.
5. Add per-turn context preparation and plain-room bounded history rehydration.
6. Add post-publication checkpoint scheduling keyed by final signed event ID.
7. Integrate the audited Mnemos and Polyphonic components behind the frozen
   policy/IPC boundary; then add review, health, provenance, and later background
   cognitive layers incrementally.
