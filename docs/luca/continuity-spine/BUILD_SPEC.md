# Polyphonic continuity spine build specification

Status: **approved for implementation by Riley on 2026-08-29**  
Branch: `codex/unified-dev`  
Source baseline: `15fde924b97fcee11339f91f52e169df7b400ff0`  
Product authority: [`../POLYPHONIC_CONTINUITY_CHARTER.md`](../POLYPHONIC_CONTINUITY_CHARTER.md)  
Behavioral instrument: [`../POLYPHONIC_CONTINUITY_ASSAY.md`](../POLYPHONIC_CONTINUITY_ASSAY.md)

## 1. Outcome

Ship the smallest production-valid continuity layer that lets a managed
resident begin each turn with bounded, honest orientation from its own durable
continuity without making continuity a dependency of messaging.

The spine complements native Codex, Claude Code, Hermes, OpenClaw, and future
runtime memory. It does not replace, copy, reset, or require a new profile for
any native runtime.

The completed feature provides:

1. one encrypted continuity namespace for each owner-resident relationship;
2. one bounded, immutable, read-only Wake payload before a managed turn;
3. typed fail-open behavior when any continuity layer is absent or unhealthy;
4. one idempotent post-publication job that may update only the resident's
   compact handoff;
5. enforceable provenance, correction, Forget, authorization, and
   cross-resident isolation.

This is an integrated development feature for real user testing. It is not a
claim that the complete Mnemos cognitive engine is finished.

## 2. Frozen scope

### 2.1 Included

- Existing keychain-rooted continuity custody and per-resident key derivation.
- Existing encrypted store, revision authority, active-head reconstruction,
  archive, correction, Forget, rotation, and backup behavior.
- Existing five-layer read attempt: Capsule, handoff, Hypomnema, associative
  recall, and separately authorized Owner Brain.
- A new versioned `ContinuityWakePacketV1` logical payload compiled from the
  existing read result.
- Delivery through the existing desktop-owned managed-continuity socket and ACP
  prompt path.
- Existing per-resident Enabled/Disabled continuity control.
- Existing durable finalized-outbox hook and body-free idempotent job store.
- Resident-authored `no_change` or compact handoff capture after publication.
- Focused source tests and one installed-app acceptance using Riley's existing
  authenticated runtime profiles.

### 2.2 Explicitly deferred

- Automatic memory-note creation or supersession.
- Episode-to-interpretation reconsolidation.
- Belief, conviction, relationship, or self-model evolution.
- Resident-authored reflections and reflection prompts.
- Metabolism, salience learning, decay, access reinforcement, or autonomous
  consolidation.
- Scheduled inner life, catch-up work, proactive messages, or background tools.
- Cross-resident learning, shared private memory, or room-derived memory
  authority.
- New embeddings, remote retrieval services, cloud accounts, or MCP sidecars.
- Native-runtime memory import, mirroring, mutation, or replacement.
- A new continuity dashboard, Notebook redesign, onboarding flow, or health UI.
- External Mnemos transfer/synchronization and concurrent multi-writer support.
- Sterile test accounts or new Codex/Claude runtime profiles.

Deferred code already present in the repository is not deleted. It remains
uninvoked by the spine's automatic path and is not a release requirement.

## 3. Existing implementation disposition

### 3.1 Adopt unchanged

