# F14 Option 1 Contract Amendment — 2026-07-27

Status: approved architecture correction

## Decision

The owner approved the feasible V1 correction at the first F14 architecture
stop. This amendment changes execution detail, not product scope:

- ordinary, non-Luca Buzz launches retain the existing `Legacy(Keys)` path;
- Luca-managed residents use `Managed(public identity + typed desktop broker)`;
- the resident private key remains in desktop/keychain authority and is never
  transferred to the ACP host, model, MCP, shell or tool descendants;
- managed relay NIP-42 and NIP-98 authentication uses the allowlisted
  `relay_auth.sign.v1` broker operation;
- the NIP-42 operation preserves Buzz's owner-delegated closed-relay path
  through one optional typed NIP-OA attestation that must equal the app-owned
  stored credential; the two-tag open/direct-member path remains unchanged;
- the exclusive desktop/ACP socketpair is carried as the managed harness's
  standard input, so no broker descriptor number, socket path or bearer token
  appears in argv or the environment; model/runtime children receive their own
  replacement stdin and cannot inherit the broker stream;
- managed final publication uses `message.publish.v1`;
- key-dependent Buzz side effects that are not yet represented by a typed
  operation are disabled with an explicit status in managed mode, while the
  legacy path remains unchanged;
- `F09`, which already depends on F14, owns successful ACP chunk aggregation,
  the one-final-message handoff, and the concrete desktop publication adapter
  that consumes F14's fail-closed authority seam. F14 proves the typed broker,
  exact event construction, authentication and descendant-isolation
  foundation; its default `Unavailable` publication authority is not a G1
  runtime implementation;
- F14 proves desktop-local installation/session binding. Relay-enforced
  admission and revocation of a copied or superseded installation remains a
  managed-coordinator milestone and is not claimed at G1.

## Required contract repair

F13 is reopened for one bounded protocol repair because it is the sole owner of
shared Luca schemas and `crates/luca-protocol`. It adds canonical
`relay_auth.sign.v1` request/result types, schemas and golden vectors, then
receives a fresh independent review before F14 implementation begins.

F14 additionally owns the exact existing ACP seams that retain or consume
`nostr::Keys`:

- `crates/buzz-acp/src/config.rs`
- `crates/buzz-acp/src/relay.rs`
- `crates/buzz-acp/src/pool.rs`
- `crates/buzz-acp/src/setup_mode.rs`

The task must preserve source-compatible legacy behavior and make managed mode
fail closed when the broker is missing, stale, out of sequence or unavailable.

After F14 passes, F09 is explicitly authorized to modify only the following
desktop seams in addition to its ACP-owned files:

- `desktop/src-tauri/src/managed_agents/runtime.rs`
- `desktop/src-tauri/src/luca/mod.rs`
- `desktop/src-tauri/src/luca/signing_broker.rs`
- `desktop/src-tauri/src/luca/managed_message_outbox.rs`
- `desktop/src-tauri/src/luca/managed_message_publisher.rs`

That authority is limited to installing the real relay publication adapter and
binding `message.publish.v1` to desktop-owned active dispatch receipts and
cancellation state. It does not permit new broker operations, generic signing,
key export, unrelated runtime changes, or changes to the F14 transport and
authentication boundary. F09 must prove that the production runtime no longer
uses the default unavailable authority before it can pass.

The ACP-side production handoff necessarily crosses the existing stream reader
and prompt lifecycle. F09 therefore also owns these exact, sequentially
released F14/Buzz seams:

- `crates/buzz-acp/src/acp.rs`
- `crates/buzz-acp/src/pool.rs`

Changes there are limited to collecting bounded public
`agent_message_chunk` updates, clearing them on every non-success exit, and
invoking exactly one typed final handoff after `EndTurn`. F09 may not change
model/tool authority, relay authentication, general prompt scheduling, or
legacy publication behavior.

## G1 claim boundary

G1 may claim:

- no resident secret or usable broker capability is exposed to the ACP model
  process or any descendant;
- a Luca-managed ACP host itself receives no resident private key;
- managed relay authentication and final-message requests use typed,
  session-bound desktop authority;
- ordinary Buzz legacy operation remains regression-tested.

G1 may not claim that a remote relay can reject a copied resident key or revoke
an old installation after transfer. That proof remains assigned to the managed
coordinator and restore milestones.
