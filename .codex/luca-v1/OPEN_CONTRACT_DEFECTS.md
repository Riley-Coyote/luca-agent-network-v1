# Luca V1 Open M1 Contract Defects — 2026-07-22

These issues were found during F02's semantic ownership audit and resolved by
the narrow corrections recorded in `CORRECTIONS.md`.

## OC-01 — Workspace-member integration has no owner

F13 creates `crates/luca-protocol`, F18 creates `crates/luca-diagnostics`, and
F14 creates `crates/luca-signing-client`. The root workspace uses explicit
members, but those tasks neither own `Cargo.toml`/`Cargo.lock` nor may they
override the global integrator-only manifest rule. Assigning the files to all
three would create conflicting writers; assigning future crate members to F13
before their directories exist breaks Cargo workspace resolution.

Resolution: F13, F18 and F14 now use the serialized `integrator` mutex with
explicit manifest/lockfile ownership.

## OC-02 — Desktop Luca module registry has no authority owner

M1 adds multiple `desktop/src-tauri/src/luca/*.rs` modules. Rust requires a
registry declaration in `desktop/src-tauri/src/lib.rs` and/or
`desktop/src-tauri/src/luca/mod.rs`, but no capsule owns the shared registry.
Giving every feature task that file would violate mutex discipline; placing it
in a future task without a stable module list is not deterministic.

Resolution: F14 initializes the desktop registry; later M1 module tasks own the
same registry under `luca_module_registry`.

## OC-03 — ACP final-publisher dependency conflicts with ownership

Resolution: F09 retains publisher ownership and owns its ACP registry entry
under the serialized M1 registry mutex. F14's existing test remains a consumer
of that later seam and is gated by the graph dependency closure.
