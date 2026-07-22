# Resident Signing Broker V1

## Trust boundary

```text
OS keychain
   |
desktop authority + typed signing broker
   |  exclusive socketpair FD; session/sequence-bound
   v
Buzz ACP host (untrusted content processor, typed client only)
   |  broker FD is close-on-exec and not exposed as a tool
   v
model/runtime + shell/MCP/tool descendants (no key, no broker channel)
```

The design-partner proof is macOS arm64. The desktop creates an exclusive Unix
socketpair for each ACP host. Only the ACP endpoint is made inheritable for that
one spawn; the host immediately marks it close-on-exec. Every model/tool child
spawn closes all non-stdio descriptors, clears legacy `BUZZ_PRIVATE_KEY` and
`NOSTR_PRIVATE_KEY`, and receives no socket path, bearer token or broker tool.
The desktop binds the other endpoint to the exact resident, owner, ACP PID,
session epoch and runtime configuration.

Windows/Linux parity must use an equivalently exclusive inherited handle/pipe
with OS ACL and handle-inheritance proof before those platforms are claimed. A
same-user listening socket plus discoverable token is not an accepted fallback.

## Replacement for key-backed Buzz CLI replies

The existing Buzz path instructs the model to run `buzz messages send`, which
requires the raw key. V1 replaces that path explicitly:

1. The ACP host assembles `agent_message_chunk` updates for the current prompt
   into one bounded final draft and accepts it only when the prompt terminates
   successfully and the turn is not cancelled.
2. The host derives channel/thread/reply/root from the accepted dispatch—not
   from model-supplied IDs—and resolves exact `@Resident Name` text against
   current same-owner room membership using the existing mention rules.
3. The host submits one typed `message.publish.v1` request containing the final
   draft, resolved `p` tags and dispatch/root receipt. The desktop authority
   reauthorizes, freezes and durably stages the exact event, then signs and
   publishes it over its credential-proved managed-relay connection. ACP
   receives the event ID and body-free publication receipt, never the
   installation credential.
4. The managed relay rejects the revoked installation session. Epoch/tag data
   is diagnostic metadata, not authentication. This applies to normal
   replies and agent-to-agent mentions, so a restored resident cannot produce
   duplicate managed replies from its old installation.

The base prompt no longer tells agents to publish through the key-backed CLI.
Identity-mutating Buzz CLI/forge commands are disabled. Read-only tools may
remain. V1 supports one final managed message per accepted turn; mid-turn or
proactive model-authored publication is deferred. The model has authorship over
the draft but receives neither raw key, broker descriptor nor general signing
tool.

During generation the UI may render ACP chunks as an explicitly provisional,
unsigned local stream. Provisional chunks are never relayed, searched, replayed
or treated as chronology. Successful termination replaces them with the one
canonical signed final event; cancel/failure removes them and publishes
nothing. P1's streaming claim refers to this live provisional presentation.

## Managed final publication contract

```ts
interface ManagedMessagePublishRequestV1 {
  protocol: "luca.message.publish.v1";
  turn_id: string;
  idempotency_key: string;
  owner_pubkey: string;
  resident_pubkey: string;
  conversation_id: string;
  thread_id?: string;
  root_event_id?: string;
  reply_event_id?: string;
  resolved_p_tags: string[];
  final_draft: string;
  dispatch_receipt_id: string;
  cancellation_epoch: number;
}

type ManagedMessagePublishResultV1 =
  | { state: "published" | "replayed"; event_id: string; event_sha256: string; publication_receipt_id: string }
  | { state: "cancelled" | "denied" | "invalid" | "unavailable"; code: string };
```