| Existing capability | Source authority | Decision |
|---|---|---|
| Continuity wire envelope and layer statuses | `crates/luca-protocol/src/continuity.rs` | Keep `ContinuityContextRequestV1`, `ContinuityContextResultV1`, and the outer `ContinuityPacketV1` transport envelope. |
| Encrypted continuity kernel | `crates/luca-continuity/` | Keep namespace, scope, encryption, retrieval, revision, correction, archive, Forget, and zeroization behavior. |
| Trusted desktop lifecycle | `desktop/src-tauri/src/luca/continuity_*` | Keep key custody, encrypted store, read lease, rotation, Capsule, and backup implementation. |
| Managed delivery path | `desktop/src-tauri/src/luca/managed_continuity.rs` and `crates/buzz-acp/src/continuity_provider.rs` | Keep the local non-signing socket, authority checks, deadline, and fail-open response path. |
| Publication authority | `desktop/src-tauri/src/luca/managed_message_publisher.rs` | Keep the rule that continuity begins only after the signed final is accepted and every publication authority is terminal. |
| Durable job identity | `desktop/src-tauri/src/luca/continuity_jobs.rs` | Keep owner/resident/source-event idempotency, bounded retry, recovery, and body-free storage. |
| Assay tooling | `crates/luca-continuity/src/assay.rs` and `crates/buzz-acp/src/assay_runner.rs` | Keep the current source instrument and isolated fresh-session runner. Use Riley's existing authenticated runtime profile. |

### 3.2 Adapt

1. Add `ContinuityWakePacketV1` and its bounded item/status/receipt types to the
   pure protocol/kernel boundary.
2. Change the packet builder from a generic priority-ordered reference list to
   the frozen Wake composition in Section 4.
3. Keep Owner Brain material structurally separate from resident Wake material
   when rendering the ACP prompt. Brain is working reference, not lived
   continuity.
4. Narrow the private post-final cognition prompt to exactly `no_change` or one
   `handoff` result.
5. Make any automatic `LocalContinuityCognitionOutcomeV1::Changes` result
   invalid for the spine path and commit nothing from it.
6. Add focused regression coverage at the desktop/ACP boundaries on the current
   unified branch.

### 3.3 Leave inactive

- `LocalContinuityCognitionOutcomeV1::Changes` remains readable for backward
  compatibility, but automatic spine jobs neither request nor commit it.
- Existing stored active memory notes remain eligible for read-only Wake
  retrieval under their current lifecycle and provenance. No new automatic
  memory notes are created.
- Journal, reflection, broader metabolism, scheduling, and proactive-message
  paths remain outside the spine execution path.

No server migration, relay change, event kind, cloud service, or public API is
introduced.

## 4. Wake contract

### 4.1 Transport

The current `ContinuityContextResultV1` remains the desktop-to-ACP wire result.
Its optional outer `ContinuityPacketV1` remains the size-bounded transport
envelope. Its `content` is one canonical JSON `ContinuityPromptPayloadV1`:

```text
protocol: "luca.continuity.prompt.v1"
wake: ContinuityWakePacketV1?
owner_brain_references: ContinuityWorkingReferenceV1[]
```

`wake` is absent when no resident-private or Capsule material is ready.
`owner_brain_references` is empty when Brain is empty or unauthorized. The
entire wrapper, including both sections, is subject to the existing 48 KiB
outer canonical ceiling. Brain is never nested inside the Wake packet.

`ContinuityWakePacketV1` uses the discriminator
`luca.continuity.wake.v1` and contains:

```text
protocol
compiler_version
owner_pubkey
resident_pubkey
relationship_scope_ref
request_id
identity_orientation[]
relationship_orientation[]
current_handoff?
relevant_continuity_items[]
ambient_continuity_items[]
recent_corrections[]
open_commitments[]
reflection_prompts[]
layer_statuses[]
body_free_receipt_ref
```

Scalar and container types are frozen as follows:

- `compiler_version` is the exact string `wake-spine-v1`.
- `owner_pubkey` and `resident_pubkey` use `Hex64`.
- `relationship_scope_ref` equals the exact `ContinuityScopeV1.scope_ref`
  returned by `resident_notebook_address(owner_pubkey, resident_pubkey,
  key_version)`. It is the stable resident-notebook scope, not a room scope and
  not a newly derived hash.
- `request_id` uses `OpaqueId`.
- `current_handoff` is an optional `ContinuityWakeHandoffV1` containing the
  existing validated `ResidentHandoffV1`, its active record ID, revision, and
  provenance references.
- Every body-bearing array uses `ContinuityWakeItemV1`:

```text
item_id
record_kind
author_kind
body
source_event_ids[]
provenance_refs[]
```

