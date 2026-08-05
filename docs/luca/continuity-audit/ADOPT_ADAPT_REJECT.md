# Cross-source adopt / adapt / reject matrix

This document reconciles the four source lanes into one component-level decision
map. It is an audit recommendation, not a product-scope freeze. Riley's explicit
decisions in `DECISION_LEDGER.md` remain higher authority.

## Authority map

| Product concern | Canonical authority | Supporting source |
|---|---|---|
| Conversation chronology and authorship | Signed Luca/Buzz relay events | Current Luca/Buzz event store and final publisher |
| Resident identity | Luca resident public key and desktop custody | Current resident registry, native semantic key, signing broker |
| Rich resident continuity | Encrypted, resident-bound Mnemos namespace | Standalone Mnemos continuity kernel |
| Portable current continuity | Encrypted NIP-AE Capsule projection | Buzz engram wire/crypto plus Luca typed broker policy |
| Owner universal brain | New owner-governed shared scope | Mnemos records/retrieval adapted through Luca authorization |
| Cognitive metabolism | Luca-owned durable jobs and reviewed proposals | Polyphonic hypomnema/reflection/consolidation behavior plus safe Mnemos maintenance |

These authorities must remain distinct. A room event is not a memory permission;
a Capsule is not the full brain; a model reflection is not cryptographic
identity; and an activity row is not proof that a durable continuity write
committed.

## Adopt

| Component | Source | Why it is safe and valuable to retain |
|---|---|---|
| Signed event chronology, reply graph, relay persistence | Current Luca/Buzz | Implemented, idempotent, signed, and already the working conversation plane. |
| Managed final publication and outbox reconciliation | Current Luca/Buzz | Gives the exact durable post-publication point from which continuity work may begin. |
| Resident public-key identity and semantic native import keys | Current Luca/Buzz | Separates stable identity from executable/model/runtime binding and is live for Hermes/OpenClaw. |
| Typed desktop signing authority with no raw key in ACP/model descendants | Current Luca/Buzz | Correct security boundary; extend only with allowlisted continuity operations. |
| NIP-AE encryption, blinded addresses, strict body parsing, signatures, and owner-readable records | Buzz core | Strong portable encrypted-record substrate with existing tests. |
| Continuity-failure-independent conversation harness | Current Luca/Buzz F10 | Must remain a permanent regression as continuity deepens. |
| Engram, connection, version, lineage, authorship, lifecycle, and scope concepts | Standalone Mnemos | Implemented and extensively tested continuity data model. |
| Exact resident/person/project scope checks | Standalone Mnemos | Concrete enforcement and tests already exist. Room scope must be added by Luca. |
| Hypomnema revision, supersession, archive, handoff, and delivery semantics | Standalone Mnemos | Best existing representation of a resident's bounded notebook and intentional carry-forward. |
| Bounded startup packet | Standalone Mnemos | Puts current handoff and a small continuity selection ahead of exhaustive history. |
| Agent-authored reflection/contradiction workflow | Standalone Mnemos | Preserves authorship instead of letting a sidecar impersonate the resident. |
| FTS seeds and bounded typed spreading activation | Standalone Mnemos | Real, tested associative recall rather than a placeholder. |
| Deterministic decay, softening, repair, and structural connection discovery | Standalone Mnemos | Useful safe maintenance that does not require an LLM. |
| Idempotent mutation envelope and replay ledger | Standalone Mnemos | Maps well to Luca's restart/idempotency discipline. |
| Layered fail-soft continuity packet and per-layer diagnostics | Polyphonic | Real integrated turn behavior and the right user-visible degradation model. |
| Primary versus observer hypomnema | Polyphonic | Preserves asymmetric participation instead of pretending every agent saw the same thing. |
| Salience gate, revision provenance, and explicit `no_change` | Polyphonic | Prevents every exchange from becoming durable identity. |
| Durable-memory candidate review boundary | Polyphonic captured `origin/main` | Rejects transcript-shaped, sensitive inferred, and duplicate candidates before shared durable memory. |
| Notebook composed from journals, reflections, beliefs, and accepted continuity | Polyphonic | A proven product surface for making continuity inspectable. |
| Import preview, stable identity mapping, provenance map, and deterministic rollback concepts | Polyphonic + legacy Luca | Strong recovery/import behavior when translated into domain objects. |
| Explicit no-memory mode, memory-scope UX, and honest degraded runtime status | Legacy Luca | Clear user control and accurate failure language. |
| ChatGPT, Claude, Luca, and Claude Code import parsers | Legacy Luca | Useful existing parser inventory, subject to isolated tests and stronger provenance. |
| Local-path ingestion rather than forced upload | Legacy Luca | Matches the local-first product and avoids wasteful data movement. |

