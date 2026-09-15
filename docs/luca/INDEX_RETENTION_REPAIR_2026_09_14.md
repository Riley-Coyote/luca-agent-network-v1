# Connected Brain index retention repair

The connected index is replaceable derived data. Completed deletion receipts
must remain permanent, but need not occupy the bounded, fully hydrated live
revision ledger. Schema 5 stores complete validated, body-free snapshots of
completed owner-Brain index-page purges in `continuity_index_archive`. Indexed
record-ID and nonce reservations reject reintroduction, including generic
record inserts and owner-generation replacement. Resident memory, grants,
active pages and incomplete purges are not archived.

Archival, ciphertext reconciliation and live-generation advancement share the
same SQLite transaction. Failure rolls all of them back. Old safety metadata
is preserved, not deleted. The on-disk safety archive remains append-only;
this fixes live index-page capacity, not the general finite revision-history
limits for durable source/grant/memory records.

Schema 4 upgrades in place. Before index connect/refresh/rebind, existing
completed purges are compacted so an already-full legacy working set can
recover. Future completed index purges leave that set immediately. Replacement
page IDs include the prior generation, so A -> B -> A creates a fresh incarnation
rather than attempting to revive A's forgotten page. Brain revision IDs also
include the revision counter, preventing identical content in later legitimate
status/grant cycles from colliding with an earlier immutable record.

## Delivery and rollback

Back up the encrypted SQLite database consistently before installing schema 5.
Old schema-4 binaries reject schema 5 rather than ignoring its safety archive.
Rollback therefore requires both the retained app and its paired database;
never silently restore an older database over memory saved after migration.
Do not modify the separately installed Polyphonic beta during Dev verification.

## Verification

- Repeated changing indexes, including A -> B -> A, retain one live page for a
  one-page source; the archived receipts remain valid without ciphertext.
- Retired record IDs and nonces are rejected before and after restart.
- A populated v4 source survives schema upgrade without resetting its identity.
- Injected SQLite failure rolls back archival and live-state changes together.
- A copy of the existing Dev database migrated 4,054 completed index purges,
  leaving 43 live lineages; every current encrypted record remained identical.
- Continuity, Brain, first-meeting checks and installed-app validation must pass
  before this repair is treated as delivered.
