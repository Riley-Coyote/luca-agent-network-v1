# Luca V1 continuation handoff

> **Current control override (2026-08-12):** Begin with
> [`docs/luca/program-control/00_START_HERE.md`](docs/luca/program-control/00_START_HERE.md)
> and then
> [`docs/luca/program-status/00_START_HERE.md`](docs/luca/program-status/00_START_HERE.md).
> The active order is P0 verified control/product truth, P1 complete visible
> messaging/A2A, P2 projects/native agents/Inbox/Activity/app UX, P3 installed
> functional beta, P4 Mnemos felt continuity, and P5 optional hardening/deferred
> expansion. The proposed combined tester release is `luca/v1-beta`.
>
> The revised graph is not yet Riley-approved. Product teams, integration
> train, release candidate, product implementation, and shared-file writes are
> inactive. The program-control branch is documentation/status only. The
> revised control package passed exact-commit validation at
> `b63d7ca8f41f9c46e71c07dae364ab0aa4f70e8b`. Riley explicitly approved the
> P0–P5 graph and authorized CTRL-004 on 2026-08-12. CTRL-004 is source-tested
> on exact approval receipt `7cc3bc54278eba8300b7c02bd94bd07a4b39e2f3`;
> five-team read-only activation is authorized from that common base.
>
> The detailed milestone material below remains historical architecture and
> evidence. Its older continuation/release priority statements do not override
> the current P0–P5 control package.

Updated: 2026-08-12

Repository: `Riley-Coyote/luca-agent-network-v1`

Authoritative continuation branch: `luca/v1.1`

V1.2 exact product checkpoint:
`138d9036379a5108cd4ffe41b3dc2edfed935bff`

V1.2.1 exact product checkpoint:
`ec5ef6fbe6256dd1651280d818976b346045389d`

Polyphonic operator/Agent Forge source checkpoint:
`30467845b5c4267d1c94168c21f900b03e2521b5`

V1.2 candidate branch: `codex/unified-brain-v1-2`

V1.2.1 candidate branch: `codex/brain-connections-v1-2-1`

V1.2 state: PASS. B21-B27, the signed installed Brain authorization matrix,
native no-write proof, and the single formal `just ci` gate all pass. The
evidence closure is the commit titled `Finalize V1.2 release evidence` on
`luca/v1.1`. The release remains local; no push or pull request was authorized.

V1.2.1 state: PASS. C28-C32, the installed connected-source and repository-work
matrix, protected native no-write proof, and the one formal `just ci` gate all
pass. The evidence closure is the commit titled
`Finalize V1.2.1 release evidence` on local `luca/v1.1`. The release remains
local; no push or pull request was authorized.

Polyphonic operator/Agent Forge state: SOURCE PASS. The full repository gate
passes, but signed disposable native provisioning acceptance remains pending,
so this checkpoint is not yet promoted as an installed release. See
`docs/luca/operator-forge/`.

This document is the repository-native source of truth for continuing Luca V1.
It supersedes older product assumptions in the upstream Buzz README and older
planning documents when they conflict with the current implemented product.

## Start here

For a new agent or developer:

```bash
git clone https://github.com/Riley-Coyote/luca-agent-network-v1.git
cd luca-agent-network-v1
git switch luca/v1.1
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
8. [`docs/luca/PROJECTS.md`](docs/luca/PROJECTS.md) before changing project grouping or local repository bindings.
9. [`docs/luca/unified-brain/README.md`](docs/luca/unified-brain/README.md) before Brain source, discovery, import, graph, or adapter work. Its long-range vision is subordinate to the active V1.2.1 contracts in `docs/luca/v1.1-v1.3/`.

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

### Scoped Owner Brain sources

- The owner can preview and atomically import narrow local Markdown/text sources
  into an encrypted owner namespace without changing the source bytes.
- Read-only access requires an explicit source grant for one stable resident
  identity. Revocation applies on the next turn; changed runtime bindings make
  the grant stale until explicit reconfirmation.
- Retrieval checks authorization before decryption, ranks and deduplicates
  within frozen bounds, rechecks terminal authority, and exposes body-free
  process-memory receipts.
- Retrieved source text is untrusted reference material. It cannot change
  resident identity, runtime, model, tools, authority, routing, or budgets.

### Connected Brain and repository work

- Brain discovers repository, Codex, and Claude Code metadata without silently
  connecting or indexing anything.
- Explicit connections keep originals authoritative and store encrypted
  bindings, hashes, cursors, body-free locators, and lightweight search
  postings only.
- Event-driven watchers refresh connected sources through one debounced worker;
  launch reconciliation catches missed changes without polling or model calls.
- Every current and future resident receives an explicit default grant. Runtime
  or provider changes fail closed until reconfirmed, and disconnect removes
  recall and repository tools immediately.
- Managed Hermes and OpenClaw sessions receive one desktop-owned,
  session-scoped `luca-repositories` surface without native configuration or
  credential changes.
- Repository list/search/read is automatic. Patch, command, and local commit
  operations use scoped Luca approvals; no push, PR, remote mutation, or
  credentialed Git tool is exposed.
- The main Brain surface is a quiet Repositories, Codex, Claude Code, and Files
  inventory. Exclusions, grants, refresh detail, and body-free activity remain
  secondary.

### Optional Luca operator and native Agent Forge

- Luca is an optional ordinary resident, preselected only for new onboarding;
  existing installations receive no resident silently.
- One confirmed default runtime target covers Codex, Claude Code, Hermes, and
  OpenClaw while preserving legacy managed and custom runtime compatibility.
- Luca and other owned residents can draft narrow agent proposals, but owner
  review in the desktop is the only commit point.
- Hermes and OpenClaw creation use their supported native command surfaces,
  exact rediscovery, stable Polyphonic resident linking, reconciliation, and
  rollback without exposing desktop authority to models or tools.
- Manual creation, onboarding, Settings, and conversational proposals share one
  review experience and body-free provisioning activity.

## Branch and commit map

| Branch | Purpose | Relationship |
|---|---|---|
| `luca/v1` | Older integrated usable baseline | Remote default; commit `265c3543` |
| `agent/conversation-first-shell` | Conversation-first UI checkpoint | Commit `d75d731b`, based on `luca/v1` |
| `agent/runtime-reliability` | Historical G1/runtime checkpoint | Preserved for archaeology; not the release branch |
| `luca/v1.1` | **Current integrated release branch** | V1.2.1 PASS: V1.2 foundation plus connected repositories/sessions, scoped repository work, and installed verification |
| `codex/unified-brain-v1-2` | V1.2 implementation and evidence lineage | Exact product checkpoint `138d903`; evidence closure locally fast-forwarded into `luca/v1.1` |
| `codex/brain-connections-v1-2-1` | V1.2.1 implementation and evidence lineage | Exact product checkpoint `ec5ef6f`; evidence closure locally fast-forwarded into `luca/v1.1` |
| `agent/vision-demo` | High-fidelity simulated design exploration | Reference only; do not merge wholesale |
| `agent/project-room-blackout-shell` | Approved Project → Room navigation and production handoff | Finalized at `b1e045a5`; fast-forwarded into `luca/v1.1` after visual and native approval |
| `main` | Untouched Buzz baseline | Tracks upstream baseline, not Luca continuation |

New work should branch from `luca/v1.1`:

```bash
git switch luca/v1.1
git pull --ff-only
git switch -c agent/<short-task-name>
```

Do not restart from `main`, transplant these changes into an older Luca app, or
merge `agent/vision-demo` wholesale.

V1.2.1 is closed. V1.3 remains `NOT_STARTED`; begin Resident Reflection only as
a separately authorized slice from the accepted local `luca/v1.1` head.

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
| Owner Brain persistence and authority | `desktop/src-tauri/src/luca/owner_brain_store.rs`, `desktop/src-tauri/src/luca/owner_brain_store/`, `desktop/src-tauri/src/managed_agents/owner_brain_authority.rs` |
| Connected-source discovery and indexing | `desktop/src-tauri/src/luca/connected_brain/`, `desktop/src-tauri/src/luca/owner_brain_store/connected.rs` |
| Repository work broker and OpenClaw adapter | `desktop/src-tauri/src/luca/repository_broker/`, `crates/buzz-agent/src/openclaw_compat.rs` |
| Brain UI | `desktop/src/features/brain/` |
| Planning/contracts | `.codex/luca-v1/` |
| Project → Room navigation | `desktop/src/features/projects/`, `desktop/src/features/channels/lib/roomProjects.ts`, `docs/luca/project-navigation/` |

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

- Exact product commit `ec5ef6fbe6256dd1651280d818976b346045389d` was
  rebuilt, Developer-ID signed, strictly deep verified, atomically installed,
  relaunched, and left available against the normal profile.
- Isolated discovery, connection, event-driven refresh, relaunch persistence,
  process-memory receipts, disconnect, and unchanged reconnect all passed.
- Hermes `default` and OpenClaw `main` both retrieved connected repository
  material and used repository search/read. An approved patch and command, a
  rejected write, and a separately approved local commit behaved exactly as
  scoped; no push occurred.
- Protected native configuration, credentials, model, memory, workspace, and
  schedule hashes were unchanged. The encrypted store passed the plaintext
  path/body/canary scan, and the original fixture stayed byte-identical.
- Connected Brain, repository bridge, full Tauri, desktop, Playwright,
  workspace, web, and mobile checks passed. Tauri reported 1,782 passed with 13
  ignored plus three diagnostics; mobile reported 525 passed and one skip.
- The one formal `just ci` run passed on the unchanged product commit after
  native acceptance; no product source changed afterward.

## What is not complete

- Formal G1 is not complete. See the exact repository checklist.
- Full upstream messaging regression, clean-profile branding/onboarding,
  attachment/media/search, and installed-app smoke are not closed for G1.
- Managed permission scenarios need a real runtime-triggered UI smoke.
- Database adapters, embeddings, code graphs, Mnemos, model-assisted ingestion,
  remote ingestion, proactive behavior, and source-derived memory writing are
  intentionally absent from V1.2.1.
- Continuity Capsule, consolidation, reflection, and fuller autonomous inner
  life are intentionally deferred.
- Native ACP transcript/session restoration is not claimed; Luca rehydrates
  from signed conversation history.
- Mobile, shared whiteboard, multi-user collaboration, and full rebranding of
  internal upstream identifiers are deferred.

## Next action

V1.2.1 requires no repair. Continue with
[`docs/luca/G1_CHECKLIST.md`](docs/luca/G1_CHECKLIST.md) for the remaining
broader G1 gates, plan databases as the next adapter slice, or authorize V1.3
Resident Reflection separately. Do not add embeddings, graphs, autonomous
memory writing, remote mutation, or broader repository authority without a new
frozen contract.

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