`ContinuityWakeItemV1` field types and bounds are:

- `item_id: OpaqueId`;
- `record_kind: OpaqueId`, accepted only when it parses through the existing
  closed `DurableContinuityRecordKind` allowlist;
- `author_kind: OpaqueId`, exactly one of `owner`, `resident`, `system`, or
  `automatic`;
- `body: String`, nonempty valid UTF-8 and at most 4 KiB;
- `source_event_ids: Vec<Hex64>`, sorted, unique, and at most eight;
- `provenance_refs: Vec<Sha256Ref>`, sorted, unique, nonempty, and at most 16.

`ContinuityWorkingReferenceV1` uses `item_id: OpaqueId`, the same bounded
`body`, `source_event_ids`, and `provenance_refs`, and no `record_kind` or
`author_kind`. Arrays contain at most the category maxima in Section 4.2.

- `layer_statuses` uses the existing ordered `ContinuityLayerResultV1` shape.
- `body_free_receipt_ref` is a `Sha256Ref` over compiler version, request and
  relationship-scope identifiers, cue hash, selected item/revision/provenance
  identifiers, category counts, omission counts, and layer statuses. It is
  independent of the existing outer delivery `receipt_ref`, avoiding a
  circular packet hash.
- `ContinuityWorkingReferenceV1` uses the existing item ID, body, source and
  provenance references, but carries no resident-continuity category.

Both receipts contain hashes, identifiers, counts, statuses, and compiler
version only. They never contain bodies, prompts, paths, titles, credentials,
keys, provider session identifiers, or local filenames.

### 4.2 Spine population rules

- `identity_orientation` prefers an explicit active identity record and uses a
  valid active Capsule only as fallback. The compiler never invents identity
  prose.
- `relationship_orientation` prefers explicit active resident-authored or
  owner-authored relationship material and uses Capsule relationship material
  only as fallback. Absence is valid.
- `current_handoff` contains at most one active handoff.
- `recent_corrections` contains at most three active pinned owner corrections
  not already represented by a corrected current handoff, newest first.
- `open_commitments` contains at most five explicit active `commitment`,
  `preference`, or `open-thread` records not already represented inside the
  current handoff.
- `relevant_continuity_items` contains at most five active resident-private
  items returned by the existing bounded retrieval, ordered by its stable rank.
- `ambient_continuity_items` contains at most one active resident-private item
  already present in the bounded read snapshot but not selected elsewhere. The
  spine adds no new ambient-search index or model call.
- `reflection_prompts` is always empty in this phase.
- Owner Brain text is never placed in identity, relationship, correction,
  commitment, relevant-continuity, or ambient-continuity fields.

All item limits are maxima, not quotas. Empty fields are honest and valid.

### 4.3 Deterministic source mapping and deduplication

| Existing source | Wake destination |
|---|---|
| Active handoff head | `current_handoff` |
| Active non-handoff head pinned by `OwnerCorrection` | `recent_corrections` |
| Active identity/relationship record | matching orientation array |
| Active `commitment`, `preference`, or `open-thread` record | `open_commitments` |
| Other active resident-private item selected by existing retrieval | `relevant_continuity_items` |
| Highest-ranked remaining active resident-private snapshot item | `ambient_continuity_items` |
| Valid Capsule identity/relationship material | orientation fallback only |
| Authorized Owner Brain item | wrapper `owner_brain_references` only |

An active handoff or correction is not also emitted as relevant or ambient
continuity. Items are deduplicated first by exact active record/revision ID and
then by the pair of body hash and sorted provenance references. Stable ties use
category priority, existing retrieval rank, canonical timestamp, then item ID.

The retrieval cue is the existing zeroizing UTF-8 cue derived from the current
triggering owner message. Only its SHA-256 reference enters the selection
receipt; cue text is never durable.

### 4.4 Selection order and budget

The compiler admits material in this order:

1. pinned active owner corrections;
2. active current handoff;
3. explicit commitments, preferences, and open questions;
4. explicit active identity and relationship orientation;
5. relevant resident-private continuity;
6. one ambient resident-private item when available;
7. valid Capsule orientation as fallback;
8. separately authorized Owner Brain working references.

The outer packet retains the existing 48 KiB canonical ceiling. Structural
metadata, ordered layer statuses, the Wake selection receipt reference, every active pinned
correction, and the active handoff are mandatory. Commitments, orientation,
relevant continuity, ambient continuity, and Brain references are optional in
that order. Optional items are omitted from the end of the priority order until
the wrapper fits.

The existing outer `ContinuityContextResultV1.receipt_ref` remains outside
`ContinuityPacketV1.content` and therefore does not consume the 48 KiB content
budget.

Categories are truncated only at complete UTF-8 item boundaries. If one
mandatory item cannot fit after every optional item is removed, resident Wake
is omitted and the resident-private result becomes typed `invalid` with a
body-free budget diagnostic. An independently fitting authorized Brain section
may still be delivered. Messaging always proceeds.

Selection is deterministic for the same authorized immutable snapshot, cue,
compiler version, and budget.

### 4.5 Prompt presentation

ACP renders Wake as untrusted orientation, never as system authority. The
resident is told to use it naturally and not announce Mnemos, claim native
transcript restoration, or describe uncertain records as certain personal
memory.

Owner Brain appears under a distinct untrusted working-reference heading. It
cannot modify identity, tools, permissions, routing, signing, or system
instructions.

## 5. When Wake runs

For the spine, preserve the existing simple behavior: every admitted managed
resident turn makes one bounded continuity attempt before prompt assembly.

This avoids introducing session-freshness caches or reorientation heuristics in
the launch spine. It also makes corrections, Forget, grant revocation, and
Disabled mode effective on the next turn.

Wake does not run for:

- owner-authored messages that dispatch no managed resident;
- unmanaged/external participants without a stable Polyphonic resident key;
- private post-publication cognition jobs;
- cancelled or rejected dispatches;
- any request that fails exact owner, resident, conversation, binding, epoch,
  deadline, or dispatch authority.

Each resident in a multi-resident room receives a separately authorized Wake
from its own namespace. Visits, mentions, membership, and A2A exchanges do not
change memory authority.

Wake is additive to the native runtime's existing profile, instructions,
skills, and supported memory. Tests use those existing authenticated profiles;
Polyphonic does not create or require a replacement profile.

## 6. Minimal post-publication capture

### 6.1 Eligibility and timing

A capture job is eligible only after:

1. the exact resident final is signed by the existing trusted publisher;
2. the relay accepts it;
3. the encrypted final-publication outbox is terminal;
4. the resident's continuity mode is Enabled.

Failed, cancelled, interrupted, rejected, provisional, or unpublished turns
create no capture mutation.

The existing idempotency key over owner, resident, finalized source event, and
primary-resident role guarantees at most one logical job. Restart recovery does
not reset the retry ceiling or create another job.

### 6.2 Allowed outcomes

The exact resident's configured runtime/model performs one private, tool-free,
bounded cognition call over signed conversation history and the exact finalized
source event. History uses the existing context message-count limit with a
minimum of 16 and a 24 KiB canonical JSON ceiling. The exact source event is
admitted first; if it alone cannot fit, the job fails without mutation. Newest
complete preceding messages are admitted next, then rendered chronologically.
Bodies are never sliced.

The host supplies the canonical whole-second UTC timestamp. The response uses
the existing strict `LocalContinuityCognitionResultV1` parser and 48 KiB result
ceiling, plus existing handoff limits: 4 KiB summary, 32 items per handoff list,
and 2 KiB per list item. It may return only:

- `no_change`; or
- `handoff`, containing summary, unresolved threads, explicit commitments,
  explicit preferences, exact source-event provenance, and timestamp.

The prompt must prefer `no_change` for routine chatter, transient task status,
copied document/repository content, unsupported inference, secrets, paths, or
third-party personal data.

