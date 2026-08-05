# G2 write ownership

The integration lead owns workspace manifests, lockfiles, shared migrations,
Tauri command registration, cross-lane merges, acceptance state, and gate
verdicts. Workers must not broaden ownership without coordination.

| Lane | Primary ownership | Forbidden independent decisions |
|---|---|---|
| `protocol_storage` | `luca-protocol`, `luca-continuity`, continuity schemas/vectors | Key custody, Tauri lifecycle, ACP routing, UI policy |
| `runtime_cognition` | ACP history/context integration; desktop continuity/cognition runtime modules | Protocol shape after freeze, owner-brain UI, import mapping policy |
| `import_frontend` | Discovery/import desktop modules and continuity/brain/onboarding React surfaces | Crypto primitives, relay semantics, runtime substitution, provider policy |
| `control` | Build docs, evidence, validators, integration, gates | Product behavior outside approved spec |

Pure record cryptography and repository traits belong to `protocol_storage`.
OS keychain operations, encrypted SQLite, NIP-AE crypto execution, application
lifecycle, and process integration belong to `runtime_cognition`. The control
integrator alone applies manifest, lockfile, module-registration, and command-
registration edits required to join those lanes.

Owner-brain/grant policy and pure repository traits belong to
`protocol_storage`; grant persistence, provider-egress enforcement, and
effective outbound payload capture belong to `runtime_cognition`.

## Shared-file mutex

Only the integration lead edits these during parallel work:

- root `Cargo.toml` and `Cargo.lock`;
- `desktop/src-tauri/Cargo.toml` and lock-affecting dependency changes;
- `desktop/src-tauri/src/lib.rs` and Tauri command registration;
- shared database migration registries;
- existing G1 authority modules;
- `AGENTS.md`, `HANDOFF.md`, and gate verdicts.

Workers propose the minimal shared edit in their receipt; the integrator applies
it after review.

## Parallelism rule

At most three write lanes may run concurrently, each with disjoint files. Read-
only review may overlap. No worker spawns another write worker. Integration is
serial and followed by focused tests for every impacted lane.
