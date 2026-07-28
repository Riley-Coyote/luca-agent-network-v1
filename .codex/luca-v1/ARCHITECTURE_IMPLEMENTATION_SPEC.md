# Luca Agent Network V1 - Implementation Architecture

Status: implementation contract; canonical G0 evidence PASS verified
Baseline: Buzz `7e34bee62cacaa9d8a96c14d5892a471b59a1983`

## Product boundary

V1 is a Buzz-derived personal agent home. It does not contain a conductor. The
owner can speak directly to any resident agent or place several agents in a
persistent room. Each resident keeps one cryptographic identity, one governed
Continuity Capsule, and a separately authorized lens into the owner's Mnemos
brain.

The permanent responsibility split is:

| Owner | Canonical responsibility |
|---|---|
| Buzz-derived relay | Message chronology, rooms, threads, attachments, signed authorship, search and realtime delivery |
| Luca desktop authority plane | Owner session, resident registry, key custody, persona authority, model/runtime selection, turn dispatch, causal budgets and structured signing broker |
| Managed Luca relay coordinator | Conditional Capsule commits, active-writer epochs, idempotency and durable commit receipts |
| Continuity Capsule on NIP-AE | One resident's identity and current continuity |
| Luca Continuity Service | Fail-soft, zero-write recall preparation; ingestion adapter; unsigned checkpoint proposals; safe receipts and health |
| Mnemos | Universal-brain records, indexes, provenance and durable knowledge |

No component may silently assume another component's authority.

## Target V1 topology

```text
Luca desktop (Tauri/React)
  |-- Owner session and resident registry
  |-- OS-keychain-backed signing broker (structured operations only)
  |-- app audit, checkpoint, causal and policy-overlay stores
  |-- Personal chat, rooms, activity, Brain Setup, Settings
  |
  +---- signed events ----> Managed Luca relay
  |                         Postgres + Redis + S3-compatible media
  |                         +-- Luca conditional Capsule commit coordinator
  |
  +---- supervised child --> Buzz ACP-derived agent host
  |                           |-- provider/model runtime
  |                           |-- authenticated broker client; no secret key
  |                           |-- slow Capsule at session creation
  |                           |-- fast Capsule and recall per turn
  |                           +-- conversation works without continuity
  |
  +---- exclusive pipes ----> Luca Continuity Service sidecar
                              |-- access decision before retrieval
                              |-- zero-write recall and receipts
                              |-- bounded checkpoint proposal
                              +---- local API ----> Mnemos profile/store
```

The design-partner build uses a managed Luca relay. Advanced self-hosting may
remain available. Shipping PostgreSQL, Redis and object storage inside the
desktop application is not a V1 goal.

## Hard invariants

1. **Talk never depends on memory.** Relay delivery, replay, agent response and
   cancellation continue when the Continuity Service or Mnemos is absent,
   locked, invalid or timed out.
2. **One transcript.** Mnemos stores distilled knowledge and provenance links,
   never a second authoritative message history.
3. **Authority is application-owned.** Capsule text and recalled text cannot
   select models, grant tools, widen access, join rooms, raise budgets or create
   jobs.
4. **Turn recall is zero-write.** Retrieval, ranking and prompt rendering make
   no persistent mutation. Consolidation is a separate explicit pipeline.
5. **Access precedes retrieval.** A record that the responding agent cannot use
   is filtered before scoring, reconsolidation or provider-bound rendering.
6. **Every responding agent is reauthorized.** Agent-to-agent turns never
   inherit the sender's memory decision.
7. **Every durable write is idempotent.** A stable idempotency key, expected
   prior head or revision, and durable receipt exist before a write is
   considered committed.
8. **Agent secrets stay in the desktop signing broker.** The ACP host, model
   runtime, every descendant process, and the Continuity Service receive no
   resident nsec, `NOSTR_PRIVATE_KEY`, or general signing capability. Luca-held
   provider credentials stay in the app/provider adapter; an external ACP
   runtime may use its own separately disclosed credential store. The broker
   accepts only typed, policy-validated operations.
9. **Fast continuity is fresh.** Digest and unfinished threads are loaded on
   each eligible turn. Slow identity changes explicitly invalidate that
   resident's active ACP sessions.
10. **Unknown policy fails closed.** Missing or unrecognized visibility and
    egress fields are not agent-readable.
11. **The relay is not a transaction by implication.** All V1 Luca Capsule
    writes use the managed coordinator's conditional-commit operation. Generic
    NIP replacement semantics alone are never described as CAS or atomic.
12. **One controllable egress edge.** Desktop-issued dispatch snapshots bind
    resident, runtime executable hash, provider account, model, endpoint class,
    policy revision and request ID. Authorization is rechecked on the exact
    semantic provider request at the last app-controlled boundary.

## Turn sequence

