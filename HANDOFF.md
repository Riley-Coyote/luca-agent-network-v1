# Luca V1 continuation handoff

Updated: 2026-08-04

Repository: `Riley-Coyote/luca-agent-network-v1`

Authoritative continuation branch: `agent/runtime-reliability`

Current commit: `fa1c5194` (`Harden native resident runtime reliability`)

This document is the repository-native source of truth for continuing Luca V1.
It supersedes older product assumptions in the upstream Buzz README and older
planning documents when they conflict with the current implemented product.

## Start here

For a new agent or developer:

```bash
git clone https://github.com/Riley-Coyote/luca-agent-network-v1.git
cd luca-agent-network-v1
git switch agent/runtime-reliability
. ./bin/activate-hermit
```

Then read, in order:

1. This file.
2. [`docs/luca/G1_CHECKLIST.md`](docs/luca/G1_CHECKLIST.md).
3. [`docs/luca-native-residents.md`](docs/luca-native-residents.md).
4. [`.codex/luca-v1/USABLE_BUILD_MODE.md`](.codex/luca-v1/USABLE_BUILD_MODE.md).
5. [`.codex/luca-v1/RUNTIME_PARITY_DELTA.md`](.codex/luca-v1/RUNTIME_PARITY_DELTA.md).
6. [`.codex/luca-v1/ARCHITECTURE_IMPLEMENTATION_SPEC.md`](.codex/luca-v1/ARCHITECTURE_IMPLEMENTATION_SPEC.md) for the longer original architecture.
7. [`.codex/luca-v1/SECURITY_THREAT_MODEL.md`](.codex/luca-v1/SECURITY_THREAT_MODEL.md) before authority, signing, identity, permission, or recovery changes.
8. [`docs/luca/REPLY_ADDRESSING.md`](docs/luca/REPLY_ADDRESSING.md) before changing
   who a message wakes up. The rule is decided and unimplemented; it carries an
   agent-to-agent loop risk that needs settling before it ships.
9. [`docs/luca/PROJECTS.md`](docs/luca/PROJECTS.md) before building project
   grouping. Design is settled and the UI is prototyped; the data model is not
   built. Note the hard constraint: a local repo path must never go on the relay.

The `.codex/luca-v1` directory contains the complete planning kit, contracts,
task graph, protocol maps, and historical decisions. `HANDOFF.md` records the
newer simplifications and actual implementation state.

## Product in one paragraph

Luca is a personal home where one owner can talk directly with persistent AI
residents in ordinary DMs and multi-agent conversations. Every resident has a
stable cryptographic identity that remains the same when its model, executable,
or runtime session changes. Residents can be imported read-only from the user's
existing Hermes profiles and OpenClaw agents. Buzz supplies the proven signed
conversation log, realtime messaging, attachments, search, desktop shell, and
ACP harness. Luca supplies the personal product model, resident custody,
runtime bindings, host-owned reply publication, continuity seams, and UI.

There is no conductor. Luca may be a resident, but is not a privileged router.
Mnemos universal-brain retrieval and the fuller Polyphonic inner-life engine are
future slices and must not be pulled into the current runtime critical path.

## The architectural boundary

```text
Luca desktop (Tauri + React)
  - owner identity and local secure custody
  - personal-home onboarding and navigation
  - conversations, import UI, approvals, cancellation, activity
  - sole ordinary managed-reply publisher and resident signer
                |
                v
Buzz relay and signed Nostr event log
  - canonical chronology, authorship, rooms, DMs, threads
  - realtime delivery, replay, search, attachments
                |
                v
Managed ACP host (buzz-acp)
  - fresh runtime sessions
  - bounded signed-history rehydration
  - Hermes/OpenClaw adaptation
  - local permission channel and process-group lifecycle
                |
                v
Native runtime binding
  - exact Hermes profile OR exact OpenClaw agent/gateway
  - native configuration and credentials remain native-owned
```

Authority rules:

- The desktop owns resident keys and ordinary response publication.
- ACP/model/tool descendants never receive owner or resident signing authority.
- A resident identity is separate from its mutable runtime binding.
- Messages succeed without Mnemos, Capsule, or post-turn cognition.
- Native discovery/import never edits Hermes or OpenClaw configuration.
- Raw reasoning stays private. Only final responses and explicit activity state
  belong in the conversation UX.

## What is implemented

### Luca application foundation

- Separate Buzz-derived repository pinned initially to Buzz commit
  `7e34bee62cacaa9d8a96c14d5892a471b59a1983`.
- Personal owner onboarding and automatic internal personal-home tenancy.
- Buzz community/workspace setup is removed from the normal Luca path.
- Public-facing Luca identity, dark personal shell, and simplified navigation.
- Optional native starter residents are Luca, Vektor, and Anima; legacy Fizz,
  Honey, and Bumble defaults were removed from the Luca flow.
- Existing relay messaging, search, media, attachments, signing, and realtime
  infrastructure remain underneath.

