# System Contracts

These are language-neutral future adapter interfaces. They do not replace the
active V1.2 `OwnerBrainSourceV1`, `OwnerBrainSourceBindingV1`,
`OwnerBrainChunkV1`, `OwnerBrainImportPreviewV1`, `OwnerBrainImportCommitV1`,
`BrainGrantV1`, context-layer, or receipt contracts in
[`ARCHITECTURE_CONTRACTS.md`](../v1.1-v1.3/ARCHITECTURE_CONTRACTS.md).

During V1.2, generic descriptors project into those frozen Luca types. A later
adapter milestone may promote these interfaces after the narrow source and
authorization loop passes its installed gate.

## Source registry

```text
SourceDescriptor
  id: stable opaque ID
  adapter_kind: mnemos | hermes | openclaw | codex_history | claude_history |
                repository | folder | tab_ledger | other
  display_name: user-facing label
  location_hint: local-only path/connection hint; never sent to a provider
  discovery_state: found | unavailable | unsupported | permission_required
  selection_state: unselected | selected | imported | refresh_paused | removed
  sensitivity: normal | sensitive | secrets_possible
  capabilities: discover, preview, import, refresh, remove, project_graph
  version: adapter/source format version

ImportJob
  id, source_id, selected_scope, state, progress, cancellation_state
  started_at, completed_at, rollback_reference, errors[]

SourceRecord
  id, source_id, native_reference, captured_at, content_hash
  body_location, scope, sensitivity, deletion_state
```

## Derived knowledge

```text
KnowledgeCandidate
  id, source_record_ids[], kind, body, confidence
  epistemic_state: confirmed | inferred | disputed | stale | superseded
  scope: owner_shared | project | room | resident_private
  proposed_by: importer | deterministic_system | resident | user
  review_state: pending | approved | rejected | auto_committed

KnowledgeRecord
  id, candidate lineage, revision chain, scope, visibility policy
  valid_from, valid_to?, provenance receipt

KnowledgeProjection
  id, source/record lineage, kind: fts | semantic | temporal_graph | code_graph | corpus_graph
  projection_version, refresh_state, query policy
```

## Authorization and context

```text
AccessRequest
  owner_id, resident_id, room_id?, project_id?, purpose
  requested_source_ids?, requested_scopes[], provider_id?, egress_intent

AccessDecision
  state: allowed | denied | unavailable | stale | timeout | invalid
  allowed_record_ids[], denied_reason_code, policy_revision

ContextPacket
  layers: signed_history, capsule, resident_continuity, owner_recall
  layer_state per layer: ready | empty | denied | stale | unavailable | timeout | invalid
  untrusted_reference_blocks[]
  receipt_id

ContextReceipt
  id, request fingerprint, policy revision, source/record IDs only
  included_layers, exclusion reasons, created_at
```

## Required invariants

- An adapter cannot return bodies during discovery.
- An import has one terminal outcome: committed, rolled back, cancelled, or failed.
- Removal traverses derived candidates, records, and projections by lineage.
- Context packet bodies never enter system prompts, diagnostics, crash reports, or general caches.
- Authorization occurs before ranking, graph traversal, embeddings, and provider egress.
- A graph projection is disposable and rebuildable from approved source records.