`idempotency_key` is SHA-256 over a versioned domain, dispatch receipt and
resident. The desktop derives `created_at`, canonical tags and event ID; none
are accepted from model text. Before network I/O it persists an encrypted
outbox row keyed by `idempotency_key` containing the frozen exact signed event,
request hash, installation session ID and state `prepared`. A different request
under the same key is denied. State advances `prepared -> submitted -> accepted`;
relay acceptance is idempotent by exact Nostr event ID. After response loss the
desktop queries that ID and records `accepted` or resubmits the identical event,
never re-signs a new timestamp. A terminal duplicate returns the original
receipt. Cancellation is checked before freeze and immediately before send; a
relay acceptance that wins the race is recorded honestly as published.

Chunk handling is a bounded state machine:
`collecting -> terminated -> prepared -> submitted -> accepted`, with
`collecting -> cancelled|failed` as no-publication exits. Only one transition
to `prepared` is permitted for a turn. ACP/desktop restart reconciles the
durable outbox before accepting another final for that idempotency key.

## Framing and replay

Frames use length-prefixed RFC 8785 canonical JSON with protocol version,
session epoch, monotonic sequence, request ID, operation, structured payload and
deadline. The desktop accepts at most one in-order use of a sequence number and
caches bounded request-ID results for idempotent replay. EOF, ACP restart,
deadline, PID/session mismatch or sequence gap closes the channel; a new ACP
session receives a new socketpair/epoch.

## Allowlisted operations

The broker exposes no arbitrary `sign(bytes)`:

- `message.publish.v1`: canonical Buzz message/reaction/observer event, signed
  and published by desktop authority over its authenticated managed-relay
  session after
  verifying resident, room membership, event kind/tags, root/dispatch receipt,
  cancellation epoch, active installation epoch, body limit and owner policy;
- `relay_auth.sign.v1`: NIP-98/relay-auth challenge bound to allowed method,
  origin, expiry and configured relay;
- `capsule.decrypt.v1`: verified NIP-AE event bound to owner/resident/address;
- `capsule.encrypt_sign.v1`: validated semantic segment/pointer operation bound
  to expected head, writer epoch, byte budget, source references and operation
  id; output is an exact signed event, not publication authority;
- narrowly enumerated profile/attestation operations required by resident setup,
  each with an owner-session proof and fixed schema.

Git signing, forge mutation, arbitrary Buzz CLI signing, raw NIP-44 primitives
and key export are disabled in-agent for V1. Protected identity backup is a
separate owner-reauthenticated desktop-only flow; it does not use the ACP broker
channel.

## Provider and tool separation

The broker never trusts Capsule, memory, message or model text as policy. It
looks up app-owned resident/runtime/tool/provider state and active dispatch
receipts. It cannot grant tools, approve a tool call, change a provider, create
a job or publish a generic event. ACP cannot publish resident-authored managed
messages. It can request only the typed final publication under the already-
authorized dispatch and receives a body-free result.

## Required proofs

- ACP/model/child environment contains neither legacy private-key variable;
- malicious shell, MCP and nested child enumerate environment, arguments, open
  descriptors, temp files, crash artifacts and keychain access and cannot find
  a key or usable broker handle;
- model protocol injection cannot invoke or broaden a broker operation;
- arbitrary kind/tag/room/segment/origin, stale sequence/epoch, PID mismatch,
  replay, oversize and deadline cases reject;
- ACP crash/restart invalidates the old channel while ordinary conversation can
  recover through a fresh authorized session;
- exact signed-event vectors match Nostr canonical IDs/signatures;
- all default logs/screenshots/observer frames/debug exports pass the shared
  sentinel scanner;
- retained V1 chat/reaction/profile/Capsule operations work without raw key
  inheritance; disabled CLI/forge actions fail with explicit product status.
- real ACP `agent_message_chunk` aggregation publishes exactly one signed final,
  and an A-to-B exact mention triggers B through the existing queue without any
  model-visible key or generic signing channel;
- after restore installation transfer, the old app's reply is rejected and the
  destination produces one accepted final.
- crash before submit, after relay accept/before local receipt and during
  reconciliation yields one exact event ID; forged current epoch/tag with a
  copied resident key still rejects without the active installation credential.
