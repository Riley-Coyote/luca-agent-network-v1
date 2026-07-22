# Post-Turn Checkpoint V1

## Promise

After a meaningful completed conversation, Luca may update only the responding
resident's `digest` and `threads` Capsule segments. The response is already
signed and committed. Checkpoint failure never changes the conversation result.

## Qualification

The receipt/idempotency lookup happens before qualification. A duplicate whose
terminal receipt already exists returns `replayed` with that exact receipt; it
is not relabelled `not_qualified`.

A turn qualifies when all are true:

- one final agent response is committed for the turn;
- the turn was not cancelled or superseded;
- the agent is a local resident with a valid Capsule binding;
- at least one owner or resident message contains substantive content.

Short acknowledgements, system-only events and failed turns produce
`not_qualified`. Terminal duplicate delivery returns `replayed`; an existing
nonterminal resumes under its lease/idempotency record. Duplicate event members
inside a genuinely new canonical envelope are de-duplicated before
qualification and do not change checkpoint identity.

## State machine

```text
not_qualified
replayed (existing terminal receipt)
queued -> proposing -> proposed -> publishing -> committed
                   \-> no_change
        \-> failed
        \-> cancelled
        \-> conflicted
```

Terminal states are `not_qualified`, `replayed`, `no_change`, `committed`,
`failed`, `cancelled` and `conflicted`. Every state transition is persisted in the local
receipt store before external side effects that depend on it.

Each nonterminal record also carries `lease_owner`, `lease_epoch`, `attempt`,
`lease_expires_at` and `cancellation_epoch`. A stale operation can be reclaimed
only by compare-and-swap to a higher lease epoch. Missing receipt/control storage
fails the checkpoint; it never authorizes an untracked write.

## Stable identity

```text
checkpoint_id = UUIDv7 generated when the final response commits
idempotency_key = SHA256(
  "luca-checkpoint-v1" || owner_pubkey || resident_pubkey ||
  conversation_id || final_response_event_id
)
```

Duplicate request or replay returns the existing terminal result. A nonterminal
record may be resumed only under its existing ID and expected heads.

## Bounded transcript envelope

The app/host constructs the input locally; the Continuity Service does not gain
general relay credentials.

```ts
interface CheckpointProposalRequestV1 {
  protocol: "luca.continuity.v1";
  checkpoint_id: string;
  idempotency_key: string;
  authenticated_session_handle: string;
  resident_handle: string;
  checkpoint_provider_policy_handle: string;
  conversation_id: string;
  final_response_event_id: string;
  messages: Array<{
    event_id: string;
    author_role: "owner" | "resident" | "other_agent";
    author_id: string;
    created_at: string;
    content: string;
  }>;
  limits: {
    max_messages: 24;
    max_input_bytes: 48000;
    max_output_bytes: 16000;
    max_model_tokens: 2000;
    deadline_ms: 8000;
  };
}
```

Before constructing this envelope, the host fetches and verifies the canonical
signed relay events, room binding, authors, parent/root chronology and final
response ID. It never trusts UI text or a model-supplied transcript. Messages
are ordered, de-duplicated by event ID and clipped deterministically. The
envelope is local-only and never persisted with plaintext in the receipt.

## Provider execution boundary

The Continuity Service is not a model proxy and holds no provider credentials.
Checkpoint proposal execution is split:

1. `checkpoint.request.build.v1` applies deterministic qualification/salience,
   clips the verified envelope/current fast Capsule and returns structured
   provider messages plus prompt/classifier/schema revisions. It does not call a
   model or persist plaintext.
2. The desktop checkpoint dispatcher binds the same-or-stricter provider
   snapshot, constructs the complete provider request through the normal
   adapter, runs B14's final semantic-request egress guard, and performs the
   network call under the 8-second/2,000-token budgets.
3. `checkpoint.response.validate.v1` receives the bounded provider result over
   the exclusive pipe, parses strict JSON, checks source IDs/bytes/abstention and
   returns the unsigned proposal below. Invalid, ambiguous, timeout or provider
   failure returns no mutation.

The desktop stores only body-free lifecycle/revision hashes. The exact guarded
outbound request may be captured only in synthetic security tests.

```ts
interface CheckpointBuildResultV1 {
  protocol: "luca.checkpoint.build-result.v1";
  checkpoint_id: string;
  idempotency_key: string;
  envelope_sha256: string;
  current_fast_head_ids: string[];
  current_fast_heads_sha256: string;
  prompt_revision: string;
  classifier_revision: string;
  output_schema_revision: string;
  structured_provider_messages: Array<{ role: "system" | "user"; content: string }>;
  provider_messages_sha256: string;
  build_result_sha256: string;
}

interface CheckpointProviderBindingV1 {
  boundary: "local" | "approved_remote";
  provider_id: string;
  provider_account_id: string;
  endpoint_class: string;
  model_id: string;
  policy_revision: string;
}

interface CheckpointValidateRequestV1 {
  protocol: "luca.checkpoint.validate-request.v1";
  checkpoint_id: string;
  idempotency_key: string;
  build_result_sha256: string;
  envelope_sha256: string;
  current_fast_heads_sha256: string;
  provider_messages_sha256: string;
  guarded_semantic_request_sha256: string;
  provider_response_sha256: string;
  provider_response: string;
  effective_provider_binding: CheckpointProviderBindingV1;
  prompt_revision: string;
  classifier_revision: string;
  output_schema_revision: string;
}
```

