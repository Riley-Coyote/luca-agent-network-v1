# K05D durable revision authority reconnaissance

Status: read-only seam audit complete; implementation required before K06 may
close G2.2.

## Finding

K05's pure `RevisionLedger` correctly owns in-process lineage and lifecycle,
including a known root's active head. The encrypted SQLite records do not yet
persist enough body-free authority to reconstruct those decisions after a
restart. Archive and Forget can have no successor envelope, so selecting the
largest revision number would resurrect records that were intentionally made
inactive.

Encrypted rows therefore cannot be treated as revision authority. Durable
lineage state must be written atomically with each revision transition.

## Required authority state

The trusted desktop store needs a body-free authoritative state for every
known lineage:

- owner and resident namespace;
- lineage/root record ID;
- active head record ID, or an explicit absent head;
- lifecycle state, including active, archived, and forgotten;
- pinned owner-correction authority;
- derived-artifact inventory and source binding;
- transition/idempotency key and schema version;
- active encryption-key version and immutable generation reference.

The state must not contain record bodies, titles, tags, journal text, or
context packets.

## Pure-ledger seam

Add a deterministic `RevisionLedger::active_heads()` projection returning a
bounded list of `ActiveRevisionHead` values. The pure ledger remains the
semantic authority for valid transitions; SQLite persists its committed
body-free projection. No restart path may infer state from ciphertext order,
timestamps, or maximum revision number.

## Atomic transition

One compare-and-swap transaction must:

1. verify the expected lineage generation and idempotency key;
2. insert the successor encrypted envelope when the transition creates one;
3. update the authoritative lineage head/lifecycle row;
4. update any derived-artifact and pinned-correction authority;
5. advance the immutable generation;
6. commit all changes together or none of them.

Archive and Forget transitions must update authority even when they create no
successor envelope. Replaying the same transition must return the original
terminal result without another write.

## Immutable active-generation read

The store must expose one bounded, deterministic ciphertext snapshot for all
active heads belonging to an exact owner and namespace. The snapshot includes
the active key version and generation reference and is ordered by stable IDs.
T01 decrypts and hydrates outside the lifecycle lock; a generation mismatch
causes a fail-soft retry or `stale` result, never mixed-generation context.

## Trusted desktop boundary

One AppState-owned lifecycle lock must serialize pending-restore inspection,
no-mint key loading, authoritative SQLite snapshot capture, and key-version
verification. A strict read-only restore-status seam refuses continuity reads
while restore is pending. Distinct freely constructed locks are not accepted.

## Backup dependency

K06 backup/restore must include the complete revision-authority state and
restore it in the same SQLite transaction as ciphertext and source mappings.
A backup containing only encrypted record rows is incomplete because it cannot
preserve archive, forget, correction, or active-head semantics.

## Required focused tests

- active head and complete lifecycle survive close/reopen;
- archived and forgotten lineages do not reappear after restart;
- successor ciphertext and authority rows commit atomically;
- CAS and idempotency reject stale or conflicting transitions;
- active snapshots are deterministic, bounded, exact-scope, and body-free;
- pre-turn snapshot capture performs zero writes;
- pending restore refuses reads without minting a key;
- rotation/restore cannot expose mixed key generations;
- K06 backup/restore preserves every authority row exactly.

