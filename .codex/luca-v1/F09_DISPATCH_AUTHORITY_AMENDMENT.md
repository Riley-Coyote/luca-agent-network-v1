# F09 Desktop Dispatch Authority Amendment — 2026-07-27

Status: approved Option 1 implementation correction

## Decision

F09 keeps the two-operation Option 1 broker protocol unchanged. Relay history
alone is not publication authority: an ACP host must not be able to select an
old signed owner message and turn it into a fresh final.

For Luca-managed resident messages, Buzz's existing composer and message UI
remain the product surface, but the desktop command path becomes the trusted
send boundary:

1. the desktop builds and signs the exact owner kind-9 event;
2. before relay network I/O, it atomically stages one bounded
   `ActiveDispatch` per mentioned managed resident;
3. it submits that exact signed event through Buzz's existing `/events` bridge;
4. relay rejection terminally rejects the staged dispatch;
5. an accepted event ID is the public `dispatch_receipt_id`.

The dispatch store is desktop-owned, durable, bounded, and keyed by
`(trigger_event_id, resident_pubkey)`. A row contains canonical conversation
and thread routing, owner and resident public identities, creation/expiry,
session binding, cancellation state, and terminal publication state. It
contains no secret or model output.

Plain text, reply, media, emoji, and mention sends in the Luca fork use the
existing `send_channel_message` command so the desktop observes the same
authoritative send lifecycle. This is a transport-boundary adaptation, not a
chat UI rebuild.

## Session and cancellation authority

- `cancellation_epoch` is the desktop-minted managed runtime session epoch
  already bound into the F14 broker and supplied to the ACP host as public
  bootstrap metadata. Event timestamps are never cancellation authority.
- The first matching publication request may bind a pending dispatch to the
  active broker session epoch only after exact request/routing comparison.
- A local owner `!cancel` send marks matching pending/active dispatches
  cancelled in the desktop store before relay publication. The broker rechecks
  that desktop state immediately before final submission.
- A stopped/replaced broker session cannot consume a row bound to another
  session epoch.
- Relay acceptance is the final-message linearization point. If acceptance
  wins the last cancellation race, the outbox records `Published` honestly.

At G1, managed resident invocation is intentionally local-owner initiated.
Messages authored on another device are still retained Buzz chronology but do
not acquire desktop dispatch authority. Same-owner resident-authored descendant
dispatch is added by F10/Future G4 through the durable causal ledger; F09 leaves
an explicit authorizer seam and does not weaken owner-only admission.

## Canonical ACP handoff

- Only bounded public `agent_message_chunk` text is collected.
- The canonical trigger is the last eligible item in `FlushBatch.events` in
  preserved queue order. `cancelled_events` never mint a new dispatch.
- Conversation, root, direct reply and sorted unique recipient tags are derived
  only from that exact trigger. Malformed or ambiguous thread tags fail closed.
- Exactly one `message.publish.v1` request is sent after
  `StopReason::EndTurn`.
- Cancel, refusal, max-token/max-turn, timeout, process exit, transport error,
  empty output, and every other non-success path clear provisional output and
  publish nothing.
- Ordinary `Legacy(Keys)` Buzz behavior is unchanged.

## Durable exact-event outbox

Before `/events` network I/O, the desktop persists the exact canonical signed
final event and request hash in an atomically replaced, owner-only file
encrypted with the maintained Rust `age` passphrase API using desktop-held
resident secret material. No plaintext final, resident secret, or usable
broker capability is written to disk.

On broker/desktop restart the outbox:

- decrypts and validates its bounded schema;
- reconciles `submitted` rows by exact event ID;
- resubmits only the identical retained event bytes when required;
- never re-signs a new timestamp/signature for the same dispatch;
- rejects a different draft, routing set, turn, or request hash under an
  existing `(dispatch_receipt_id, resident_pubkey)` idempotency key.

## Narrow ownership correction

F09 additionally owns only these Luca send/authority seams:

- `desktop/src-tauri/src/luca/managed_dispatch_store.rs`
- `desktop/src-tauri/src/commands/messages.rs`
- `desktop/src/features/messages/hooks.ts`

Existing F09 ownership of the ACP stream/prompt seams, managed runtime, broker,
outbox and concrete publisher remains in force. No generic signing operation,
new broker operation, database migration, model authority, or unrelated
messaging behavior is authorized.

## Required tests

- staged-before-network owner trigger and relay-rejection cleanup;
- unknown, expired, already-consumed, wrong-owner, wrong-resident,
  wrong-channel, wrong-thread and wrong-session dispatch rejection;
- local cancellation before freeze and immediately before submit;
- same-second messages cannot alias cancellation;
- old signed owner event without a staged row cannot publish;
- multi-event batch uses only the last eligible event;
- cancel/refusal/error/max-turn publish zero finals;
- `EndTurn` publishes exactly one canonical final;
- response loss, ACP restart and desktop restart reuse one exact event ID;
- a different replay payload is rejected;
- legacy Buzz send/publication regression;
- encrypted persistence and artifact scan contain no resident secret or
  plaintext final.