The automatic job may write only the compact handoff lineage. It may not create
or supersede memory notes, reflections, beliefs, interpretations, journals,
Brain records, embeddings, or native-runtime memory.

If the runtime returns the broader `changes` outcome, the job becomes terminal
with body-free code `unsupported_spine_outcome`; nothing is committed.
Malformed, oversized, wrong-resident, wrong-source, or wrong-job output becomes
terminal `invalid_handoff_result` and is not retried. Timeout and runtime
unavailability retain the existing bounded retry behavior.

### 6.3 Failure behavior

Capture failure never changes the already-published chat result. The existing
two-attempt ceiling, restart recovery, one manual retry, Disabled-mode
cancellation, and body-free status projection remain unchanged.

## 7. Authority and lifecycle rules

### 7.1 Failure and noninterference

- Locked, absent, corrupt, invalid, stale, timed-out, disabled, or deleted
  continuity never blocks resident dispatch or final publication.
- Each failed read layer reports its own typed status; a failed layer does not
  erase healthy layers.
- An empty Wake is valid and causes no first-contact warning in chat.
- Retrieval performs no durable writes, access counters, decay, embeddings,
  reconsolidation, or maintenance.
- Continuity keys and signing authority never enter ACP/model/tool descendants.

### 7.2 Corrections

- Explicit owner correction creates a pinned successor under existing revision
  authority.
- Retrieval and Wake use only the active corrected head.
- Superseded text may appear only as explicitly labelled historical provenance,
  never as current orientation.
- Automatic handoff capture cannot silently replace or reverse a pinned owner
  correction; a stale automatic job completes without mutation.

### 7.3 Forget

- Terminal Forget removes the lineage from retrieval immediately and authorizes
  the existing physical purge plan.
- Pending/running capture jobs anchored before Forget are cancelled.
- Retry, restart recovery, Capsule loading, indexes, or event replay cannot make
  the forgotten lineage active again.
- A later, genuinely new finalized exchange may create a new handoff, but it
  cannot cite or reconstruct the forgotten body through the continuity store.

### 7.4 Isolation

- Namespace authorization binds exact owner key and resident key before
  decryption or ranking.
- Room membership, mention, visit, invitation, or A2A contact grants no access
  to another resident's private continuity.
- Every responding resident receives only its own resident-private material.
- Owner Brain authorization is checked independently for the exact resident,
  binding, selected source, and provider-egress destination.
- Unknown or changed egress fails closed for Brain retrieval while resident chat
  and private continuity remain available.

## 8. Parallel-safe ownership

Use one integration owner and three temporary worktrees under
`/Volumes/LaCie/Luca-Development/worktrees/`. Existing unrelated dirty files in
`docs/luca/artifacts/` and `docs/luca/sketchbooks/` are protected and excluded.

### Core/Wake lane

Owns:

- `crates/luca-protocol/src/continuity.rs`
- `crates/luca-protocol/tests/continuity_vectors.rs`
- `crates/luca-continuity/src/context.rs`
- focused `crates/luca-continuity` tests and fixtures

Delivers the Wake types, deterministic compiler, budgets, receipts, and pure
tests. It does not edit desktop or ACP integration files.

### Host lane

Owns:

- `desktop/src-tauri/src/luca/continuity_context.rs`
- `desktop/src-tauri/src/luca/managed_continuity.rs`
- `desktop/src-tauri/src/luca/continuity_jobs.rs`
- `crates/buzz-acp/src/continuity_provider.rs`
- the narrow cognition prompt in `crates/buzz-acp/src/pool.rs`
- focused host tests beside those files

Delivers Wake rendering, fail-open delivery, and handoff-only post-final
capture. It does not change protocol/kernel types without an integration-owner
patch.

### Assurance lane

Owns only these new standalone artifacts:

- `tests/luca-conformance/continuity/spine-v1.json`
- `crates/luca-continuity/tests/spine_acceptance.rs`
- `docs/luca/continuity-spine/SOURCE_ACCEPTANCE.md`

