# Resident continuity repair — September 13, 2026

Integration branch: `codex/resident-continuity-repair`, based on
`0838a6cbf86d0b134f5db5ec1a2d73e37503f5a1`. Dev only; no beta cut.

## Confirmed failures

1. Managed Claude sessions inherited the owner's native SessionStart hook and
   global Mnemos MCP configuration. Both selected the shared `claude-code`
   identity/store, so Trinity received an unrelated native build-session note.
   The installed app's resident-private encrypted store is a separate system;
   absence of a native `trinity.db` was not itself the app continuity failure.
2. Private Claude handoff capture did not recognize the adapter's model option
   `id`, and rejected the requested model before capture.
3. Native Claude settings could independently supply `bypassPermissions` as the
   initial mode. Managed default-mode sessions now require explicit runtime
   acknowledgement of the app's `default` permission mode before prompting.
4. The owner revision authority reached its 4,096-lineage capacity, mainly from
   forgotten connected-Brain index generations. New resident handoffs could not
   create a lineage. Capacity errors were incorrectly shown as invalid output.
5. Managed wake resolution had a three-second limit but repeatedly loaded and
   validated the entire owner ledger. A read-only diagnostic of the encrypted
   backup measured 4.05 seconds for one load and 7.15 seconds for the old
   resident capture reads. The runtime therefore received no app handoff.

## Changes

- Managed Claude ordinary and private sessions exclude inherited user/project
  settings and global MCP configuration. Explicit app-provided MCP tools and
  Claude's built-in tools remain available. Standalone native configuration and
  native memory files are unchanged.
- Model selection accepts the installed adapter's `id` field with a legacy
  `configId` fallback. Permission mode application requires the acknowledged
  current value, not merely a successful RPC.
- Reserve 512 additional authority heads for resident-private continuity only.
  Non-resident admission remains capped at the previous limit. Ciphertext,
  replay, decoding and per-lineage bounds remain enforced. Capacity exhaustion
  is explicit and does not repeatedly retry an impossible save.
- Replace repeated linear scans in pure snapshot validation/export with indexed
  lookups. Fingerprinting still performs full snapshot validation; redundant
  hydrate/export validation and a second read of the same immutable snapshot
  are removed.
- Reuse one fully validated, owner-bound encrypted generation per open store.
  No plaintext, negative result or failed validation is cached. A cache entry is
  invalidated by local row/schema changes or another connection's commits.
  SQLite change stamps are checked outside the read transaction both before and
  after it commits; an intervening write rejects the result before release.
  CAS writers always load and validate fresh authority. Rotation and exact
  resident/scope checks remain active on cached reads.
- Emit body-free operational warnings for missing/expired managed context.

The change-stamp design uses SQLite's documented connection-local
[`data_version`](https://www.sqlite.org/pragma.html#pragma_data_version), plus
local total-change and schema-version counters. Cache state dies with the
owner runtime's store; it is not a module-global cache.

## Acceptance and remaining work

Focused checks: 62 pure continuity library tests, 19 desktop revision-authority
tests (including cache tamper/concurrent-write tests), and 16 ACP continuity
provider tests pass. Earlier model, settings isolation, permission-mode and
capacity regressions also pass, together with TypeScript and scoped formatting.
On the same read-only encrypted backup, repaired cold load + capture +
revalidation measured 2.17 seconds; subsequent capture/revalidation were each
below 1 ms and a warm full-generation read was 7 ms. This is local Dev evidence,
not a timing guarantee for other machines or arbitrary concurrent workloads.

Real native acceptance and final revision are recorded in the installed Dev
bundle's `Contents/Resources/luca-source.json` and the local repair receipt.
Trinity's repaired capture has already committed a real handoff and the
Notebook displays it as saved. Fresh-session delivery and final read timing
are still under verification at this source checkpoint.

Connected-Brain index retention remains a separate beta blocker: changed
indexes create new page lineages, and forgetting/purging their ciphertext keeps
the old authority/tombstones for replay and nonce safety. The resident reserve
protects handoffs but does not reclaim owner-Brain capacity. Do not delete
forgotten authority or claim the reserve solves lifetime index growth. A bounded
retention/compaction design and migration must preserve those safety properties.

The original installed Dev app and a consistent encrypted database backup were
preserved before the capacity change. The old binary's 4,096-head reader cannot
read a later store beyond that bound: rollback must account for the database
backup as well as the app, without silently discarding newly saved memory.