```text
1. Relay accepts the signed user or agent message.
2. Agent host resolves the responding resident and root causal envelope.
3. Host verifies the resident's fast-pair commit receipt/pointer and its exact
   Capsule event heads, or uses a visibly stale last-verified cache.
4. Host asks the Continuity Service for governed context over exclusive framed
   pipes. The total Capsule-plus-brain context deadline is 2.5 seconds.
5. Service derives authority from the app session, filters before retrieval,
   retrieves without mutation, and returns context plus a redacted receipt.
6. On timeout/error, host records a degraded context status and continues.
7. Host renders declarative Capsule and memory blocks, then invokes the runtime.
8. Agent host assembles the successful ACP `agent_message_chunk` stream into one
   bounded final draft, derives its reply/root and exact mentions from the
   accepted dispatch/room, and submits a typed managed-publication request. The
   desktop authority reauthorizes kind, tags, room, resident, active
   desktop installation/session binding and dispatch snapshot, freezes one exact
   event in its durable outbox, signs and publishes over the authenticated relay
   connection. The model and ACP host no longer publish through a raw-key CLI;
   UI chunks before commitment are explicitly provisional and unsigned.
9. A non-blocking checkpoint request is created from a bounded local transcript
   envelope. It cannot delay or retract the response.
10. Service may return an unsigned digest/threads proposal. The desktop broker
    validates and signs typed candidates. The managed coordinator conditionally
    commits candidates and pointer against the expected current pointer. UI
    becomes "current" only after the durable coordinator and local receipts
    agree.
```

## Capsule freshness rule

- `core`, `self`, `user` and `convictions` are slow identity segments. They are
  fetched and rendered when a fresh ACP channel session is created.
- `digest` and `threads` are fast continuity segments. Versioned candidates
  become current only through one signed `mem/luca-current` pointer. The host
  fetches that exact pair as a bounded per-turn block immediately before
  universal-brain context.
- Saving a slow segment closes/recycles only that resident's affected ACP
  sessions after the new relay head is verified.
- A failed or conflicted write leaves the prior verified head active.

This rule deliberately works with Buzz's existing one-time core fetch rather
than pretending that cached sessions refresh themselves.

## Degradation matrix

| Failure | Conversation | Capsule | Brain context | Checkpoint |
|---|---|---|---|---|
| Continuity Service absent | Continues | Available through verified cache/relay path | `unavailable` | Pending/failed visibly |
| Mnemos locked/absent | Continues | Available | `locked` or `unavailable` | No brain write; Capsule proposal may be unavailable |
| Recall timeout | Continues | Available | `timeout` | Independent |
| Capsule relay unavailable, partitioned, slow or clock-poisoned | Continues under app-owned persona authority | Last verified cache marked stale, or explicit `unavailable`/`invalid` | May remain available | No Capsule commit |
| Capsule pointer missing, target missing, decrypt failure, cache corruption or oversize | Continues | Invalid component excluded and status shown | May remain available | No overwrite of valid head |
| Invalid/tampered Capsule | Continues under persona authority | Segment rejected | May remain available | No overwrite of valid head |
| Managed relay unavailable | Local UI shows offline | Cached display only | No turn occurs | No turn checkpoint |

"No context found", "access denied", "remote egress denied", "locked",
"unavailable", "timeout" and "invalid" are distinct states. None is converted
to an empty-success result.

## Process and storage ownership

| State | Storage | Writer |
|---|---|---|
| Messages and rooms | Buzz relay | Signed actors through relay |
| Resident configuration and permissions | Luca app data | Desktop authority service |
| Resident secret keys | OS keychain; no child-process environment injection | Desktop signing broker |
| Current Capsule heads | NIP-AE relay events plus managed conditional-commit receipt; verified local cache | Desktop broker plus managed coordinator |
| Prior Capsule versions | Encrypted local archive; optional protected backup | Desktop authority plane |
| Brain records/indexes | Mnemos | Explicit ingestion/consolidation paths |
| Ephemeral prepared-context receipt | Process memory only until dispatch | Continuity Service returns; writes nothing |
| Redacted dispatched-context audit receipt | Local app audit store | Desktop after provider dispatch |
| Checkpoint receipts | Local durable receipt store | Application after relay acknowledgement |

## Public/private boundary

- Ordinary group rooms are relay-authorized, not described as end-to-end
  encrypted.
- NIP-AE Capsule content is encrypted, while the agent-owner relationship is
  visible as protocol metadata.
- Remote providers receive only the final approved request. This may include
  approved Capsule plaintext and brain context; setup disallows a remote runtime
  for a Capsule whose egress policy is `local_only`. Protected brain records are
  excluded before construction and the complete request is rechecked before
  transport framing/TLS.
- Cryptographic identity continuity does not imply runtime or model continuity.
  The resident signing identity and Capsule persist while its configured model
  or provider may be replaced.
- Local file paths are owner-UI metadata. Models, telemetry and exported
  receipts receive opaque source IDs and sanitized labels.
- The G1 managed-agent path has desktop-local installation/session binding.
  Remote relay admission and old-installation revocation are added and proved
  by the later managed coordinator; G1 does not infer that server-side claim.

## Explicitly deferred

- conductor or mandatory Luca routing;
- ambient cognition, recurrence, proactive initiation and autonomous chains;
- the full Polyphonic inner-life engine;
- an embedded desktop relay;
- multi-user organizations and invited humans;
- a full Brain dashboard, Atlas, Inbox, browser observation and whiteboard;
- ordinary-room E2EE;
- mobile and voice completion.