### Conversation-first shell

- Selecting a DM or room opens its timeline directly instead of an inbox-style
  intermediary.
- Replies expand inline in the main conversation rather than requiring the
  legacy thread drawer.
- The right side is reserved for optional agent/activity/context inspection.
- Open, bubble-free timelines and the existing composer remain canonical.
- Stable key-derived 7x7 identity specimens are used across resident surfaces.
- The shell is a dark graphite/slate system; the separate vision branch contains
  additional design exploration but is not production authority.

### Managed resident identity and publication

- Desktop-owned resident registry and key-safe resident creation.
- Private keys stay in native secure storage and never cross renderer IPC.
- Typed signing-broker and relay-auth boundaries.
- Exact managed dispatch authority and an encrypted final-publication outbox.
- One canonical host-published final response per admitted managed dispatch.
- Conversation success is independent of continuity services.

### Hermes and OpenClaw imports

- Read-only structured discovery reports `available`, `absent`, `degraded`, or
  `failed` instead of silently returning an empty list.
- Hermes semantic identity is canonical Hermes home plus exact profile name.
- OpenClaw semantic identity is canonical daemon configuration, stable gateway
  locator, and exact agent ID.
- Executable, version, and normalized configuration form a separate binding
  fingerprint.
- Re-import reuses the resident key and refreshes only a revalidated binding.
- Offline/missing runtimes leave the same resident visible as degraded; Luca
  never substitutes another profile, agent, gateway, or runtime.
- Luca does not copy credentials or mutate native configuration.

### Relaunch recovery

- Startup performs one bounded reconciliation pass over frozen final responses.
- Prior-epoch unresolved work becomes `Interrupted(Restart)` only after outbox
  authority is terminal.
- Residents with `start_on_app_launch` are restored with fresh ACP sessions.
- Sessions are rehydrated from bounded signed Luca conversation history.
- OpenClaw keeps a deterministic conversation key, but Luca does not claim the
  native runtime restored its own transcript.

### Cancellation

- Cancellation is a typed desktop operation bound to owner, conversation,
  resident, dispatch, and session epoch.
- Durable cancellation happens before the signed owner control event.
- Because the relay does not expose a desktop-visible harness acknowledgement,
  Luca waits five seconds and conservatively restarts the exact managed process
  group.
- If a final may already have reached the relay, the UI reports
  `publication_ambiguous`; it never promises that an already-submitted final
  cannot appear.

### Managed permissions

- Managed runtimes no longer auto-approve permissions.
- A dedicated local Unix control channel carries only permission requests and
  decisions; it is separate from signing/key custody and never published.
- Requests bind resident, session epoch, turn, conversation, and ACP request ID.
- The UI displays the exact runtime-advertised options above the composer and in
  Activity; it never invents `allow_once` or persistent policy.
- Requests fail closed on timeout, cancellation, stale epoch, malformed input,
  runtime exit, or app closure.
- The bootstrap permission descriptor is consumed before model/tool spawn. A
  production-path regression test proves direct and nested descendants do not
  inherit the socket.

## Branch and commit map

| Branch | Purpose | Relationship |
|---|---|---|
| `luca/v1` | Older integrated usable baseline | Remote default; commit `265c3543` |
| `agent/conversation-first-shell` | Conversation-first UI checkpoint | Commit `d75d731b`, based on `luca/v1` |
| `agent/runtime-reliability` | **Current integrated continuation branch** | Commit `fa1c5194`, includes conversation-first shell |
| `agent/vision-demo` | High-fidelity simulated design exploration | Reference only; do not merge wholesale |
| `main` | Untouched Buzz baseline | Tracks upstream baseline, not Luca continuation |

New work should branch from `agent/runtime-reliability`:

```bash
git switch agent/runtime-reliability
git pull --ff-only
git switch -c agent/<short-task-name>
```

Do not restart from `main`, transplant these changes into an older Luca app, or
merge `agent/vision-demo` wholesale.

## Source map for current Luca work

