# G2 run log

This is the chronological build record. It must contain commands and outcomes,
not memory bodies, prompts, keys, credentials, decrypted records, or private
source content. Detailed artifacts live under `evidence/G2/<gate>/<task>/`.

## 2026-08-04 — G2.0 start

- Verified source checkout `agent/runtime-reliability` and preserved its dirty,
  untracked evidence/cache files.
- Confirmed approved baseline `4781dca6` is the continuity source-audit commit.
- Found one later Claude design commit (`3f88995b`) on the source branch and left
  it untouched.
- Created isolated worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-continuity-g2`
- Created and pushed `agent/continuity-g2` from exact baseline `4781dca6`.
- Began durable G2 control package. Product code unchanged.

## 2026-08-04 — C02 — independent control review repair

- Independent review found no P0 issue and six actionable control defects.
- Split pure Rust kernel work from trusted desktop persistence/crypto work.
- Added hard sequential gate barriers, fresh-keychain backup recovery,
  deterministic anti-rumination rules, acceptance traceability, task receipts,
  and stronger validator proofs.
- `python3 scripts/luca/validate_g2_control.py` passes after the single repair.
- Product code remains unchanged; final G2.0 re-review is pending.

## 2026-08-04 — C02 — G2.0 PASS

- Final independent re-review found no remaining P0/P1 issues.
- G2.0 verdict recorded in `G2_0_VERDICT.md`.
- Frozen the G2.1 ordinary-room replay decision: `stream` rooms only, 16 KiB
  rendered UTF-8 replay ceiling, newest complete messages retained.
- Product implementation is authorized beginning with P01 and P02.

## 2026-08-04 — P01/P02 — G2.1 parallel start

- P01 owns versioned protocol contracts, schemas, and vectors only.
- P02 owns ordinary stream-room history replay in `buzz-acp` only.
- Shared manifests, lockfiles, G1 authority modules, and publication paths remain
  under the integration mutex.
- Both lanes are based on completed read-only reconnaissance and have disjoint
  file ownership.

## 2026-08-04 — P02 — bounded ordinary-room history

- Added signed history replay only for ordinary `stream` rooms while preserving
  thread precedence and existing DM/forum/workflow behavior.
- Validates event ID, signature, kind, and exact room tag; orders deterministically;
  enforces count and 16 KiB UTF-8 bounds; excludes trigger/duplicate event IDs.
- One bounded repair corrected oversized-message retention and conservative
  truncation after trigger exclusion.
- Focused room tests 7/7, ACP library 598/598, F10 2/2, no-deps clippy PASS.
- Independent messaging review: PASS.

## 2026-08-05 — P01 — continuity protocol contracts

- Added all 16 versioned G2 contracts with strict unknown-field and protocol
  rejection, deserialize-time semantic validation, body-free diagnostics, and
  checked JSON Schema 2020-12 conformance.
- Bound continuity-job idempotency to owner, resident, source event, and
  resident role with a domain-separated SHA-256 derivation.
- Golden fixtures round-trip through all 16 types and carry checked canonical
  RFC 8785 hashes; packet sizing covers the complete canonical representation.
- One bounded repair closed validation, size, encryption-envelope, schema, and
  vector gaps found by independent review.
- Protocol tests, all-target clippy, and rustdoc generation pass. Final
  independent security recheck: PASS.

## 2026-08-05 — P03 — fail-soft continuity provider

- Added a read-only provider trait and deterministic scripted fake at the ACP
  boundary without integrating it into messaging yet.
- Resolver preserves all eight valid layer states, maps provider failure to
  `unavailable`, maps elapsed/absolute deadlines to `timeout`, and maps invalid
  request/result/budget states to `invalid`.
- Enforces the lesser of the caller budget and the 48 KiB canonical packet
  ceiling without truncating or slicing reference text.
- Focused provider tests 5/5, full ACP library 603/603, no-deps clippy and format
  checks PASS. Independent protocol review: PASS with no findings.

## 2026-08-05 — P04 — permanent continuity-absent regressions

- Replaced the single generic continuity-absent fixture with an explicitly
  synthetic Hermes/OpenClaw pair and mixed-room expectations.
- Both residents traverse the real desktop dispatch, signing-broker, and
  encrypted-outbox state machines; cancellation produces zero late finals.
- Added test-only coverage of the real managed-permission registry for runtime-
  advertised allow/reject options, explicit cancellation, exact request
  binding, stale decisions, and session-epoch isolation.
- Initial independent review found three proof gaps. One bounded repair closed
  all three; final review found no P0/P1/P2 issues and returned PASS.
- Focused ACP, protocol, desktop permission, desktop F10, locked-metadata, JSON,
  and diff checks pass. G2.1 is PASS as a source/conformance gate only; installed
  native runtime proof remains G2.6.

## 2026-08-05 — K01 — exact namespace kernel

- Added the pure `luca-continuity` Rust crate with validated protocol-backed
  namespace/scope wrappers and a deterministic read-only fixture index.
- Authorization requires equality of every namespace and explicit scope field;
  references never override owner, resident, namespace kind, key version,
  source, project, room, or conversation boundaries.
- The crate depends only on `luca-protocol` and contains no platform, keychain,
  storage, runtime, network, scheduler, NIP-AE, or cryptographic behavior.
- Focused tests, clippy, rustdoc, locked check, formatting, dependency audit,
  and control validation pass. Independent architecture review: PASS.

## 2026-08-05 — K02 — keychain custody and namespace derivation

- Added a keychain-only 256-bit continuity master-key lifecycle using the
  existing scoped desktop keyring service and raw no-cache secret-store APIs.
- Absence is the only write path. Locked, unavailable, corrupt, denied, failed
  read-back, and mismatched read-back states fail closed without replacing the
  extant identity or introducing a filesystem/environment fallback.
- Added direct HKDF-SHA256 owner/resident namespace derivation with frozen,
  length-prefixed domain information and stable vectors. There is no scope-key
  or chained-derivation API.
- Initial independent review found Debug-printable derived keys and unmanaged
  temporary key buffers. One bounded repair closed both; final independent
  security re-review: PASS.
- Focused custody/derivation tests 14/14, locked metadata, formatting, source
  scans, and diff checks pass. Installed keychain and chat fail-soft proof stay
  assigned to G2.6.

## 2026-08-05 — K03 — authenticated encrypted record kernel

- Added pure XChaCha20-Poly1305 record encryption with a fresh 192-bit nonce,
  exact protocol ciphertext ceilings, and zeroizing, redacted decrypted bodies.
- RFC 8785 authenticated data binds the local record domain, every top-level
  record field, the complete owner/resident namespace, and every exact scope
  field. The same bytes feed the public digest and AEAD operation.
- Added exact replay/idempotency, same-namespace/key-version nonce collision
  rejection, bounded serialized ingress, structural versus authenticated read
  separation, and body-free corruption diagnostics.
- Initial independent security review found four adversarial-evidence gaps. One
  bounded repair added recomputed-digest AEAD attacks, nonce/hash and exact-size
  vectors, pre-Serde input bounds, and authenticated corrupt-record isolation.
- Final independent security review: PASS with no P0/P1/P2. Focused tests
  20/20, clippy with warnings denied, rustdoc, locked metadata, formatting,
  dependency/API scans, and diff checks pass.

## Entry template

```text
### YYYY-MM-DD — task ID — title
Status: pending | running | passed | failed | blocked
Owner:
Reviewer:
Commit:
Repair count:
Commands:
- command
Results:
- concise result
Evidence:
- repository-relative path
Risks/known limits:
- item or none
```

## 2026-08-05 — K05 — revision lifecycle and rollback authority

- Added an append-only encrypted-body-blind revision ledger for create, revise,
  explicit owner correction, rollback, archive, and terminal forget.
- Exact actor/authorship, namespace/scope/type/key-version, predecessor,
  revision, envelope, and domain-derived idempotency bindings fail closed.
- A bounded repair closed namespace-wide nonce reuse, incomplete caller-asserted
  purge inventories, and bypassable durable record-type filtering.
- Independent data-integrity re-review: PASS. Full `luca-continuity` tests
  35/35, clippy with warnings denied, formatting, and diff checks pass.

## 2026-08-05 — K03D — encrypted SQLite persistence stopped at review gate

- Implemented a dedicated encrypted-only SQLite store with private permissions,
  exact scope predicates, replay/nonce handling, fail-closed custody, WAL
  controls, body-free diagnostics, and exact schema validation.
- Focused tests pass 11/11. The authorized repair closed read-only WAL mutation,
  spoofable schema checks, and normal-path full-blob selection.
- Final review still found unbounded allocation paths through corrupt persisted
  `record_id` and replay envelope reads. This repeats the same fail-soft class,
  so K03D is BLOCKED under the one-repair rule; K04/K06 did not start.

## 2026-08-05 — K03D — user-authorized surgical repair and final pass

- Riley explicitly authorized one additional repair after the recorded stop.
- Structural loads now use bounded integer `rowid` handles, replay reads use a
  length-only pass before guarded fetch, and stored IDs are compared inside
  SQLite to the bounded parsed envelope ID without loading corrupt strings.
- Both passes require SQLite storage class BLOB through lazy CASE expressions;
  a NUL-prefixed oversized TEXT value is rejected before materialization.
- SQLite EXPLAIN inspection confirmed guard execution before the output Column.
  Focused tests pass 14/14; formatting, locked metadata, diff checks, and control
  validation pass. Independent final security re-review: PASS.

## 2026-08-05 — K04 — in-memory retrieval and bounded graph activation

- Added exact-scope process-memory FTS5 hydration, deterministic integer lexical
  seeding, bounded typed graph activation, source-backed paths, and optional
  caller-provided memory-only vectors that remain off by default.
- Initial independent review found shared-corpus rank influence, floating-point
  scoring, aggregate allocation gaps, missing provenance enforcement, and
  duplicate-edge amplification.
- One bounded repair isolated FTS per exact scope, removed BM25/floating point,
  bounded records/plaintext/edges/vectors before cloning, required active
  provenance, and rejected duplicate relation edges.
- Final independent review: PASS. All 53 continuity tests, 17 focused retrieval
  vectors, strict Clippy, formatting, diff, source-boundary, and disk-artifact
  checks pass.

## 2026-08-05 — G2.2 control correction — durable revision authority

- T01 dependency reconnaissance found that K05 revision semantics were only
  process-local and SQLite stored encrypted rows without authoritative lineage
  head/lifecycle state.
- Added K05D before K06/T01. It must persist body-free revision authority and
  atomically bind transitions to encrypted records so archive/forget cannot be
  resurrected by revision-order inference after restart.
- Added acceptance A209 and decision D29. K06 remains unclaimed until protected
  backup/restore includes the resulting authority state.

## 2026-08-05 — K06 — independent recovery/security review blocked

- Initial rotation and protected-backup implementation passed 31 focused tests,
  formatting, and scoped diff checks but is not accepted.
- Independent review found that normal crash WAL/SHM state was rejected before
  SQLite recovery, partial keychain installs were not recoverable, destination
  owner/root authority was underconstrained, source mappings were not restored
  transactionally, terminal rotation replay was not request-bound, and the
  lifecycle lock was not AppState-owned.
- Archive bounds, symlink rejection, ciphertext/manifest tamper evidence,
  fresh-keychain restore, and real subprocess crash/reopen proofs were also
  incomplete.
- One bounded repair is active. K06, A207, A208, and G2.2 remain unclaimed, and
  K06 must also incorporate K05D revision authority before final review.
- Evidence: `evidence/G2/G2.2/K06/security-review-block.md`.

## 2026-08-05 — K05D — pure authority projection stopped at review gate

- Added a deterministic body-free projection of active, archived, and
  forgotten lineages, including pinned corrections and artifact inventory.
- Focused tests, all 56 continuity tests, strict Clippy, formatting, and diff
  checks passed.
- Independent review found that public Create could exceed the projection cap,
  artifact authority was unbounded and lacked its own idempotency binding, and
  the projected key-version contract needed an explicit rotation/hydration
  boundary.
- One bounded repair is active. K05D, A209, K06, and G2.2 remain unclaimed.
- Evidence: `evidence/G2/G2.2/K05D/review-block.md`.

## 2026-08-05 — K05D — bounded pure-projection repair passed

- Public lineage and cumulative artifact caps now fail before authority
  mutation, and artifact registration has exact canonical replay/conflict
  semantics with original-receipt retention.
- Lineage envelope version is distinct from K06 root-key activation and fails
  closed on authenticated reconciliation mismatch.
- Independent re-review found no P0/P1/P2. All 59 continuity tests and strict
  Clippy pass.

## 2026-08-05 — K05D — restart snapshot stopped at repair ceiling

- Added deterministic snapshot export/hydration, digest-only typed replay,
  explicit purge progress, and permanent body-free tombstones. All 65 focused
  continuity tests, strict Clippy, formatting, and diff checks pass.
- Independent adversarial review found retained-record rotation could not
  hydrate, artifact purge authority was ambiguous across lineages, aggregate
  preallocation bounds were incomplete, and historical artifact receipts did
  not prove exact ordered inventory transitions.
- K05D already consumed its planned repair. Desktop CAS/persistence did not
  start, and K05D, A209, K06, and G2.2 remain unclaimed pending Riley's explicit
  authorization for one additional surgical repair.
- Evidence: `evidence/G2/G2.2/K05D/restart-snapshot-review-block.md`.

## 2026-08-05 — Riley authorized surgical K05D and K06 repairs

- Riley explicitly authorized one additional repair pass for the complete
  recorded K05D restart-snapshot block and the two residual K06 recovery and
  backup-bound defects.
- K05D and K06 repairs run in parallel with disjoint ownership. Neither task
  may pass until its focused checks and an independent adversarial re-review
  pass.
- Desktop revision-authority integration remains paused until the K05D pure
  interface is accepted and frozen.

## 2026-08-05 — K06 — authorized residual repair passed

- Commit-ambiguous candidate root-key errors now preserve rollback and journal
  authority until deterministic old/new read-back reconciliation completes.
- Backup collection bounds now run through a streaming exact-shape preflight
  before canonicalization or typed materialization and stop at cap plus one.
- Root and independent review each passed 11 custody and 11 backup tests,
  exact-file formatting, and scoped diff checks; no blocking findings remain
  in the authorized repair.
- K06 remains in progress because protected backup/restore and rotation must
  incorporate the accepted K05D authority state before A207/A208 or G2.2 can
  pass.
- Evidence: `evidence/G2/G2.2/K06/second-repair-review-pass.md`.

## 2026-08-05 — K05D — authorized pure restart repair passed

- Added authenticated retained-envelope replacement chains, global one-lineage
  artifact authority, bounded serialized decoding and aggregate limits, exact
  ordered artifact history, and opposite-domain live idempotency rejection.
- Completed Forget remains ciphertext-free and exact historical replay remains
  zero-write with the original typed receipt.
- Root and independent review each passed all 70 continuity tests, strict
  Clippy, exact-file formatting, and scoped diff checks; no scoped findings
  remain.
- The pure interface is frozen. K05D and A209 remain in progress while trusted
  desktop persistence, generation CAS, immutable reads, and K06 integration
  are implemented.
- Evidence: `evidence/G2/G2.2/K05D/restart-snapshot-review-pass.md`.

## 2026-08-05 — G2.2 control correction — zeroizing retrieval bodies

- Immutable-read reconnaissance found that K04's retrieval input and hydrated
  records still use cloneable ordinary `String` bodies.
- Added K04D and acceptance A210 before the K05D immutable desktop lease. It
  must provide zeroizing ownership for decrypted bodies, decoded material,
  retrieval records, and derived hits across success, retry, error, and timeout.
- Desktop schema/CAS implementation may continue independently, but no
  immutable plaintext lease or A209 claim may pass until K04D does.
- Decision: D33. Evidence:
  `evidence/G2/G2.2/K05D/desktop-read-map.md`.

## 2026-08-05 — K04D — pure zeroizing retrieval gate passed

- Replaced ordinary body, tag, cue, record, hit, and result ownership with a
  redacted zeroizing text owner.
- The consuming authenticated-body bridge reuses the decrypted allocation and
  zeroizes invalid UTF-8 before returning a body-free error.
- In-memory SQLite now receives only per-index HMAC-SHA256 opaque terms,
  record identifiers, and numeric frequencies; no body, tag, or cue plaintext
  crosses the SQLite boundary.
- Root and independent review passed all 75 continuity tests, strict Clippy,
  exact formatting, and scoped diff checks with no findings.
- K04D's pure slice is complete. A210 remains open until the K05D desktop lease
  proves zeroization on success, retry, error, and timeout.
- Evidence: `evidence/G2/G2.2/K04D/security-review-pass.md`.

## 2026-08-05 — K05D desktop slice A — independent review blocked commit

- The focused authority, store, backup, rotation, and desktop checks were
  green, including the corrected writer-locked historical replay race.
- Independent source review still found unbounded normalized scalar
  allocation, non-exact object inventories, a multi-snapshot hydration read,
  a non-composable whole-owner restore seam, and a header-zero/WAL classifier
  that creates temporary state before proving the source version.
- No desktop slice-A commit or A209 claim was made. Riley authorized one
  surgical repair pass; the five findings are the frozen repair scope.
- Evidence:
  `evidence/G2/G2.2/K05D/desktop-slice-a-review-block.md`.
- This closes only the pure-crate slice. Desktop snapshot persistence,
  hydration, CAS generation, immutable reads, and protected-backup integration
  remain before K05D/A209 may pass.
- Evidence: `evidence/G2/G2.2/K05D/projection-review-pass.md` and
  `evidence/G2/G2.2/K05D/restart-contract.md`.

## 2026-08-05 — K06 — bounded repair stopped at re-review gate

- The repair closed real WAL/SHM crash recovery, lifecycle-lock ownership,
  partial slot reconciliation, destination authority, transactional mappings,
  authenticated rotation replay, symlink/truncation checks, tamper tests, and
  fresh-keychain restore.
- All 39 focused tests pass.
- Re-review still found a commit-ambiguous Keychain error path that can delete
  rollback authority and archive collection caps that execute after full
  parse/canonicalization.
- The planned repair count is exhausted. K06 is preserved as a blocked source
  checkpoint and no K06/A207/A208/G2.2 pass is claimed without additional
  repair authority.
- Evidence: `evidence/G2/G2.2/K06/repair-review-block.md`.

## 2026-08-05 — K05D — fail-closed legacy-store migration decision

- Existing v1-v3 encrypted rows cannot prove authoritative lineage heads,
  archive/forget state, pinned corrections, or historical replay receipts.
- Empty stores may migrate to the new authority schema. Any non-empty legacy
  store remains byte-for-byte untouched and continuity degrades with the
  body-free reason `authority_migration_required`.
- No revision-order inference or automatic data rewrite is allowed.
  Owner-confirmed legacy conversion/import is deferred.
- Decision: D30.

## 2026-08-05 — K05D — pre-implementation integrity correction

- Security review found that persisting exact canonical replay requests would
  retain successor ciphertext after Forget, and that historical replay tied to
  the current lineage version would break after rotation.
- The restart contract now persists only domain-separated request digests,
  typed body-free original bindings, and typed receipts in separate revision
  and artifact domains.
- Added explicit purge progress, permanent body-free record/nonce/artifact
  tombstones, post-decrypt generation revalidation, full CAS comparisons, and
  exact pre-allocation bounds.
- Decisions: D31 and D32. Implementation remains in progress; no A209 pass is
  claimed.

## 2026-08-05 — K05D desktop slice A — authorized repair passed

- Commit `00ffef50` persists the complete normalized revision-authority
  generation and freezes its owner-global CAS/restart boundary.
- The repair added SQL-before-allocation bounds, exact v1-v4 object inventory,
  one-snapshot hydration with count and round-trip proofs, fail-closed
  header-zero legacy handling, and one atomic complete-owner replacement seam
  spanning ciphertext, mappings, version, fresh epoch, and authority.
- Root verification passed 9 authority, 24 store, 11 backup, and 3 rotation
  tests plus desktop check, exact formatting, and scoped diff checks.
- Independent adversarial re-review cleared all five prior findings and found
  no new defect in replay/CAS, purge/tombstone, migration, WAL, or rotation
  exclusion behavior.
- K05D and A209 remain open for the AppState-owned immutable read lease. K06
  remains open until backup and rotation consume this accepted authority seam.
- Evidence: `evidence/G2/G2.2/K05D/desktop-slice-a-review-pass.md`.

## 2026-08-05 — K06/A208 — protected backup and restore passed

- Commit `cc715962` completes the version-two protected archive around one
  exact revision-authority snapshot, source mappings, owner recovery material,
  and the wrapped continuity root.
- Focused verification passed all 14 backup tests, including zero-write preview
  and confirmation mismatch, wrong passphrase, ciphertext/manifest tamper,
  strict collection bounds, exact mapping restore, and fresh-keychain recovery
  on both sides of the keychain/SQLite activation boundary.
- Independent security review found no blocking issue and accepted A208.
- K06 and G2.2 remain open only for A207's atomic authority-aware rotation and
  the remaining K05D immutable-lease review.
- Evidence: `evidence/G2/G2.2/K06/a208-security-review-pass.md`.

## 2026-08-05 — K05D/A209/A210 — immutable desktop lease passed

- Commit `226a91c5` adds the AppState-owned continuity lifecycle/runtime state,
  existing-custody-only boot recovery, exact scoped authority capture, and the
  bounded two-attempt desktop read lease.
- The borrowed plaintext consumer runs exactly once only after second-phase
  restore/key/root/epoch/generation/version/fingerprint validation while the
  lifecycle guard is held. Failure and stale paths expose no body and invoke no
  consumer.
- Focused verification passed 7 runtime tests, 12 authority tests, the
  read-only/no-mint bootstrap probe, exact formatting, and scoped diff checks.
- Independent security review found no blocker and accepted A209 plus the
  desktop integration required for A210.
- Evidence:
  `evidence/G2/G2.2/K05D/immutable-lease-security-review-pass.md`.

## 2026-08-05 — K06/A207 — atomic authority-aware rotation passed

- Commit `226a91c5` replaces the legacy batch seam with exact-generation
  journal preparation, complete retained-envelope re-encryption, authenticated
  replacement chains, and one atomic full-authority activation transaction.
- Crash recovery observes a complete old generation plus its prepared journal
  or the complete new generation; purge/tombstone, historical replay, source
  mapping, artifact, and nonce-reservation authority remain coherent.
- Focused verification passed 6 rotation tests, the atomic complete-owner
  replacement and historical replay tests, exact formatting, and diff checks.
- Independent security review found no blocker and accepted A207/K06.
- Evidence: `evidence/G2/G2.2/K06/a207-security-review-pass.md`.

## 2026-08-05 — G2.2 encrypted continuity kernel — PASS

- All G2.2 tasks K01–K06 and acceptance rows A201–A210 are complete.
- One consolidated gate passed 81 pure-kernel tests and 83 trusted-desktop
  continuity tests. The desktop set included locked/absent fail-soft G1
  messaging and permission regressions.
- Exact Rust formatting, repository diff validation, and G2 control validation
  passed.
- No additional broad CI run was performed. Prior task evidence and independent
  reviews were reused, and the consolidated gate exercised only the integrated
  continuity boundary changed since those reviews.
- The remaining dead-code warnings identify G2.3 read-lease consumers and
  legacy rotation helpers; they do not represent a G2.2 correctness failure.
- Verdict: `docs/luca/continuity-g2/G2_2_VERDICT.md`.
