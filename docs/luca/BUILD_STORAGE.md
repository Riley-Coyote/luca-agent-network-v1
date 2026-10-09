# Local build storage

Policy established with Riley on October 8, 2026. This is development storage,
not the app's Brain, resident memory, native harness profiles or user data.

## Hot working set: internal SSD

Keep the current worktree, its own `node_modules`, pnpm store, Rust toolchain,
Cargo downloads, compiled dependencies, running servers and native proof files
on the internal SSD. Never move them to an external disk or substitute an
external symlink. Do not share a worktree's `node_modules` with another tree.

Use the existing local Rust target rather than creating another full target
for every test or agent:

```sh
bash scripts/with-internal-build-cache.sh --check
bash scripts/with-internal-build-cache.sh cargo test -p luca-protocol --test initiative
bash scripts/with-internal-build-cache.sh cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib companion_
```

Activate the existing toolchain first. The helper checks the actual data-volume
device, including resolved directory symlinks; exports the internal target and
`CARGO_INCREMENTAL=0`; and refuses to start below 20 GiB free. It does not clean
or build anything during `--check`. This is a **preflight**, not a hard quota or
a guarantee that a large build will fit. Measure again between native builds.
The reserve can be explicitly raised with `POLYPHONIC_BUILD_RESERVE_GIB` (minimum
8 GiB); do not lower it simply to force a build through a full disk.

Both dev and test profiles disable incremental snapshots in `.cargo/config.toml`.
Cargo still reuses compiled dependencies. Keep the existing line-table debug
information; changing compiler, debug level, features or profile can create a
new set of artifacts and invalidate the reusable set.

An isolated native candidate may require its own target under
`~/Library/Caches/luca-build/`. Keep its candidate identity/profile isolation.
Budget for that target explicitly, then archive it when its proof is finished.
Do not weaken candidate checks just to reuse an installed app or save space.

Frontend checks should reuse this worktree's frozen-lock install. Avoid repeated
installs, release builds and whole-repository Rust builds when a focused check
answers the question. Keep pnpm's content-addressed store internal.

## Cold set: verified external archives

Finished release installers, signed bundles, receipts, completed proof outputs
and unused build profiles can leave the SSD. Preserve release records as a unit.
Source, Git metadata, uncommitted work, keys and runtime databases are not
disposable build caches.

Before an archival move:

1. Resolve exact source paths and distinguish generated output from source.
2. Check other active chats, build processes and open files. Another chat's
   cleanup or transfer is hands-off until its state is clear.
3. Verify the destination volume's UUID, mount, filesystem and available space.
   Do not treat a newly remounted path as the same drive without checking.
4. Copy to a new dated destination, preserving file data, symlinks, permissions
   and native bundle metadata. Use an archive container on ExFAT; do not flatten
   a native bundle or dependency tree onto a filesystem that cannot preserve it.
5. Verify every file against the still-present source. Recheck that neither a
   build nor the source changed. Record source, destination and verification.
6. Only then remove the exact archived originals. Never empty Trash broadly,
   clean whole worktrees or run `cargo clean` as a storage shortcut.

If the drive disconnects, verification fails or usage becomes uncertain, keep
the SSD originals. No automatic age-based deletion: old files may still be the
only release, rollback or work record.

The October 8 cold archive is under
`/Volumes/LaCie/Luca-Development/ColdArchives/2026-10-08-polyphonic/`:

- `shared-cargo-release-september-2026`: the unused September release profile.
- `completed-beta-deliveries-6-through-13`: finished beta installers and delivery
  records from the older shipping worktree's ignored `target` directory.

Read that archive's receipt before treating the move as complete. The current
debug cache and companion-initiative source/dependencies remain internal.
Restoration means copying an archived target **back to the SSD** before reuse,
never compiling or launching a proof directly from the external archive.
