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

Installed Dev code revision: `4a6f22397b09cb95fccc256035680724b8bf7ac9`.
The final local receipt is in `Contents/Resources/luca-source.json`.

Real native acceptance passed:

- Trinity's private capture committed a handoff; the Notebook displayed Saved.
- After restarting the rebuilt Dev app, a new private Quick Chat received that
  handoff. App screen context was off. The native user input contained the app
  Wake packet with Trinity's key and handoff, no Fifty key, and no inherited
  startup-hook attachments. There was only one user message in the new session.
- Trinity reported receiving the saved handoff, and the subsequent automatic
  private pass committed a new handoff from that separate conversation.
- Fifty's separate new chat received no saved handoff and no Trinity packet or
  startup-hook attachments. Its private pass correctly completed with no change
  for the diagnostic-only exchange. Neither test produced a wake failure warning.
- Inspected the actual Dev window, restored the app-context preference, and
  opened the successful Trinity conversation in the main thread.
- All nine processes from the previous Dev tree exited after the app quit.
  Dev bundle/keyring identity and the original rollback were preserved; the
  installed beta executable is unchanged.

The first delivered handoff describes the earlier failure because its source
conversation predates the repair. This is historical content, not evidence that
delivery is still broken or that the private capture ran as another resident.

The connected-Brain index retention blocker is addressed by the schema-5 repair
in [INDEX_RETENTION_REPAIR_2026_09_14.md](INDEX_RETENTION_REPAIR_2026_09_14.md).
Completed index-purge authority moves out of the live working set into a
permanent on-disk safety archive; replay and nonce reservations remain enforced.
This is not deletion of safety history or an increase to the live capacity limit.

The original installed Dev app and a consistent encrypted database backup were
preserved before the capacity change. The old binary's 4,096-head reader cannot
read a later store beyond that bound: rollback must account for the database
backup as well as the app, without silently discarding newly saved memory.
