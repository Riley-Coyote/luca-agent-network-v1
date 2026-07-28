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
- the exclusive desktop/ACP socketpair is carried as the managed harness's
  standard input, so no broker descriptor number, socket path or bearer token
  appears in argv or the environment; model/runtime children receive their own
  replacement stdin and cannot inherit the broker stream;
- managed final publication uses `message.publish.v1`;
- key-dependent Buzz side effects that are not yet represented by a typed
  operation are disabled with an explicit status in managed mode, while the
  legacy path remains unchanged;
- `F09`, which already depends on F14, owns successful ACP chunk aggregation
  and the one-final-message handoff. F14 proves the broker/authentication and
  descendant-isolation foundation; it does not test a future F09 seam;
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
