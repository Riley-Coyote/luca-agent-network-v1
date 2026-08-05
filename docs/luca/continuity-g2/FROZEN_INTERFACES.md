# G2 frozen interface index

Status: frozen for G2.1 implementation. Contract changes require a decision
ledger entry, migration analysis, updated vectors, and security review.

## Protocol types

The following V1 names and meanings are fixed. Concrete Rust field layouts are
implemented by P01 and frozen by golden vectors before consumers integrate.

| Type | Fixed purpose |
|---|---|
| `ContinuityNamespaceV1` | Owner-brain or exact resident-private namespace identity |
| `ContinuityScopeV1` | Exact source/project/room/resident scope; never inferred from membership |
| `ContinuityRecordV1` | Versioned encrypted logical record and body-free public metadata |
| `ContinuityContextRequestV1` | Read-only per-responder request with owner, resident, conversation, binding, egress, bounds |
| `ContinuityContextResultV1` | Layer statuses, bounded packet, provenance, body-free receipt, safe diagnostics |
| `ContinuityPacketV1` | At most 48 KiB of delimited untrusted reference material |
| `ContinuityMutationV1` | Proposed/committed private change with source events and revision predecessor |
| `ContinuityJobV1` | Idempotent durable job keyed to exact signed source event and resident role |
| `BrainGrantV1` | Persisted resident/source/scope/provider-egress consent |
| `ImportDiscoveryReportV1` | Available/absent/degraded/failed source discovery without secrets |
| `ImportPlanV1` | Zero-write normalized preview, mappings, hashes, unsupported rows, consent |
| `ImportCommitReceiptV1` | Atomic result, exact source hashes, row counts, and safe diagnostics |
| `CognitionScheduleV1` | Opt-in cadence, quiet hours, budgets, catch-up, and hard ceilings |
| `ProactiveMessageCandidateV1` | Resident-authored candidate plus novelty/privacy/rate evidence before publication |
| `PortableContinuityCapsuleV1` | Compact versioned NIP-AE identity/current-state projection |
| `LucaBackupManifestV1` | Protected backup contents, versions, source mappings, and integrity hashes |

## Fixed context status vocabulary

`ready`, `empty`, `denied`, `stale`, `locked`, `unavailable`, `timeout`, and
`invalid` are exhaustive for a G2 layer result. A layer error is data, not a
conversation error.

## Fixed seams

- Preturn: one typed read-only request per responding resident at the existing
  ACP preprompt seam.
- Room replay: G2.1 admits only ordinary `stream` room messages, preserves the
  existing thread-first and DM behavior, and caps the rendered replay block at
  16 KiB UTF-8 in addition to the existing count limit. It retains newest whole
  messages that fit, skips a single oversized message, and reports body-free
  truncation state. Replay deduplicates signed event IDs and excludes the
  current triggering batch so prompt bodies are not repeated. Forum/workflow
  replay remains unchanged.
- Postturn: one idempotent job only after exact final-event relay acceptance and
  local outbox finalization.
- Keys: desktop-owned only; no key-bearing request enters renderer, ACP, model,
  tool, or child environment.
- Backup: the continuity master key is wrapped inside the age-protected archive,
  unwrapped only in process memory, and installed into a destination keychain
  only after explicit restore confirmation.
- Messaging: current dispatch, cancellation, permission, and publication
  contracts remain independent.
- Imports: discovery and preview write nothing; commit is atomic.
- Scheduling: user turns preempt jobs; scheduled tools/permissions are denied.
- Anti-rumination: identity/relationship/conviction mutations use the fixed
  evidence, seven-day frequency, and 30-day topic-suppression policy in the
  build spec.

## Fixed diagnostic rule

Diagnostics and receipts may include identifiers, hashes, versions, counts,
durations, enum statuses, and bounded error codes. They never include memory
bodies, titles, tags, journal/reflection text, context packet contents, imported
document bodies, secret keys, or credentials.