Every `*_sha256` uses RFC 8785 bytes or the explicitly named raw byte string
with a versioned domain prefix. `build_result_sha256` omits itself. The sidecar
accepts validation only in the same IPC epoch and request table as the build,
recomputes every hash and requires exact checkpoint/idempotency/head/revision
equality. Provider response plaintext remains ephemeral; the receipt store
persists only these hashes.

The same-or-narrower predicate is deterministic. A `local` checkpoint binding
is narrower than either completed-turn boundary. An `approved_remote` binding
is allowed only when the completed turn was also `approved_remote`, the
provider/provider-account/endpoint-class/model are exact matches, the current
policy revision still authorizes them, and neither the fast Capsule input nor
the completed turn's selected context carried a local-only restriction. Any
other substitution is false. The final guard recomputes this predicate over the
fully adapter-serialized semantic request immediately before transport.

## Unsigned proposal

The service returns structured candidate content, not an event and not
authority:

```ts
interface CheckpointProposalResultV1 {
  protocol: "luca.continuity.v1";
  checkpoint_id: string;
  build_result_sha256: string;
  guarded_semantic_request_sha256: string;
  provider_response_sha256: string;
  state: "proposed" | "no_change" | "failed" | "cancelled";
  digest?: {
    content: string;
    source_event_ids: string[];
  };
  threads?: {
    content: string;
    source_event_ids: string[];
  };
  input_event_ids: string[];
  truncated: boolean;
  error_code?: string;
}
```

The proposal must abstain when the transcript adds no durable current state.
It cannot edit slow segments, application configuration, memory visibility,
budgets or room state.

The checkpoint provider policy is application-issued and must be the same
dispatch snapshot or strictly narrower than the completed turn's effective
egress. `local` is narrower than `approved_remote`; a different remote provider,
account, endpoint class or broader policy is never treated as equivalent. If the
turn used protected local-only context, a remote checkpoint provider is denied.
The proposal input
contains only the bounded conversation envelope, current fast Capsule text and
opaque source event IDs—never recalled universal-brain bodies. Exact outbound
checkpoint payloads receive the same final serialization-time egress check as
normal turns.

## Commit protocol

1. Resolve idempotency first. Persist `queued` with expected Capsule heads,
   provider/policy revisions and the canonical final-response envelope hash.
2. Acquire a lease and persist `proposing`; call
   `checkpoint.request.build.v1`, dispatch through the desktop provider adapter
   and B14 guard, then call `checkpoint.response.validate.v1` under the shared
   deadline/budgets. Before dispatch, persist the build/head/messages hashes and
   effective provider-binding hash; after transport, persist only guarded
   request/response hashes before validation.
3. Revalidate schema, bytes, source IDs and allowed target segments in the app.
4. Persist `proposed` or terminal `no_change`/failure.
5. Immediately before every side effect, require the current lease owner/epoch,
   cancellation epoch, provider revision and current fast pointer to match.
6. Derive expected heads in the app; validate and sign deterministic versioned
   candidates/pointer through the desktop broker. Persist exact signed events in
   the encrypted outbox.
7. Submit the complete signed set, expected pointer, writer epoch and
   idempotency key to the managed coordinator. It transactionally commits or
   returns replay/conflict.
8. Recheck lease/cancellation before appending the local terminal receipt. A
   coordinator commit that raced cancellation is recorded honestly as committed
   and suppressed from additional app-mediated effects; it is never rewritten
   as cancelled.
9. The terminal receipt contains candidate/pointer/coordinator IDs and hashes,
  canonical envelope hash, policy/provider/model/prompt/classifier/schema/
   canonicalization/runtime revisions, build/messages/guarded-request/response
   hashes, lease/cancellation epochs and recovery
   outcome—never bodies.
10. Mark UI continuity current for the final response event.

Crash recovery scans nonterminal receipts under lease/epoch rules. It may resume
validation/commit with the same signed outbox events, query the coordinator by
idempotency key, or terminate as failed. A recovered existing commit returns
`replayed`. Uncommitted candidates leave the prior pair authoritative and create
no second semantic checkpoint.

## Freshness

Because fast segments are loaded per turn, the committed digest/threads are
eligible for the immediate next message in the same room. The next context
receipt records the exact fast-segment event IDs used.

## Pipeline liveness

Expose qualification count, queued, proposal attempts, proposals, no-change,
commits, conflicts, failures, cancellations, recoveries and last success. Health
requires a recent commit or verified no-change after the latest qualifying
input; lifetime history alone cannot make a stuck/currently failing pipeline
healthy.

## Required tests

- qualification and abstention corpus;
- response commits even when proposal service is absent or times out;
- duplicate final-event delivery creates one checkpoint;
- duplicate terminal delivery returns `replayed`, not `not_qualified`;
- expected-pointer conflict preserves the prior current pair;
- crash before proposal, after proposal, after relay acknowledgement and before
  local receipt recovery;
- multi-segment partial acknowledgement without a current pointer leaves the
  prior pair current;
- stale lease, cancellation epoch and missing-control-store fail-closed tests;
- lease/cancellation races immediately before sign, coordinator commit and local
  receipt; terminal state remains truthful when cancellation loses the race;
- model output cannot target slow segments or authority;
- immediate next turn uses committed fast heads;
- receipt contains IDs/hashes/counters but no transcript or Capsule body;
- zero qualifying lifetime commits shows degraded health.
