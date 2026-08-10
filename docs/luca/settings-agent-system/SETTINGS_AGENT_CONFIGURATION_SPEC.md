# Luca Settings and Agent Configuration Specification

Status: **SPECIFICATION ONLY — IMPLEMENTATION NOT STARTED**
Updated: 2026-08-09

## 1. Purpose

Create one coherent Luca configuration system for:

- application and owner preferences;
- mobile and companion-device pairing;
- persistent agent configuration;
- reusable MCP and tool connections;
- Luca-native agent creation;
- safe Hermes and OpenClaw import, creation, and future editing;
- system diagnostics and recovery.

The system must feel like Luca, not a renamed collection of Buzz administration
pages. It must also avoid creating a second agent database or a second editor
that disagrees with the Agent Library.

## 2. Product model

User-facing copy uses **agent**. Internal protocol and storage types may retain
**resident** where that term denotes a persistent cryptographic identity.

Each surface has one job:

| Surface | Responsibility |
|---|---|
| Agent Library | Understand, message, inspect, and work with agents |
| Settings / Agents | Create, configure, repair, and remove agents |
| Settings / Connections & MCP | Manage reusable tool connections and trust |
| Settings / Mobile & devices | Pair companion devices and inspect bridge status |
| Brain Setup | Import knowledge, manage source grants, and govern recall |
| Project details | Bind folders, sources, agents, and connections to a project |
| Conversation | Manage room participants and temporary session state |

Settings and Agent Library must use the same configuration view model, mutation
commands, provenance rules, and cache. Agent Library may deep-link to a selected
agent's canonical Settings route. Settings may deep-link back to that agent's
Overview or Notebook. Neither surface owns a private copy of agent state.

## 3. Settled decisions

1. Settings includes **Agents**, **Connections & MCP**, and **Mobile & devices**.
2. The current Agent Library remains the everyday product surface.
3. Settings is the administrative configuration surface.
4. One shared master-detail agent editor serves both entry points.
5. Every configuration value exposes its origin, authority, and write mechanism.
6. Imported Hermes and OpenClaw configurations remain read-only.
7. Creating or editing native configuration requires a dedicated runtime adapter,
   an exact preview, validation, backup, atomic application, verification, and a
   rollback receipt.
8. Luca never copies provider credentials from Hermes, OpenClaw, Claude Code, or
   Codex.
9. MCP servers are reusable connections. Agents receive explicit grants to them.
10. Secrets are referenced from native secure storage and never rendered as
    ordinary environment values after entry.
11. Runtime capabilities remain derived from the Rust runtime catalog rather
    than hardcoded in React render components.
12. Unsupported features are hidden or named honestly. Luca never simulates
    parity that a runtime does not expose.
13. Brain sources, Notebook content, room membership, and project bindings do not
    become generic Settings fields.
14. This system does not add a conductor.

## 4. Settings information architecture

### Account

- **Profile & identity**
  - owner display name;
  - owner public key and fingerprint;
  - recovery status and identity export entry point;
  - local custody explanation.
- **Security & backup**
  - protected Luca backup and restore;
  - continuity-key health;
  - security-sensitive recovery actions;
  - local data and key custody summary.

### Experience

- **Appearance**
- **Notifications**
- **Mobile & devices**
- **Shortcuts**

### Agent system

- **Agents**
- **Connections & MCP**
- **Defaults & permissions**

### Application

- **Diagnostics**
- **Updates**
- **About Luca**

Settings navigation uses the existing Luca settings rail, spacing, typography,
blackout materials, focus treatment, and responsive behavior. It does not
introduce a new visual shell.

### Excluded legacy content

The Luca Settings path must not expose unimplemented or irrelevant Buzz product
surfaces, including:

- hosted communities;
- organization administration;
- Buzz compute or experiment panels;
- Buzz templates;
- community emoji administration;
- Buzz-branded update, feedback, help, or product copy;
- settings for features that are not usable in Luca.

Features may return only when they have a Luca product definition and working
implementation.

## 5. Settings / Agents workspace

### Layout

Use the approved Agent Library master-detail language:

```text
┌ Agent roster ─────────────┬ Selected agent ─────────────────────────┐
│ Search                    │ Luca                         Ready        │
│ All  Running  Attention   │ Hermes · gpt-5.6-sol                    │
│                           │                                         │
│ Luca                      │ Overview Runtime Instructions           │
│ Mara                      │ Workspace Tools Permissions             │
│ Sol                       │ Memory Lifecycle Advanced               │
└───────────────────────────┴─────────────────────────────────────────┘
```

The detail plane is the dominant focal surface. The roster stays compact and
quiet. Do not use giant agent cards, a dashboard mosaic, or one uninterrupted
form.

### Roster

The roster provides:

- search by agent name, runtime, or model;
- filters for All, Running, and Needs attention;
- identity specimen, readable name, runtime, and honest readiness state;
- one compact Create agent action;
- keyboard selection and stable deep links;
- empty, loading, degraded, failed, and discovery-error states.

### Detail sections

#### Overview

- identity specimen and readable name;
- current readiness and runtime state;
- runtime, model, and provider summary;
- native or Luca-managed ownership;
- stable short fingerprint;
- primary actions: Message, Start/Stop, Edit;
- actionable problems without raw log walls.

#### Identity

- full public key and fingerprint;
- identity specimen;
- custody and signing authority;
- semantic native identity where applicable;
- creation and relationship dates when available;
- immutable versus mutable identity explanation;
- recovery/export entry points that are actually supported.

An agent's public key and specimen do not change when its runtime path, model,
or session changes.

#### Runtime & model

- runtime binding and readiness;
- runtime path, version, and binding fingerprint;
- model and provider;
- effort or thinking mode when supported;
- context/output limits when supported;
- provider-egress status;
- runtime capability summary;
- revalidate, restart, and repair actions.

#### Instructions

- Luca-owned system instructions or persona prompt;
- native-managed instruction source when read-only;
- origin and write authority;
- validation, dirty state, save, and revert behavior;
- no hidden prompt concatenation claims.

#### Workspace

- current working folder or repository;
- origin: agent default, project, conversation, or native profile;
- local availability and missing-path state;
- browse/change action when Luca owns the field;
- clear link to Project details for project-scoped work.

#### Tools & MCP

- granted Luca-managed MCP connections;
- detected native-managed MCP servers;
- runtime-native tools and capability availability;
- health, tool count, last check, and permission posture;
- Add connection and Manage connections entry points;
- unsupported projection reasons when a runtime cannot accept a connection.

#### Permissions

- default interaction posture where Luca has authority;
- exact runtime-advertised approval behavior;
- filesystem, command, network, repository, and MCP boundaries when available;
- local-only permission transport status;
- no invented `allow_once` or persistent policies.

Managed permission requests remain fail-closed and bound to the exact agent,
session epoch, turn, conversation, and runtime request.

#### Memory & continuity

- continuity enabled state;
- latest handoff status;
- Notebook link and update status;
- Owner Brain grants and stale/revoked status;
- native-memory ownership explanation;
- correction, disable, and forget entry points where already supported.

This section summarizes configuration. Detailed Notebook content remains in the
Agent Library Notebook surface; source ingestion remains in Brain Setup.

#### Lifecycle

- start on application launch;
- automatic restart policy;
- parallelism and timeout controls where supported;
- last start, stop, interruption, and failure;
- safe reset/restart actions;
- removal and detach actions with explicit consequences.

#### Advanced & diagnostics

- raw effective configuration with provenance;
- runtime logs and body-free diagnostics;
- ACP and connection health;
- binding revalidation;
- copyable paths, identifiers, and versions;
- reset only the settings Luca owns;
- support bundle creation after privacy review.

Advanced material is collapsed by default.

## 6. Configuration authority

Every rendered field maps to a typed authority state:

```ts
type ConfigAuthorityV1 =
  | { type: "luca_managed" }
  | { type: "native_managed"; runtime: "hermes" | "openclaw" | string }
  | { type: "inherited"; source: "global" | "template" | "project" }
  | { type: "session_only"; sessionId: string }
  | { type: "harness_locked"; reason: string }
  | { type: "unsupported"; reason: string };
```

Each field also retains its existing write mechanism:

- respawn with an environment value;
- ACP config option;
- ACP session model;
- Luca-owned persistent configuration;
- explicit native-adapter transaction;
- read-only.

The UI derives editability from authority plus write mechanism. React must not
infer write permission from a runtime name.

