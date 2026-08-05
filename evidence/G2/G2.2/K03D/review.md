# K03D independent security review

Final verdict: BLOCK.

Closed findings:

- existing WAL/SHM sidecars now fail closed before immutable read-only preflight,
  preserving byte-for-byte zero mutation;
- normal structural loads use a metadata pass followed by guarded blob fetch;
- the frozen table and all required indexes are validated exactly, including
  type, nullability, primary key, CHECK, uniqueness, origin, partial flag, and
  ordered columns.

Remaining P1 findings:

1. The metadata pass reads corrupt persisted `record_id` as an unbounded
   `String`; use a bounded predicate plus an integer `rowid` handle.
2. The replay path reads an existing `envelope_json` into an unbounded `Vec`
   before checking stored length; use a length pass followed by a guarded fetch.

The same allocation-safety class survived the authorized repair. Under the
task's one-repair rule, implementation stopped instead of looping.
