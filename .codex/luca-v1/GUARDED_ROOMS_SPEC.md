# Guarded Multi-Agent Rooms V1

## Goal

Use standard Buzz rooms and signed actors to let residents communicate directly.
There is no hidden router, conductor or special Luca authority.

## Root causal envelope

Each agent-triggering event carries or derives one application envelope:

```ts
interface RootCausalEnvelopeV1 {
  protocol: "luca.causal.v1";
  root_id: string;
  root_event_id: string;
  parent_event_id: string;
  depth: number;
  max_depth: number;
  deadline_at: string;
  cancellation_id: string;
  dispatch_id: string;
}
```

The signed event carries only opaque root/parent/dispatch references, depth and
deadline. Authoritative turn, token, spend, reservation and cancellation state
lives in an app-owned SQLite root ledger; mutable `*_used` counters never appear
as authority in the event envelope.

The root is created for an owner-triggered multi-agent exchange. Every descendant
inherits the same root limits. A child may reduce remaining limits, never reset
or increase them.

## Event and authority encoding

Agent-authored descendant messages include one compact namespaced Nostr tag with
protocol version and opaque root, parent and dispatch references plus depth and
deadline. This makes ancestry inspectable in the canonical conversation event
without pretending mutable counters are relay authority. The full root record,
reservations, counters, cancellation epoch and idempotency receipts live in the
durable local SQLite causal store.

Inbound tags are descriptive, never authority. The host verifies the signed
event author, looks up the matching accepted dispatch receipt and derives all
limits from the local root record. A forged/missing descendant receipt cannot
trigger another agent. An owner-authored message without a causal tag may create
a new root under application policy.

## Dispatch rules

- An owner starts a root by explicitly mentioning/selecting its initial
  responders. A resident can trigger another resident only by an explicit signed
  mention in a descendant message under the same root. Unmentioned residents do
  not run; ambient room response policies are disabled for V1 guarded roots.
- An agent may address another resident only through a signed room event and an
  approved dispatch envelope.
- `dispatch_id` is idempotent; replay is ignored after one accepted dispatch.
- if the causal control store is unavailable, agent-to-agent descendant dispatch
  fails closed while ordinary owner-to-agent conversation remains available;
- Before runtime invocation, SQLite `BEGIN IMMEDIATE` atomically checks the
  latest cancellation epoch/deadline/depth, reserves one of the six turn slots,
  a maximum token allowance and a maximum provider-spend allowance, and records
  the dispatch idempotency key. Concurrent dispatches cannot double-reserve.
- Provider adapters reconcile actual usage/cost against the reservation;
  externally incurred spend counts even if a later response is cancelled.
- `depth + 1 > max_depth`, deadline expiry, cancellation, failed reservation or
  exhausted budget stops dispatch before runtime invocation.
- V1 defaults: maximum depth 2, maximum 6 agent turns per root, explicit token
  and provider-spend caps.
- No descendant creates a background, scheduled or recurring job.
- The user's cancel action cancels all active descendants under `cancellation_id`.
- The current cancellation epoch is rechecked immediately before the final
  signed message and every app-mediated durable or tool side effect. Completed
  external side effects cannot be undone and are reported as such.

## Per-responder memory rule

For every resident response, the host calls `context.prepare.v1` using that
resident's authenticated handle. It never reuses the sender's rendered context
or access result. `agent_private` memory belonging to agent A cannot appear in
agent B's outbound provider payload even when A authored the triggering message.

## Activity and authorship

The thread remains the product surface. Existing Buzz observer/activity events
may show queued, preparing context, running, streaming, completed, failed and
cancelled states. They must be attributable to the signed resident and root ID.
No separate orchestration drawer is required for V1.

## Required tests

- three residents speak as distinct signed identities in one room;
- direct A-to-B message without Luca present;
- recursive A-to-B-to-A fixture stops at deterministic depth;
- root token/spend/deadline never resets;
- concurrent responders cannot double-reserve a turn, token or spend budget;
- unmentioned residents do not run; agent-to-agent dispatch requires an exact
  signed mention;
- duplicate dispatch executes once;
- cancellation stops app-mediated descendants and late finals; already-complete
  external side effects are retained and attributed;
- replay/reconnect produces one chronology;
- malicious message cannot widen causal limits;
- agent-private context never crosses responders;
- Continuity Service outage subtracts memory but room conversation continues.