These cover lifecycle/scope isolation, correction/Forget non-resurrection, and
cross-crate conformance. Core and Host retain all inline and existing adjacent
test files, including publisher/job tests. Assurance may review but does not
edit shared production integration files.

### Integration owner

Owns shared module exports, Cargo wiring, conflict resolution, phase-order
integration, final verification, installed-app build, and
`docs/luca/continuity-spine/INSTALLED_ACCEPTANCE.md`. Assurance supplies source
evidence; Integration owns the installed record and its commit. No two lanes
edit the same file. A lane that needs a shared change supplies a bounded patch
description to the integration owner.

## 9. Ordered implementation and commits

### Phase 0 — freeze this specification

- Confirm baseline ancestry and preserve unrelated work.
- Commit this document without product code.

Commit: `docs(continuity): freeze spine build specification`

### Phase 1 — Wake contract and compiler

- Add strict Wake types and canonical vectors.
- Implement deterministic category composition and receipts.
- Preserve the existing outer transport and 48 KiB ceiling.
- Prove body safety, UTF-8 boundaries, stable ordering, and zeroize temporary
  plaintext compiler/render buffers immediately after ACP prompt assembly.

Commit: `feat(continuity): add bounded wake packet compiler`

### Phase 2 — managed Wake delivery

- Map the existing immutable read snapshot into Wake categories.
- Render Wake and Owner Brain as separate untrusted prompt sections.
- Preserve exact managed authority, timeout, and fail-open behavior.
- Prove native runtime configuration and memory remain untouched.

Commit: `feat(continuity): deliver wake context to managed residents`

### Phase 3 — handoff-only capture

- Narrow the private cognition prompt to `no_change` or `handoff`.
- Reject automatic memory-note `changes` without mutation.
- Preserve finalized-outbox timing, idempotency, retries, restart recovery,
  Disabled mode, correction precedence, and Forget cancellation.

Commit: `fix(continuity): constrain automatic capture to handoff`

### Phase 4 — integrated safety proof

- Add focused end-to-end source coverage for failure, isolation, lifecycle,
  no-write retrieval, and exactly-once capture.
- Run the existing-profile N/D/W behavioral comparison as a development signal,
  not as a technical substitute for deterministic proof.

Commit: `test(continuity): prove spine lifecycle and isolation`

### Phase 5 — installed acceptance record

- Rebuild the existing Luca development application once source gates pass.
- Run the bounded installed-app walkthrough in Section 11.
- Record observed evidence and unresolved behavior without claiming the deferred
  engine is complete.

Commit: `docs(continuity): record installed spine acceptance`

Tests ship with the commit that introduces the behavior. Do not mix UI polish,
Brain redesign, messaging refactors, or unrelated cleanup into these commits.

## 10. Focused verification gates

### Per implementation commit

- `cargo fmt --check` for touched Rust.
- Focused unit tests for the touched crate/module.
- Focused Clippy with warnings denied for the touched targets.
- `git diff --check`.

### Integrated source gate

Run after all spine commits are assembled:

```bash
. ./bin/activate-hermit
cargo test -p luca-protocol continuity
cargo test -p luca-continuity
cargo test -p buzz-acp continuity --lib
cargo clippy -p luca-protocol -p luca-continuity --all-targets -- -D warnings
cargo clippy -p buzz-acp --lib -- -D warnings
cargo test --manifest-path desktop/src-tauri/Cargo.toml continuity --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_message_publisher --lib
cargo check --manifest-path desktop/src-tauri/Cargo.toml
git diff --check
```

If a named filter selects no intended tests, replace it with the smallest exact
module/test invocation and record the command. Do not run the unrelated full
repository matrix unless a focused result exposes cross-cutting breakage.

### Required deterministic cases

1. Same snapshot and cue produce byte-identical Wake and receipt.
2. Packet limits preserve complete UTF-8 items and mandatory-category order.
3. Pre-turn retrieval changes no durable store, index, counter, or revision.
4. Locked, unavailable, corrupt, timeout, invalid, Disabled, and empty states
   still reach ordinary managed generation.