### Field presentation

Each setting may show a quiet provenance line:

```text
Model              gpt-5.6-sol       Set in Luca
Workspace          ~/Projects/luca   Managed by Hermes
Reasoning effort   High              Inherited from defaults
```

Read-only does not mean disabled-looking or inaccessible. The value remains
legible and copyable, with a concise explanation of where to change it.

## 7. Shared configuration contract

All supported agents share a normalized configuration view. Runtime-specific
capabilities determine which fields appear.

```ts
interface AgentConfigurationViewModelV1 {
  agentId: string;
  pubkey: string;
  displayName: string;
  identitySpecimenSeed: string;
  ownership: "luca" | "imported_native" | "created_native";
  runtime: RuntimeBindingSummaryV1;
  readiness: "ready" | "degraded" | "offline" | "failed";
  sections: AgentConfigurationSectionV1[];
  problems: AgentConfigurationProblemV1[];
  capabilities: RuntimeCapabilityManifestV1;
}

interface AgentConfigurationFieldV1 {
  id: string;
  label: string;
  value: unknown;
  valueKind: "text" | "secret_ref" | "path" | "enum" | "boolean" | "number";
  authority: ConfigAuthorityV1;
  writeVia: ConfigWriteMechanism;
  validation: FieldValidationV1;
  sensitive: boolean;
}

interface AgentConfigurationPatchV1 {
  agentId: string;
  expectedRevision: number;
  changes: AgentConfigurationFieldPatchV1[];
}
```

Patches may contain only fields for which Luca has verified write authority.
Mixed-authority changes are partitioned before execution. A failed native
transaction cannot partially commit Luca-owned state that implies it succeeded.

## 8. Luca-managed agents

### Create flow

The first complete creation flow covers:

1. identity name and optional avatar;
2. runtime selection from the live capability catalog;
3. model, provider, and supported effort controls;
4. instructions;
5. default workspace;
6. MCP and tool grants;
7. permission posture;
8. continuity disclosure and toggle;
9. lifecycle settings;
10. review and create;
11. readiness check and optional first message.

The app generates the agent signing key in native secure storage. The renderer
never receives private key material.

### Edit flow

Luca-owned fields may be edited through the shared configuration workspace.
Changes validate before persistence, use optimistic concurrency, report whether
a restart is required, and retain a safe audit receipt without sensitive values.

## 9. Native Hermes and OpenClaw agents

### Import remains read-only

Existing native discovery/import behavior remains unchanged:

- Hermes semantic identity is canonical Hermes home plus exact profile name.
- OpenClaw semantic identity is canonical gateway configuration and exact agent
  ID.
- re-import reuses the stable Luca identity;
- binding changes revalidate separately from identity;
- Luca does not copy credentials or alter native files.

### Creation is new authority

Creating a Hermes or OpenClaw agent from Luca is not an extension of import. It
is a distinct, explicit native-authority workflow implemented by one adapter per
runtime.

```ts
interface NativeAgentCreationPlanV1 {
  runtime: "hermes" | "openclaw";
  semanticIdentity: NativeAgentSemanticIdentityV1;
  requestedConfig: NativeAgentRequestedConfigV1;
  capabilitySnapshot: RuntimeCapabilityManifestV1;
  affectedPaths: NativePathChangePreviewV1[];
  validation: NativeAgentPlanValidationV1;
  backupRequired: boolean;
}

interface NativeAgentCreationReceiptV1 {
  planHash: string;
  createdAt: string;
  nativeIdentity: NativeAgentSemanticIdentityV1;
  lucaResidentPubkey: string;
  verifiedBindingFingerprint: string;
  affectedPathHashesBefore: BodyFreePathHashV1[];
  affectedPathHashesAfter: BodyFreePathHashV1[];
  rollbackAvailable: boolean;
}
```

### Native transaction

1. Discover the runtime, version, and supported creation capability.
2. Collect only fields the adapter can represent safely.
3. Generate an exact human-readable preview of native changes.
4. Validate paths, names, collisions, runtime state, and secret availability.
5. Back up every file the adapter will change.
6. Apply the native operation atomically or through the runtime's supported CLI.
7. Read the created agent back through discovery.
8. Verify semantic identity and binding fingerprint.
9. Create or reuse the Luca resident identity.
10. Start a bounded runtime smoke test.
11. Commit a body-free receipt and expose rollback when safe.

