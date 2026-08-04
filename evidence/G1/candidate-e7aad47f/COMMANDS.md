# Reproducible focused commands

Activate the checked-in Hermit environment before running these commands.

```sh
cargo test -p luca-protocol
cargo test -p buzz-acp permission --lib
cargo test -p buzz-acp luca_descendant_isolation_ --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_cancel_status --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_dispatch_store --lib
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

From the desktop package:

```sh
pnpm typecheck
pnpm exec biome check src/features/channels/ui/ConversationAgentActivityStrip.tsx src/shared/api/agentControl.ts src/shared/api/types.ts src/features/agents/ui/NativeResidentImportSection.tsx
node --import ./test-loader.mjs --experimental-strip-types --test src/features/messages/lib/timelineSnapshot.test.mjs src/features/messages/ui/timelineSnapshotProjection.test.mjs
pnpm build
```

From the repository root:

```sh
just test-integration
scripts/rebuild-luca-dev-app.sh
```

The live permission, cancellation, crash, binding-degradation, attachment, and
search cases require the installed native app; the browser E2E bridge mocks the
Tauri runtime boundary and is not authoritative for those checks.

