# G2 decision ledger

Decisions here are fixed for G2 unless Riley explicitly revises them. A change
must record date, author, reason, affected tasks, migration impact, and approval.

| ID | Decision | Reason |
|---|---|---|
| D01 | G2 is single-installation/single-writer. | Avoid false concurrent continuity claims; protected transfer is sufficient. |
| D02 | Signed events own chronology; resident public keys own identity. | Preserve G1 authority and Buzz interoperability. |
| D03 | Continuity is fail-soft and outside messaging authority. | Memory failure must never make chat unavailable. |
| D04 | Resident namespaces and the owner brain are separately encrypted and authorized. | Room membership is not memory authority. |
| D05 | The master key lives in the OS keychain with no plaintext fallback. | A locked or unavailable keychain degrades continuity, not custody. |
| D06 | Use HKDF-SHA256 and XChaCha20-Poly1305 with canonical AAD. | Strong domain separation and misuse-resistant record binding. |
| D07 | Decrypted search/index data is memory-only. | Avoid plaintext leakage through SQLite, WAL, and backups. |
| D08 | Portable NIP-AE Capsule is a compact projection, not the notebook/brain. | Keep portable identity state bounded and avoid dual canonical stores. |
| D09 | Pre-turn retrieval is strictly read-only and capped at 48 KiB. | Determinism, bounded egress, and no hidden reconsolidation. |
| D10 | Post-turn work begins only after exact signed final durability. | Failed/cancelled/ambiguous turns cannot become memory authority. |
| D11 | Resident-private metabolism is automatic with full revisions and rollback. | Preserve continuity without approval fatigue. |
| D12 | Owner-shared brain changes are proposals only. | The owner remains final authority over shared knowledge. |
| D13 | Resident-authored reflection uses the same resident runtime/model; no substitution. | Prevent false authorship and identity drift. |
| D14 | Owner corrections are pinned and cannot be silently reversed. | Explicit correction outranks background inference. |
| D15 | Sensitive profiling and psychometric inference are rejected. | Prevent unsafe, unverifiable identity claims. |
| D16 | Setup grants persist, are revocable, and bind provider egress. | Consent should be durable but destination-specific. |
| D17 | Binding changes stale affected egress grants; unknown egress is remote. | Prevent silent data exposure after runtime changes. |
| D18 | Imports are local-first, staged, atomic, idempotent, and credential-excluding. | Safe migration without native-system mutation. |
| D19 | Imported chats live in Archive plus recall and retain source attribution. | Avoid flooding active conversations or fabricating signatures. |
| D20 | Inner life is opt-in, off by default, bounded, and app-lifecycle scoped. | Add useful autonomy without a hidden daemon. |
| D21 | Default proactive outreach is one resident DM per rolling 24 hours. | Conservative usefulness without notification pressure. |
| D22 | Tools and permissions are denied during scheduled cognition. | G2 reflection does not expand autonomous authority. |
| D23 | No conductor is introduced. | Preserve direct resident relationships and product simplicity. |
| D24 | Claude's design lane is integrated later through stable functional seams. | Avoid merge contention and tying correctness to unfinished visual work. |
| D25 | Protected backup wraps the continuity master key inside the age envelope and installs it into a destination keychain only after confirmed restore. | A backup must remain decryptable after loss of the original keychain without a plaintext fallback. |
| D26 | Automatic identity/relationship/conviction updates require explicit owner evidence or two signed sources across conversations/24 hours, are limited to one per category per seven days, and suppress equivalent topics for 30 days. | Make anti-rumination and bounded-frequency behavior deterministic and testable. |
| D27 | New ordinary-room replay is limited to `stream` rooms and a fixed 16 KiB rendered UTF-8 block, retaining newest whole messages. | Bound fresh-session context without changing established DM/thread/forum/workflow behavior or consuming the whole 48 KiB continuity budget. |
| D28 | Ordinary-room replay deduplicates signed event IDs and excludes the current triggering batch. | The fresh-history block must not repeat the same user content already supplied as the active event batch. |
| D29 | Encrypted record rows are not revision authority; the desktop persists body-free lineage head/lifecycle state and updates it atomically with encrypted revision transitions. | Archive and forget create no successor envelope, so inferring the active record from revision order could resurrect excluded or forgotten continuity after restart. |
| D30 | Empty pre-K05D continuity stores may migrate to the revision-authority schema; a non-empty legacy store remains byte-for-byte untouched and continuity opens degraded with `authority_migration_required`. | Legacy encrypted rows do not contain enough authority to reconstruct archived, forgotten, pinned, or active lineage state without inventing history. Owner-confirmed legacy conversion is deferred. |
| D31 | Forget removes encrypted bodies but permanently retains body-free authority, typed replay digests, purge receipts, and record/nonce/artifact tombstones. | Persisting canonical successor bytes would defeat Forget, while deleting authority would allow resurrection or identifier/nonce reuse. |
| D32 | A continuity read revalidates epoch, generation, key version, and fingerprint under the lifecycle lock after decrypt/hydrate and before plaintext use. | Snapshot capture alone cannot prevent a concurrent Forget, restore, or rotation from making decrypted context stale. |
| D33 | Desktop continuity reads may not use cloneable ordinary-string memory bodies; decrypted bodies, decoded material, retrieval records, and derived hits must retain zeroizing ownership through the guarded context-assembly boundary. | A two-phase lifecycle check is incomplete if stale or failed plaintext copies can remain in process memory after the lease is rejected. |

## Change template

```text
Decision:
Date:
Requested by:
Reason:
Affected tasks/contracts:
Migration/security impact:
Approval:
```
