# Target Code and Ownership Map

This map freezes where new Luca-owned code belongs before implementation. It is
normative for worktree ownership; exact filenames may be refined only by an
integrator ADR without changing authority boundaries.

## Shared schemas and conformance

| Target | Responsibility | Sole owner |
|---|---|---|
| `schemas/luca/` | JSON schemas, RFC 8785 rules/vectors, safe diagnostic schemas, protocol fixtures | lead/integrator |
| `crates/luca-protocol/` | Rust wire types, canonicalization, IDs/hashes, dispatch snapshots, policy and receipt conformance | lead/integrator |
| `crates/luca-diagnostics/` | shared secret/body/path redaction and artifact-scan primitives | security lane, reviewed by lead |
| `tests/luca-conformance/` | language-neutral golden vectors consumed by Rust/Python/TypeScript | protocol lane, merged by lead |

No language hand-translates another language's contract. All implementations
must pass the same checked-in vectors for duplicate keys, canonical bytes,
hashes, signatures, size limits and failure codes.

## Desktop authority plane

| Target | Responsibility |
|---|---|
| `desktop/src-tauri/src/luca/signing_broker.rs` | keychain-owned typed sign/encrypt/decrypt operations and policy validation |
| `desktop/src-tauri/src/luca/signing_transport.rs` | authenticated per-agent broker channel, sequence/expiry/session/PID binding |
| `desktop/src-tauri/src/luca/local_broker_session.rs` | desktop-local resident/owner/ACP PID/session/relay binding for the G1 broker channel; not remote installation admission |
| `desktop/src-tauri/src/luca/managed_message_outbox.rs` | frozen final-event idempotency, relay-ACK reconciliation and body-free receipts |
| `desktop/src-tauri/src/luca/resident_registry.rs` | resident/persona/runtime/provider bindings and active state |
| `desktop/src-tauri/src/luca/continuity_child.rs` | exclusive framed sidecar pipes, supervision and deadlines |
| `desktop/src-tauri/src/luca/dispatch_policy.rs` | provider snapshots and final semantic-request egress guard |
| `desktop/src-tauri/src/luca/checkpoint_dispatch.rs` | provider call for bounded checkpoint requests through the same final egress guard |
| `desktop/src-tauri/src/luca/audit_store.rs` | body-free post-dispatch audit receipts |
| `desktop/src-tauri/src/luca/checkpoint_store.rs` | lease/epoch/idempotency/outbox/recovery state |
| `desktop/src-tauri/src/luca/causal_store.rs` | SQLite root ledger, reservations, cancellation epochs and reconciliation |
| `desktop/src-tauri/src/luca/policy_overlay.rs` | legacy Mnemos record policy overlay and revisions |
| `desktop/src-tauri/src/luca/brain_snapshot.rs` | explicit immutable Mnemos plus policy snapshot refresh, manifest and atomic activation |
| `desktop/src-tauri/src/luca/owner_identity_recovery.rs` | protected owner key export/import without webview or ACP exposure |
| `desktop/src-tauri/src/luca/resident_backup.rs` | protected export and journaled restore saga |

The desktop broker is the only process holding resident signing keys. Existing ACP/CLI
paths that require raw keys are broker-adapted or disabled for V1.

## ACP/runtime integration

| Target | Responsibility |
|---|---|
| `crates/luca-signing-client/` | typed broker client for Buzz ACP host; never exports a general signer to the model child |
| `crates/luca-capsule/` | Capsule validation/read cache, managed coordinator client, encrypted outbox/archive |
| `crates/buzz-acp/src/luca_final_publisher.rs` | aggregate ACP message chunks into one policy-checked final signed/published room event |
| `crates/buzz-acp/src/config.rs` | select unchanged legacy key mode or Luca managed public-identity/broker mode |
| `crates/buzz-acp/src/relay.rs` | route managed NIP-42/NIP-98 authentication through the typed broker while preserving legacy key signing |
| `crates/buzz-acp/src/pool.rs` | use public identity in managed mode and explicitly disable/defer untyped key-dependent side effects |
| `crates/buzz-acp/src/setup_mode.rs` | preserve setup-listener behavior through the same identity abstraction without a raw managed key |
| `crates/buzz-acp/src/queue.rs` and managed prompt | remove key-backed CLI publication instructions only in Luca managed mode |
| `crates/buzz-acp/` narrow seams | slow session bootstrap, fast per-turn context, provider dispatch snapshot and guarded room hooks |

Edits to upstream crates remain narrow and covered by the untouched baseline
regression suite. Luca code owns new policy and persistence.

`crates/buzz-acp/src/luca_final_publisher.rs` remains F09-owned. F14 supplies
the broker/authentication foundation; F09, which depends on F14, supplies the
one-final-message adapter and its conversation proofs.

## Local Continuity Service

| Target | Responsibility |
|---|---|
| `services/luca-continuity/` | Python 3.10+ service, framed pipe loop and canonical Mnemos adapter |
| `services/luca-continuity/luca_continuity/access.py` | pure authorization/relevance function |
| `services/luca-continuity/luca_continuity/retrieval.py` | prefiltered immutable reader |
| `services/luca-continuity/luca_continuity/snapshot.py` | manifest-selected snapshot reader and revision/staleness validation |
| `services/luca-continuity/luca_continuity/ingestion.py` | explicit staged folder ingest |
| `services/luca-continuity/luca_continuity/checkpoint.py` | bounded unsigned proposal/abstention |
| `services/luca-continuity/packaging/` | pinned PyInstaller onedir recipe, licenses and clean-machine proof |

The service opens no listener and writes no turn receipt. Explicit ingestion is
the only V1 service operation allowed to mutate Mnemos.

## Managed relay additions

| Target | Responsibility |
|---|---|
| relay Luca coordinator module | conditional slow/fast Capsule commits, active writer epochs, idempotency and durable receipts |
| relay migration owned by integrator | row/unique constraints, commit/outbox records and operator-safe schema |
| deployment/operations | authentication, secrets, backups, restore drill, outage and fan-out recovery |

Generic relay publication is not an alternate authoritative Capsule write path.

## Product UI and E2E

| Target | Responsibility |
|---|---|
| `desktop/src/features/luca/` | personal home, residents, Brain Setup, Capsule status, room limits and backup/restore |
| `desktop/tests/e2e/luca/` | installed/native retained-surface and product proof flows |
| `fixtures/luca/` | generated keys, synthetic brains, provider stubs, malicious inputs |
| `evidence/` | immutable gate logs, traces, screenshots, recordings and hashes |

## Global forbidden overlaps

- Only the integrator edits root manifests/lockfiles, migrations, event
  registries, shared schemas and release identity.
- Shell workers do not edit Rust authority or persistence.
- Runtime workers do not edit UI themes/navigation.
- Brain workers do not edit source Mnemos or live databases.
- No lane writes the original Buzz, Luca v2, Mnemos or Polyphonic evidence
  repositories.
