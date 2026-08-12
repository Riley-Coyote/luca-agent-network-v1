# Luca shared-interface freezes

These freezes define semantics, not every implementation type. Before a team
changes a frozen semantic, it submits a decision proposal with affected tasks,
migration/compatibility impact, security analysis, tests, and rollback. Program
Integration & Release approves or rejects it before source changes.

## IF-01 — App shell, onboarding gate, and route selection

- New profiles enter production onboarding; healthy returning profiles bypass it.
- Completion is durable, recoverable, and independent of prototype fixtures.
- DM/room deep links resolve to the accepted conversation-first shell.
- Onboarding may collect project/source/resident intent but must call the owning
  domain transaction rather than duplicate its persistence.
- Freeze point: before Experience writes reconciliation source.

## IF-02 — Resident identity, registry, and selection

- One stable cryptographic resident identity is independent of runtime, model,
  executable, provider, session, project, and role.
- Import/re-import and native Forge reconciliation reuse identity when semantic
  identity matches; binding changes never rotate identity silently.
- The desktop owns private keys; renderers, ACP, models, tools, connectors, and
  mobile clients receive no signing secret.
- Consumers use one Program-approved resident descriptor/selector contract.
- Freeze point: before onboarding, project resident selection, Forge repair, or
  resident Inbox writes.

## IF-03 — Project, room, role, and membership transaction

- Projects organize rooms, residents, sources, and artifacts; they are not
  mandatory workflows.
- Project and room membership are durable, attributable organizational state.
- Creating/removing membership is idempotent and stale-bound where appropriate.
- Membership never grants source, filesystem, MCP, model, provider, budget,
  signing, or external-action authority.
- Optional roles, including a future conductor, are ordinary replaceable
  role assignments with explicit grants.
- Freeze point: before unified creation or A2A invitation implementation.

## IF-04 — Commands, frontend API, and registration

- Domain operations have typed request/result/error contracts and idempotency
  keys where retries can duplicate work.
- Command registration, app state injection, frontend API exposure, and event
  kind allocation are Program-owned integration adapters.
- Teams implement domain handlers and tests in owned modules, then request the
  smallest registration diff.
- No new HTTP endpoint when an authenticated signed-event operation fits the
  inherited conversation plane.
- Freeze point: before any new cross-process operation.

## IF-05 — Communication events, receipts, Activity, and Inbox

- Signed Buzz/Nostr events remain canonical chronology and authorship.
- Delivery and activation are distinct. A delivered event may truthfully be
  `delivered_not_activated`; delivery is never rolled back because activation
  failed.
- Every mutation binds exact actor, owner, resident, conversation, target,
  expected state/content, dispatch, session epoch, and idempotency key as
  applicable.
- Activity distinguishes signed/host/runtime/test/commit/artifact receipts from
  agent-authored statements.
- Inbox routes attention; ordinary room coordination remains in conversation.
- Current DMs are not described as NIP-17 E2EE.
- Freeze point: before any P0 communication source write.

## IF-06 — Brain, filesystem, connector grants, and provenance

- Source discovery does not connect, import, index, grant, or mutate.
- Every read or action is authorized for a stable owner/resident/source/action
  tuple and rechecked at use and terminal authority points.
- Originals remain authoritative; local stores preserve lineage, hashes,
  revision/cursor state, exclusions, and body-safe receipts.
- Runtime/provider changes make grants stale until explicit reconfirmation.
- Imported or retrieved text is untrusted material and cannot alter identity,
  runtime, model, tools, authority, routing, budget, or policy.
- External writes require exact action approval, stale binding, receipt, and
  safe retry/undo where supported.
- Freeze point: before unified source creation or connector work.

## IF-07 — Runtime turn, cancellation, permission, and signing isolation

- Desktop-managed exact-turn authority controls publication, cancellation,
  permission, activation, and recovery.
- One canonical final is published per admitted managed dispatch.
- Owner/resident keys, signing capabilities, provider credentials, and local
  control descriptors never reach model/tool descendants.
- Permission choices are exact runtime-advertised options and fail closed on
  timeout, cancel, stale epoch, malformed input, exit, or app closure.
- Causal depth and budget are explicit and non-increasing through delegation.
- Freeze point: before activation, Forge repair, Skills, or multi-model work.

## IF-08 — Artifact handles and renderer trust

- P0 communication uses opaque, owner-scoped, revocable artifact handles—not
  arbitrary paths or model-supplied raw filesystem authority.
- Static artifact versions are immutable; revert creates a new version.
- HTML/Markdown/PDF/image/text/file renderers do not imply process or network
  execution.
- Live processes, network previews, and voice require separate later contracts.
- Freeze point: before managed attachment publication.

## IF-09 — Pairing, device, push, and remote-client authority

- Reuse the inherited secure pairing substrate; do not invent a parallel
  pairing protocol.
- The phone is a client of Mac-hosted residents; residents do not run on the
  phone in the first native companion.
- Device registration, revocation, push enrollment, notification privacy, and
  reconnect state are explicit and auditable.
- Concurrent multi-device write authority remains deferred.
- Freeze point: before native mobile implementation.

## IF-10 — Release identity and evidence chain

- Every claim names repository/worktree coordinate, branch, full commit, test
  environment, bundle ID, signing identity/status, executable hash, and profile.
- Focused tests happen during development; one complete gate runs on the final
  unchanged candidate.
- A source edit after freeze creates a new candidate and invalidates installed
  proof tied to the prior SHA.
- Only Program promotes integrated, installed, or release-complete status.
- Freeze point: before the P0 train opens.