## Adapt

| Component | Required Luca adaptation |
|---|---|
| Buzz ACP prompt lifecycle | Add typed request-bound continuity blocks at one pre-turn seam. Render memory as labelled untrusted data, never system authority. |
| Plain group-room replay | Bring bounded signed-history rehydration to normal group rooms; today it exists only for DMs and thread replies. |
| NIP-AE writes in managed mode | Add typed desktop broker encrypt/sign/decrypt operations. Never re-enable raw-key legacy memory in the managed harness. |
| Capsule history/current-head handling | Choose and prove either the existing managed conditional coordinator design or a deliberately single-writer V1 claim; generic LWW must not be marketed as atomic multi-device history. |
| Mnemos SQLite | Bind namespaces to resident public keys and add verified encryption for DB, WAL, backups, and exports. Filesystem modes alone are not encryption. |
| Mnemos recall | Authorize owner/resident/visibility/provider egress before retrieval. Turn preparation uses a read-only snapshot with reconsolidation off. |
| Reconsolidation | Retain as an explicit asynchronous maintenance mutation with receipts, never an implicit side effect of pre-turn recall. |
| Hypomnema writes | Replace hosted/fire-and-forget calls with durable jobs keyed by signed final event, resident, scope, epoch, and idempotency key. |
| Reflection authorship | Use the resident's own managed runtime when a record claims resident authorship. Sidecar/system synthesis is labelled as a proposal. |
| Polyphonic anti-rumination/social modulation | Port only pure gates/math into per-resident transactional state after core continuity is stable. |
| Universal brain | Build as a separate owner-controlled scope with explicit resident/project/room authorization and body-free retrieval receipts. Do not merge resident databases. |
| Import pipeline | Stage writes, support deterministic rollback, keep exact source event/thread IDs, treat imports as untrusted, and require explicit remote-extraction egress consent. |
| Backup/restore | Combine Mnemos integrity mechanics and Polyphonic provenance concepts into an authenticated encrypted domain-object archive bound to resident/owner identity. |
| Scheduler | Use Luca-owned persisted jobs aware of app lifecycle, sleep, power, budgets, cancellation, catch-up, and per-resident scope. |
| Embeddings | Keep optional. Default to local FTS/graph; require explicit consent and egress policy for hosted embeddings. |

## Reject

- Rebuilding or transplanting Buzz messaging into legacy Luca.
- Reintroducing a conductor or treating one resident as hidden authority over all
  others.
- Giving the ACP harness, model, tools, or descendants a resident private key or
  general signing capability.
- Treating upstream `core` system-prompt injection as Luca's continuity model.
- Using ACP `EndTurn` as proof of a final durable response.
- Treating team snapshots that mint new keys as identity recovery.
- Direct generic database reads with no owner/resident/egress snapshot.
- Pre-turn recall that writes access, reconsolidation, links, embeddings, or
  consolidation state.
- The current standalone Mnemos substrate tick, Dreaming/Wandering/Insight loop,
  global modulator/log files, or unscoped introspection as a production scheduler.
- Mnemos `SharedPool`, interaction-count-as-trust, and file-copy cross-agent bridge
  as Luca shared intelligence.
- Automatic transcript indexing or transcript-shaped durable engrams.
- Reading, copying, or inheriting Hermes/OpenClaw/provider credentials.
- Mutating native Hermes/OpenClaw schedules or configuration.
- Supabase Edge Functions, service-role orchestration, `pg_cron`, and OpenRouter-
  only execution as Luca's local architecture.
- Fire-and-forget continuity writes or realtime UI as persistence evidence.
- Database-row-shaped public archives.
- Legacy Luca's hardcoded `luca` owner, loopback privileged daemon, config-file
  API keys, partial imports, and substring fallback as the new authority model.
- Claims that local files are encrypted when they are only permission-hardened.
- Claims that Mnemos advanced stubs, Polyphonic's mock Group Session, or visible
  inner-life files are working production capabilities.

## Reconciliation of one apparent conflict

Mnemos and Polyphonic correctly use reconsolidation to let repeated recall shape
memory. Luca's security contract correctly forbids it during request-bound turn
preparation. These are compatible:

1. pre-turn context reads an immutable authorized snapshot and records only an
   ephemeral/body-free receipt;
2. after the response is durably published, a separately authorized background
   job may propose or commit reconsolidation using the exact recalled IDs;
3. that job is scoped, idempotent, cancellable, inspectable, and never delays or
   changes the conversation result.

This preserves cognitive behavior without making a read path an implicit write
authority.