No generic React form writes arbitrary Hermes or OpenClaw files. No adapter may
silently substitute another profile, agent, executable, gateway, provider, or
model.

### First native adapter scope

Only fields proven by the native runtime are editable. Advanced native schedules,
plugins, internal memory files, pairing state, and runtime-owned secrets remain
native-managed until separately specified and tested.

## 10. Connections & MCP

### Workspace structure

Connections & MCP is the global integration workspace. It has three quiet
sections rather than one undifferentiated connection list:

- **Runtimes** — Claude Code, Codex, Hermes, OpenClaw, and future runtime
  installation, version, authentication, and readiness status;
- **Providers** — model-provider connections explicitly owned by Luca;
- **MCP servers** — reusable local or remote tool connections.

Native runtime authentication remains native-managed. Luca may display its
verified state and the correct repair/open-native-settings action, but it never
extracts or adopts native credentials. Provider credentials entered directly
for a Luca-owned runtime are stored as secure references in native key storage.

```ts
interface RuntimeInstallationViewModelV1 {
  runtimeId: string;
  label: string;
  executablePath?: string;
  version?: string;
  availability: "ready" | "missing" | "degraded" | "failed";
  authentication: "ready" | "required" | "native_managed" | "unknown";
  capabilities: RuntimeCapabilityManifestV1;
}

interface ProviderConnectionV1 {
  id: string;
  providerId: string;
  label: string;
  authority: ConfigAuthorityV1;
  credentialRefs: SecureSecretReferenceV1[];
  health: "ready" | "degraded" | "failed" | "unchecked";
}
```

### Product model

An MCP server is a reusable **connection**. An agent receives an explicit
**grant** to use that connection. Creating a connection does not automatically
grant it to any agent, project, or room.

### Connection registry

The global registry shows:

- name and description;
- transport: stdio initially, remote transport only when supported securely;
- command or endpoint;
- arguments;
- working directory when required;
- secure environment references;
- health and last verification;
- discovered tools/resources/prompts;
- trust and permission posture;
- owning source: Luca, native runtime, or discovered config;
- granted agents and projects;
- runtime compatibility.

```ts
interface McpConnectionV1 {
  id: string;
  name: string;
  description?: string;
  transport: McpTransportV1;
  launch: McpLaunchDescriptorV1;
  secretRefs: SecureSecretReferenceV1[];
  authority: ConfigAuthorityV1;
  health: McpHealthV1;
  capabilities: McpCapabilitySnapshotV1;
  revision: number;
}

interface AgentMcpGrantV1 {
  connectionId: string;
  agentPubkey: string;
  enabled: boolean;
  allowedCapabilities?: string[];
  permissionPosture: "prompt" | "deny" | "runtime_managed";
  createdAt: string;
  updatedAt: string;
}
```

### Add connection flow

1. Select transport.
2. Enter command/endpoint and non-secret options.
3. Store sensitive values in native secure storage.
4. Start an isolated validation session.
5. Complete MCP initialization.
6. List capabilities.
7. Show exactly what the server exposes.
8. Confirm trust posture and initial grants.
9. Save only after successful validation, unless explicitly saved as degraded.

### Native-discovered MCP

MCP servers discovered in Claude Code, Codex, Hermes, or OpenClaw appear as
native-managed and read-only. Luca may grant a runtime's already-native server
only when the runtime actually exposes that capability. A future **Adopt into
Luca** action must use a previewed clone flow and must not silently rewrite the
source configuration.

### Secrets

- Never render stored secret values after entry.
- Never persist secrets in settings JSON, ordinary SQLite metadata, logs, crash
  reports, evidence, or MCP receipts.
- Child environments receive only the exact connection secrets required for the
  approved MCP process.
- Removing a connection revokes new use and terminates managed sessions when
  safe; it does not edit unrelated native configuration.

## 11. Defaults & permissions

Global defaults apply only when an agent has no explicit value and the runtime
supports the field.

First release:

- preferred default runtime;
- default model/provider per supported runtime;
- supported effort defaults;
- start-on-launch default for newly created Luca agents;
- default continuity disclosure/toggle;
- default permission posture;
- managed runtime installation/authentication status;
- system sleep behavior while agents are working.

