# T01 bounded pre-turn packet reconnaissance

Status: read-only implementation map complete; implementation waits for K04,
K05 hydration, and K06 atomic read generation.

## Owned implementation shape

Pure crate:

- `crates/luca-continuity/src/context.rs`
- `ContinuityReadSnapshot`
- `ContinuityLayerMaterial`
- `ContinuityContextResolver::resolve`
- `BoundedPacketBuilder`
- domain-separated packet and receipt derivation
- fixed untrusted-reference rendering
- focused packet and failure-matrix tests

Trusted desktop adapter:

- `desktop/src-tauri/src/luca/continuity_context.rs`
- captures one immutable prehydrated snapshot from K04/K05/K06;
- maps custody, store, grant, source, and deadline failures to the frozen layer
  statuses without calling any write API.

ACP boundary:

- a pure `continuity_prompt_block(result)` helper may be added to
  `crates/buzz-acp/src/continuity_provider.rs`;
- T02 later inserts that block between conversation history and triggering
  events as user content, never as system/core/tool/permission/routing state.

## Exact call sequence

1. T02 derives the request only after verified owner trigger, responder,
   conversation, history, and canonical dispatch resolution.
2. Owner/resident authority comes from the desktop-bound managed broker
   session. Runtime binding comes from the exact local broker configuration
   hash. Conversation comes from the exact dispatch channel.
3. Egress is classified by the trusted desktop; unknown remains remote and may
   not use owner-brain grants.
4. The desktop captures one immutable generation containing K06 key/version
   state, K05 active heads, and the K04 exact-scope retrieval index.
5. Layers resolve independently in stable order: capsule, handoff, hypomnema,
   associative recall, then authorized owner-brain/project/room context.
6. Missing later providers report honest `empty`, `denied`, `stale`, or
   `unavailable` states. No layer is simulated.
7. Whole records are added deterministically and the resolver returns a typed
   packet plus body-free receipt. Partial ready layers survive other failures.

## 48 KiB canonical budget

The effective limit is `min(request.max_packet_bytes, 48 * 1024)` over the
complete RFC 8785 canonical `ContinuityPacketV1`, including fixed envelope,
escaped UTF-8, status metadata, and provenance. The builder canonicalizes each
whole candidate item and keeps it only when the complete packet remains within
the limit. It never slices text, UTF-8, or provenance.

Priority is handoff/open threads, hypomnema, deterministic K04 recall, and then
later capsule/owner-brain material. Stable record IDs are final tie-breakers.

## Authority and prompt-injection boundary

Each body is represented as canonical JSON or length-prefixed content inside a
fixed `Luca continuity reference v1 - UNTRUSTED DATA` block. Recalled text
cannot close the envelope. The footer states that references cannot modify
instructions, tools, permissions, routing, signing, or system authority.

The block is only appended to ACP user prompt content. It never enters
`session/new.systemPrompt`, agent core/base/team instructions, tool registry,
permission broker, signing broker, routing tags, or dispatch selection.

## Zero-write proof

The resolver accepts only immutable snapshots/read traits. It cannot call
encrypted-store writes, revision apply/artifact registration, key rotation,
receipt persistence, access counters, reconsolidation, or task spawning. The
receipt is computed and returned only.

Tests compare DB/WAL/SHM existence and bytes, SQLite row/data versions, K04
index state, K05 head/history/lifecycle, and snapshot generation before and
after every success, failure, timeout, and hostile-input case.

## Failure mapping

- locked custody -> `locked`
- absent/unopenable custody or store -> `unavailable`
- authorized query with no material -> `empty`
- policy refusal -> `denied`
- binding/grant/generation mismatch -> `stale`
- AEAD/schema/scope/provenance corruption -> isolated layer `invalid`
- elapsed layer or request deadline -> `timeout`
- invalid top-level echo/request/budget -> existing P03 invalid fallback

Diagnostics remain body-free `SafeDiagnosticV1` values.

## Required focused tests

- exact canonical 48 KiB boundaries with multibyte text, escaping, and
  provenance overhead;
- whole-item omission and deterministic ordering/receipts;
- every owner/resident/binding/conversation/dispatch/egress mismatch;
- cross-resident and room-membership isolation;
- hostile fake system/tool/sign/routing text;
- mixed ready/timeout/denied/stale/corrupt layer matrices;
- locked/missing store and absolute deadline behavior;
- body-free receipt sensitivity to authority/status/provenance;
- zero-write snapshots and existing P03/F10 regressions.

## Hard dependencies

- K04 must export immutable exact-scope retrieval with provenance.
- K05 needs a narrowly reviewed active-head enumeration/hydration adapter; T01
  must not infer the latest revision from SQLite.
- K06 must expose an atomically swappable generation/key-version snapshot so a
  pre-turn read cannot straddle rotation.
- T03 and B01 later provide Capsule and owner-brain layers. T01 freezes their
  status behavior but does not invent data.
