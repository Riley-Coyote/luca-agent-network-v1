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