Per-agent values remain in the selected agent workspace. Defaults must not become
a second place to edit an existing agent implicitly.

## 12. Mobile & devices

Restore the existing pairing capability as a Luca-owned **Mobile & devices**
section.

First release:

- pair a companion device through the existing encrypted NIP-AB flow;
- show the owner identity being paired;
- QR code and short authentication string verification;
- explicit success, cancellation, expiry, and failure states;
- accurate relay/bridge status;
- product copy referring only to Luca.

Device listing, last-seen state, rename, and revocation must appear only when
backed by durable device-management APIs. Do not fabricate a connected-device
registry from a successful one-time pairing event.

Mobile pairing does not grant Brain, Notebook, project, tool, or agent authority
beyond what the pairing protocol and later device policy explicitly authorize.

## 13. Diagnostics, updates, and about

### Diagnostics

- relay and personal-home health;
- secure-storage availability;
- runtime catalog and native discovery health;
- agent process health;
- MCP connection health;
- mobile pairing/bridge availability;
- safe support bundle generation;
- links to selected agent diagnostics.

Diagnostics are body-free by default and never expose keys, provider secrets,
memory bodies, journal text, or connection secret values.

### Updates

- current application version;
- update availability and verified source;
- download/install state;
- release notes when Luca-authored and available;
- no Buzz branding or upstream product calls to action.

### About Luca

- product identity;
- version/build coordinate;
- required upstream notices and licenses;
- privacy and security links;
- project support/contact entry point when configured.

## 14. Visual and interaction contract

- The existing Luca Settings shell is the visual authority.
- Use the blackout tonal ladder and one dominant detail plane.
- Use close surface steps, hairline separation, restrained radii, and semantic
  color only.
- Use Instrument Sans for readable content and Fragment Mono for fingerprints,
  provenance, versions, paths, state, and machine metadata.
- Use Lucide for utility controls and the key-derived specimen for identity.
- Preserve keyboard navigation, deep links, back/forward behavior, focus states,
  reduced motion, and responsive off-canvas behavior.
- Prefer ledger rows and progressive disclosure over repeated cards.
- Every async action has idle, validating, saving, success, degraded, failure,
  cancellation, and retry states where applicable.
- Destructive and native-write actions require consequences and exact targets.

## 15. Routing

Canonical routes:

```text
/settings/profile
/settings/security
/settings/appearance
/settings/notifications
/settings/mobile
/settings/shortcuts
/settings/agents
/settings/agents/:agentPubkey/:section?
/settings/connections
/settings/connections/:connectionId
/settings/defaults
/settings/diagnostics
/settings/updates
/settings/about
```

Existing query-based routing may remain during migration, but it must normalize
to one canonical route representation without duplicate state.

Agent Library configuration actions navigate to the selected agent's Settings
route. Returning to the library preserves its roster selection and section.

## 16. Delivery sequence

### S0 — Contract and inventory

- Freeze this specification.
- Inventory existing Settings panels and remove/retain/map decisions.
- Inventory agent configuration fields and write mechanisms.
- Freeze configuration-authority and runtime-capability interfaces.
- Confirm current mobile pairing boundaries.
- Record legacy Buzz terminology and surface-removal checks.

Gate: no field appears editable without a verified authority and write path.

### S1 — Shared Agents workspace

- Add Settings navigation and canonical routes.
- Reuse Agent Library roster/detail view models.
- Build the shared configuration workspace.
- Show existing runtime configuration and provenance.
- Keep native imports read-only.
- Add deterministic fixtures for Luca, Hermes, OpenClaw, degraded, failed,
  locked, and unsupported states.

Gate: Agent Library and Settings show the same selected agent and effective
configuration without duplicate stores or contradictory values.

### S2 — Mobile, diagnostics, and settings completion

- Restore Luca-branded Mobile & devices pairing.
- Consolidate diagnostics, update, and about surfaces.
- Complete removal of visible Buzz settings and branding.

Gate: every visible Settings section corresponds to a working Luca capability.

### S3 — Connections & MCP registry

- Add runtime-installation status, Luca-owned provider connections, the MCP
  registry, secure secret references, isolated validation, health, capability
  discovery, and per-agent grants.