| Concern | Primary locations |
|---|---|
| Product flags and personal home | `desktop/src/app/lucaFeatureFlags.ts`, `desktop/src/app/personalHomeTenancy.ts` |
| Owner onboarding/recovery | `desktop/src/features/onboarding/`, `desktop/src-tauri/src/commands/identity.rs` |
| Conversation-first UI | `desktop/src/features/home/ui/HomeView.tsx`, `desktop/src/features/channels/ui/`, `desktop/src/features/sidebar/` |
| Identity specimens | `desktop/src/shared/ui/AgentIdentitySpecimen.tsx` |
| Native discovery/bindings | `desktop/src-tauri/src/managed_agents/native_runtime.rs`, `desktop/src-tauri/src/commands/agent_discovery.rs` |
| Resident registry | `desktop/src-tauri/src/luca/resident_registry.rs` |
| Managed runtime lifecycle | `desktop/src-tauri/src/managed_agents/runtime.rs` |
| ACP protocol/permissions | `crates/buzz-acp/src/acp.rs`, `crates/luca-protocol/src/managed_permission.rs` |
| Dispatch/restart authority | `desktop/src-tauri/src/luca/managed_dispatch_store.rs`, `desktop/src-tauri/src/luca/signing_broker.rs` |
| Final publication/outbox | `desktop/src-tauri/src/luca/managed_message_publisher.rs`, `desktop/src-tauri/src/luca/managed_message_outbox.rs` |
| Cancellation command | `desktop/src-tauri/src/commands/messages.rs` |
| Permission UI | `desktop/src/features/agents/ui/ManagedPermissionCard.tsx`, `desktop/src/features/agents/useManagedPermissions.ts` |
| Native import UI | `desktop/src/features/agents/ui/NativeResidentImportSection.tsx` |
| Planning/contracts | `.codex/luca-v1/` |

## Local development

Prerequisites are Docker Desktop and the repository's Hermit environment.

```bash
. ./bin/activate-hermit
just bootstrap
just dev
```

`just dev` starts the relay and Tauri desktop together. The relay defaults to
`ws://localhost:3000`. The checked-in upstream development wrapper may still use
Buzz-derived internal binary names and development bundle identifiers; visible
Luca branding and product behavior are the application authority. Do not mass
rename Rust crates or protocol symbols merely for appearance.

Useful focused commands:

```bash
# Frontend
cd desktop
pnpm typecheck
pnpm build

# Back at repository root
. ./bin/activate-hermit
cargo test -p luca-protocol
cargo test -p buzz-acp permission --lib
cargo test -p buzz-acp luca_descendant_isolation_managed_spawn_uses_pipe_and_scrubs_nested_shell --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml native_runtime --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_dispatch_store --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_cancel_status --lib
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

Follow `.codex/luca-v1/USABLE_BUILD_MODE.md`: one focused attempt, at most one
evidence-based repair, then stop and report instead of looping.

## Verification state at handoff

Passed on the current reliability commit:

- Rust formatting and diff checks.
- `luca-protocol` tests, including managed permission binding/stale decisions.
- Focused `buzz-acp` permission tests.
- Native discovery/semantic identity/binding tests.
- Resident idempotency tests.
- Managed dispatch and exact restart-recovery tests.
- Cancellation truthfulness tests.
- Native environment/credential isolation tests.
- Direct and nested permission-socket inheritance regression test.
- Desktop Rust check.
- Frontend TypeScript check, focused Biome check, and production build.
- Independent security review with no remaining P0/P1 in this slice.

The actual Luca dev process was running with two managed ACP residents at the
end of the session. GUI automation could not attach to the custom development
bundle, so the final post-change interactive matrix was not claimed.

## What is not complete

- Formal G1 is not complete. See the exact repository checklist.
- The final rebuilt ACP harness still needs a clean app restart and interactive
  Hermes/OpenClaw verification.
- Full upstream messaging regression, clean-profile branding/onboarding,
  attachment/media/search, and installed-app smoke are not closed for G1.
- Managed permission scenarios need a real runtime-triggered UI smoke.
- Mnemos universal-brain retrieval and writing are intentionally absent.
- Continuity Capsule, consolidation, reflection, and fuller autonomous inner
  life are intentionally deferred.
- Native ACP transcript/session restoration is not claimed; Luca rehydrates
  from signed conversation history.
- Mobile, shared whiteboard, multi-user collaboration, and full rebranding of
  internal upstream identifiers are deferred.

## Next action

Continue with [`docs/luca/G1_CHECKLIST.md`](docs/luca/G1_CHECKLIST.md). First
restart the app from the current branch so the final `buzz-acp` binary is active,
then run the native interactive matrix once. Repair only concrete failures. Do
not begin Mnemos integration until the messaging/runtime gate is stable or Riley
explicitly changes priority.

## Repository hygiene

- Preserve untracked `evidence/` and cache material in an existing local
  checkout. It may belong to earlier work and must not be deleted or bulk-added.
- Do not publish raw logs or environment captures without the artifact/secret
  scanner.
- Stage explicit files; never use a blanket add in a mixed worktree.
- Keep `upstream` pointed at `block/buzz` for selective future synchronization.
- Preserve Apache notices and upstream copyright.

## Settled decisions

- Build Luca on Buzz; do not transplant Buzz into the old Luca repository.
- No conductor in V1.
- Direct human-resident and resident-room conversation is the primary product.
- Buzz events are canonical chronology/authorship; Luca continuity systems own
  meaning and memory later.
- Stable resident identity is independent of model/runtime/session.
- Native imports are links, not migrations.
- Security truthfulness outranks optimistic UX claims.
- Production-grade exhaustive verification is deferred until Riley re-enables
  it, but authority, identity, privacy, and data-loss protections are never
  weakened for speed.
