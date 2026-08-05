# K05 revision lifecycle reconnaissance

Status: read-only map complete; implementation not started.

## Pure-crate boundary

K05 stays encrypted-body-blind in `luca-continuity`:

- `src/revision.rs`
- exports in `src/lib.rs`
- typed errors in `src/error.rs`
- `tests/revision_lifecycle.rs`

It does not own protocol changes, SQLite, key custody, ACP/runtime, Tauri, UI,
or backup deletion. K03D and K06 later consume its lifecycle and purge
contracts.

## Frozen semantic model

Every operation is append-only. Prior encrypted envelopes remain immutable.

- lifecycle: active, archived, forgotten;
- operations: create, revise, owner correction, rollback, archive, forget;
- revise/correct/rollback require a newly encrypted successor;
- successor namespace, complete scope, record type, key version, revision, and
  predecessor must exactly bind the current lineage head;
- rollback creates a new successor from a selected historical revision rather
  than mutating or reactivating old ciphertext;
- an explicit owner correction pins authority and blocks later automatic or
  resident-authored supersession; only another explicit owner correction may
  replace it;
- archive is reversible operational retirement and preserves history;
- forget is terminal in the ledger and emits a deterministic body-free purge
  plan for all lineage records and derived artifact references.

K05 can prove deterministic forget semantics but cannot claim physical SQLite,
WAL, index, cache, or backup erasure. Those proofs belong to K03D/K06.

## Idempotency contract

The domain-separated operation key binds the full namespace and key version,
complete scope, current head, operation kind, successor or forget target set,
rollback source where applicable, author kind, sorted signed source events, and
request/ciphertext reference.

- identical key plus identical canonical request returns the original receipt;
- identical key plus changed binding is a conflict;
- rejected requests leave the ledger unchanged.

## Required tests

1. monotonic history preservation;
2. idempotent revise/correct/archive/forget;
3. key-reuse conflict;
4. cross-owner/resident/scope/type/version/predecessor rejection;
5. pinned owner correction and later owner override;
6. rollback as a new immutable successor;
7. archive exclusion with history retained;
8. terminal forget and exact deterministic purge plan;
9. descendant and derived-artifact coverage in the purge plan;
10. body-free diagnostics, receipts, and Debug output;
11. stable idempotency and purge-order vectors.

## Explicit omissions

No encryption/decryption, key derivation, disk deletion, SQLite, FTS/cache,
backup deletion, model inference, provider access, runtime execution, or UI.
Archive is not forget, and a UI acknowledgement is not durable-operation proof.