5. Each resident in a room receives only its own continuity canary.
6. Brain denial/revocation does not suppress resident-private Wake.
7. Pinned correction prevents resurfacing and automatic reversal.
8. Forget removes retrieval immediately and survives retry/restart/replay.
9. Failed, cancelled, and unpublished turns enqueue nothing.
10. Reconciliation of one finalized event results in one job and at most one
    handoff mutation.
11. A `changes` result commits nothing in spine mode.
12. Logs, errors, job rows, receipts, and debug output remain body-free.

## 11. Installed-app acceptance

Use the existing installed development app and Riley's existing authenticated
runtime profiles. Do not create a second application, user profile, Codex home,
Claude configuration directory, or runtime account.

1. Enable continuity for Luca and send a meaningful exchange containing one
   explicit commitment or open thread.
2. Open the existing resident Continuity inspector and confirm the final
   publishes normally and one handoff job reaches a terminal state without
   changing the visible response.
3. Quit/relaunch the app, then ask a natural continuation question. Confirm the
   resident does not behave as first contact or announce Mnemos. Focused host
   tests, rather than new installed UI, prove the new session epoch and Wake
   delivery.
4. Disable continuity through the existing Continuity inspector and send
   another message. Confirm chat still works. Focused host tests prove that
   Disabled mode delivered no Wake.
5. Create a handoff for each of two test residents, then use each resident's
   existing Continuity inspector correction control to place a distinct
   synthetic canary in that resident's private handoff. Add both residents to a
   room and confirm neither response cites the other's canary. Deterministic
   isolation tests are the technical proof; this installed step is a behavioral
   smoke only.
6. Apply an explicit correction through the existing Continuity inspector and
   confirm the corrected head appears on the next turn while the superseded
   claim does not appear as current truth.
7. Forget the synthetic test lineage through the existing Continuity inspector
   and confirm it remains absent after relaunch and job recovery.
8. Confirm the existing runtime profile still supplies its normal instructions,
   skills, and native context. No separate installed hash audit is required
   because this slice adds no native-runtime configuration write path; focused
   source tests enforce that boundary.
9. Run a small same-profile Native/Dossier/Wake comparison. Treat the result as
   qualitative tuning evidence only.

Riley performs the final experiential judgment: whether the resident feels
naturally oriented rather than mechanically briefed. The integration owner may
record **source-tested** and **installed-tested** without Riley. Only Riley's
explicit sign-off records **Riley-accepted** and closes the final product
acceptance state. That judgment may reopen Wake composition polish, but it does
not replace the technical gates.

## 12. Definition of spine complete

The continuity spine is complete only when all of the following are true on one
exact unified-branch candidate:

- `ContinuityWakePacketV1` is versioned, bounded, deterministic, provenance
  carrying, and delivered through the existing managed path.
- Wake remains additive to native runtime context and requires no new runtime
  profile.
- Every required failure state demonstrably fails open to ordinary messaging.
- Pre-turn retrieval is read-only and body-safe.
- Automatic post-final capture can produce only `no_change` or one compact
  handoff from the exact resident/runtime binding.
- Publication timing and job idempotency prevent cancelled, failed,
  unpublished, or duplicate learning.
- Correction, Forget, resident isolation, and Brain authorization pass the
  focused deterministic cases.
- Focused Rust, ACP, and trusted-desktop gates pass.
- The existing development app passes the bounded installed walkthrough.
- The acceptance record distinguishes source-tested, installed-tested, and
  Riley-accepted behavior.
- Reflection, metabolism, scheduling, autonomous learning, new memory notes,
  and broader Mnemos integration remain explicitly deferred rather than being
  silently included.

No product decision remains open inside this approved scope. Work stops for
Riley only if source reality contradicts a frozen rule, a destructive data
migration becomes necessary, or completion would require adding a deferred
capability. Ordinary implementation details follow existing repository
conventions and do not require further product judgment.