- Integrate Luca-created Claude Code/Codex residents first.
- Display native-discovered MCP as read-only.

Gate: one Luca-managed MCP connection can be validated, granted, used, revoked,
and removed without secret leakage or native-config mutation.

### S4 — Luca-native creation

- Replace any fragmented creation forms with the capability-driven create flow.
- Prove identity creation, configuration, readiness, first message, edit, restart,
  and removal in the installed app.

Gate: a new Luca agent is usable without manual file edits or terminal setup.

### S5 — Hermes native creation adapter

- Implement exact create preview, backup, atomic apply, read-back verification,
  Luca binding, smoke test, receipt, and rollback.

Gate: create and rollback preserve unrelated Hermes configuration and credentials.

### S6 — OpenClaw native creation adapter

- Implement the same transaction contract for exact OpenClaw agent identity and
  gateway binding.

Gate: create and rollback preserve unrelated OpenClaw configuration, pairing,
credentials, memory, and schedules.

### S7 — Installed system gate

- Rebuild and sign the macOS app.
- Test Luca, Hermes, and OpenClaw creation/import/configuration.
- Test MCP validation, use, revocation, and runtime compatibility.
- Test mobile pairing.
- Run no-secret and native no-write scans.
- Run focused frontend/Rust checks, then one full repository gate.

## 17. Acceptance criteria

### Information architecture

- Settings contains only working, relevant Luca sections.
- Agents is accessible from Settings and Agent Library without duplicate state.
- Brain, Notebook, project, and conversation responsibilities remain separate.
- Mobile pairing is reachable and Luca-branded.

### Agent configuration

- Every field has a visible or inspectable origin and write authority.
- Unsupported fields do not render as broken controls.
- Runtime catalog loading, absence, degradation, authentication, and failure are
  honest.
- Editing Luca-owned configuration validates and persists exactly once.
- Read-only native fields remain legible and identify their source.
- Agent identity does not change after model/runtime/binding updates.

### Native safety

- Importing Hermes/OpenClaw never changes native configuration.
- Native creation performs preview, validation, backup, atomic application,
  read-back verification, and a receipt.
- Native creation never copies credentials or silently substitutes another
  identity or runtime.
- Failure or cancellation leaves no partial Luca resident claiming success.
- Rollback restores the proven affected configuration when available.

### MCP

- MCP secrets never appear in renderer state after entry, logs, receipts,
  evidence, crash output, or child processes that do not require them.
- Connections are validated and capabilities are shown before grant.
- Grants are per stable agent identity.
- Revocation prevents new use and terminates managed access when safe.
- Native-discovered servers remain read-only unless explicitly adopted later.
- Runtime incompatibility is named instead of silently ignored.

### Mobile

- Pairing proves encrypted QR/SAS verification, cancellation, expiry, and error.
- Settings does not claim durable device management until it exists.

### Visual quality

- The selected detail remains the dominant plane.
- Desktop and compact/mobile layouts remain usable without compressed columns.
- Focus order, keyboard navigation, overflow, contrast, reduced motion, loading,
  empty, degraded, error, and destructive states are complete.
- The installed app contains no visible Buzz product branding or irrelevant Buzz
  administration surfaces.

## 18. Deferred

- arbitrary editing of every native Hermes/OpenClaw internal;
- hidden mutation of native memory, credentials, schedules, or pairing state;
- remote MCP transports without a separate authentication and trust review;
- community-wide connection policy;
- automatic MCP grants based on room membership;
- cross-device concurrent configuration authority;
- multi-owner or organization administration;
- mobile parity beyond implemented companion features;
- autonomous agent creation or self-modification;
- a conductor.

## 19. Open design work before implementation

The architecture is settled, but the following should receive a bounded visual
prototype before product implementation:

1. Settings / Agents master-detail at standard and compact widths.
2. One Luca-managed, one native-managed, and one degraded agent detail.
3. Connections & MCP registry, connection detail, and per-agent grant state.
4. Luca-native creation review step.
5. Hermes/OpenClaw native-change preview and rollback receipt.
6. Mobile & devices pairing entry and terminal states.

The prototype validates hierarchy, density, progressive disclosure, and language.
It does not invent backend behavior or become a parallel application shell.
