# T02 ACP and desktop pre-turn seam reconnaissance

Status: read-only implementation map complete. T02 waits for T01 and three
authority contracts: canonical dispatch-set identity, verified history event
IDs, and a dedicated desktop continuity channel with trusted egress
classification.

## Exact ACP insertion seam

The managed turn builds `PromptContext` in
`crates/buzz-acp/src/lib.rs` after `channel_info` and
`fetch_conversation_context`, then calls `format_prompt` in
`crates/buzz-acp/src/queue.rs`. Continuity should resolve only for the existing
eligible managed owner trigger and be rendered after signed conversation
history but before cancelled/triggering-event content.

The block is a separate `FormatPromptArgs` field and user content only. It may
not enter system/base/core/team/canvas instructions, tools, MCP configuration,
permissions, routing, signing, or the final publisher. When continuity is
absent, prompt bytes remain unchanged.

Eligibility reuses `last_eligible_managed_trigger` and
`ManagedFinalTurn::is_eligible_trigger`, including the existing owner,
signature, kind, author, and conversation constraints. Heartbeats, legacy
events, sibling turns, and invalid events never resolve continuity.

## Dedicated trusted-desktop channel

Use a separate inherited local control socket, modeled on the permission
broker but independent from key custody and message signing:

- environment contract: `LUCA_MANAGED_CONTINUITY_FD=4`;
- close-on-exec, bounded request/response framing;
- included in `LUCA_DESCENDANT_FORBIDDEN_ENV`;
- created by the trusted desktop beside the permission endpoint;
- cancelled on resident exit, session-epoch replacement, or app shutdown.

ACP sends only a typed turn intent: request ID, resident, epoch, turn,
conversation, trigger event ID, ordered verified history IDs, absolute
deadline, and maximum bytes. The desktop verifies and enriches owner, runtime
binding, canonical dispatch set, grants, egress, and T01 snapshot generation.
Failure or channel closure returns `unavailable`; chat continues.

## Dispatch-set authority

`ManagedDispatchStore::stage_owner_event` already creates one row per staged
resident. Add a read-only resolver that binds the exact owner, trigger,
conversation, resident, epoch, and current active dispatch while retaining all
residents in the originally staged set even after individual rows become
terminal.

Freeze a canonical RFC 8785 JSON plus SHA-256 digest over:

- domain and schema version;
- trigger event ID and owner;
- conversation, thread root, and reply target;
- sorted unique originally staged resident public keys.

The digest is order-invariant, remains stable as residents finish, and changes
when membership, routing, trigger, or conversation authority changes.

## Verified signed history

`ContextMessage` currently discards event IDs. The room parser validates event
ID, signature, kind, exact channel, deduplication, and ordering, but thread and
DM parsers deserialize arbitrary JSON without equivalent verification.

Extend `ContextMessage` with the verified event ID. Parse all histories through
`nostr::Event`, enforce exact kind and conversation/thread constraints, reject
tampering, deduplicate by event ID, and order deterministically by `(time,
event_id)`. Expose the final bounded ordered event-ID list to the continuity
request.

## Runtime binding and egress

The current launch-bound `managed_runtime_configuration_sha256` is captured in
`LocalBrokerSessionBinding`, but its `DefaultHasher` derivation is not a stable
cross-build provider-egress identity. B01 needs a canonical binding digest over
the effective runtime, provider, model, endpoint, and allowed environment.

The trusted desktop classifies that exact effective binding:

- demonstrably local inference endpoint: `local`;
- known hosted provider: `remote`;
- missing, custom, Hermes/OpenClaw opaque, or otherwise unresolved: `unknown`.

A local harness or gateway does not make its upstream provider local. Unknown
egress denies owner-brain grants until explicitly resolved or reconfirmed.

## Deadline and cancellation

The continuity deadline is `min(request deadline, 3 seconds)` and is fail-soft.
ACP selects continuity lookup against the existing control receiver. Owner
cancellation before the ACP prompt follows current requeue/drop behavior and
does not invoke ACP cancellation because no model turn exists yet. Existing
turn cancellation and final-publication suppression remain unchanged.

## Required focused tests

- exact prompt-block order; hostile recalled text remains user data;
- no-continuity prompt parity and no authority-input mutation;
- one eligible lookup per managed turn, never for invalid/legacy/sibling work;
- deadline, channel failure, locked store, and cancellation fail soft;
- DM/thread tamper, wrong kind/root/channel, dedupe, order, and bounded IDs;
- dispatch digest stability, membership sensitivity, and authority rejection;
- Hermes/OpenClaw opaque egress is unknown, hosted is remote, proven local is
  local;
- existing F10 Hermes/OpenClaw prompt and native-runtime fixtures remain green.

