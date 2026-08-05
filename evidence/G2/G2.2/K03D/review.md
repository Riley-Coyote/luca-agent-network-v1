# K03D independent security review

Final verdict: PASS after an additional surgical repair explicitly authorized by Riley.

Closed findings:

- existing WAL/SHM sidecars now fail closed before immutable read-only preflight,
  preserving byte-for-byte zero mutation;
- normal structural loads use a metadata pass followed by guarded blob fetch;
- the frozen table and all required indexes are validated exactly, including
  type, nullability, primary key, CHECK, uniqueness, origin, partial flag, and
  ordered columns.

Stop-gate P1 findings:

1. The metadata pass reads corrupt persisted `record_id` as an unbounded
   `String`; use a bounded predicate plus an integer `rowid` handle.
2. The replay path reads an existing `envelope_json` into an unbounded `Vec`
   before checking stored length; use a length pass followed by a guarded fetch.

The same allocation-safety class survived the original authorized repair. Under
the task's one-repair rule, implementation stopped instead of looping.

User-authorized resolution and final re-review:

- load metadata now reads only integer `rowid` plus a lazy storage-class-aware
  BLOB byte length, and fetches one eligible row with the same guard;
- the persisted primary key is compared inside SQLite to the parsed bounded
  envelope ID without loading a corrupt stored string;
- replay lookup now performs the same metadata-first and guarded-fetch sequence;
- NUL-prefixed oversized SQLite TEXT values are proven to report misleading
  text length zero yet are rejected because only BLOB storage reaches length or
  output materialization;
- SQLite EXPLAIN confirms the type/length guards execute before the full output
  Column; prior schema, WAL, scope, replay, nonce, plaintext, key, custody, and
  body-free diagnostic invariants remain intact.

Independent final verdict: PASS with no remaining P0/P1/P2 findings.
