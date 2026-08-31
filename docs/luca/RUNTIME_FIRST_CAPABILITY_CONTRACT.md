# Runtime-first resident capability contract

Date: 2026-08-30

Status: canonical architecture contract

Scope: governs implementation and capability claims; it is not a release claim
that every current adapter already exposes every native runtime capability.

## The rule

A Polyphonic resident keeps the capabilities that its exact selected runtime
exposes through the embedded session. Polyphonic is the resident's home,
conversation surface, and authority mediator; the runtime remains the primary
worker and capability provider.

Polyphonic must expose an existing runtime capability before considering a
replacement. It builds or integrates a host capability only after a live audit
proves that the selected runtime, its installed skills, and its granted MCP
servers do not provide the required operation.

This is **runtime-first, host-mediated, and capability-honest**:

- **Runtime-first:** prefer the user's existing runtime installation, profile,
  authentication, configuration, native tools, skills, plugins, MCP servers,
  and native subagents.
- **Host-mediated:** Polyphonic owns resident identity, conversation context,
  visible permission and activity surfaces, cancellation, recovery, receipts,
  and rendering of results.
- **Capability-honest:** advertise only what the exact runtime and session have
  exposed or what an explicit Polyphonic-hosted provider can actually execute.

## Do not collapse these layers

The same product name can refer to different things:

1. **Model:** the underlying intelligence.
2. **Runtime or harness:** the executable session Polyphonic launches, such as
   Codex or Claude Code, plus the tools that session exposes.
3. **Native application:** the vendor's separate desktop, web, or terminal
   product and any host-only UI, connectors, automations, or services it adds.

Polyphonic embeds the runtime layer. It does not automatically inherit every
feature of the vendor's separate native application. Conversely, the absence
of a native-application feature from Polyphonic does not imply that the runtime
lacks the underlying capability. Availability must be discovered from the
exact launched adapter and session.

## System boundary

```text
user
  <-> Polyphonic UI
      identity · conversation · context · permissions · activity · results
  <-> Polyphonic host and runtime adapter
      launch · capability discovery · transport · cancellation · receipts
  <-> selected runtime
      reasoning · native tools · skills · MCP · native subagents
  <-> files · shell · Git · network · external services
```

Polyphonic must not become a second Codex, Claude Code, Hermes, or OpenClaw
engine. Its job is to preserve the resident and make the selected runtime's
work safe, legible, and natural inside Polyphonic.

## Provider resolution order

For every requested capability, resolve the provider in this order:

1. A live-verified tool owned by the selected runtime.
2. A compatible user-configured skill, plugin, or explicitly granted MCP tool
   available to that runtime or resident.
3. An explicit Polyphonic-hosted provider for a proven gap.
4. Honest unavailability with a useful reason and repair path.

Never silently replace an unavailable provider with a weaker one while
presenting it as equivalent. Never create a second runtime profile merely to
make an integration easier.

## Exposure work is not capability reimplementation

A visible button alone does not expose a runtime capability. A complete
runtime-backed path may still require Polyphonic to:

- discover and verify support for the exact runtime, adapter, and session;
- preserve the user's existing runtime profile, authentication, and settings;
- pass the selected working directory and bounded conversation context;
- issue a structured invocation instead of relying on suggestive UI copy;
- mediate permission requests without weakening native policy;
- normalize progress, tool, result, failure, and cancellation events;
- support retry and recovery without duplicating side effects; and
- render citations, patches, files, images, previews, and artifacts.

That work is adapter, transport, authority, and presentation work. The runtime
still performs the substantive operation.

## Capability ownership

### Prefer runtime execution

These capabilities should normally be exposed from the selected runtime rather
than rebuilt by Polyphonic:

- project and repository reads, search, edits, patches, shell, Git, tests,
  builds, and diagnostics;
- runtime-native instructions, memory, configuration, approval, and sandbox
  behavior;
- installed skills, plugins, hooks, and MCP servers;
- native web research when the exact runtime session exposes it; and
- native subagents or internal parallel work when the runtime exposes them.

### Conditional provider

These capabilities may be runtime-owned, MCP-provided, or Polyphonic-hosted.
Audit in that order before choosing an implementation:

- web search and web fetch;
- interactive browser use;
- image generation and editing;
- computer or screen-and-input control;
- external-service connectors; and
- audio creation, transcription, and related tools.

### Polyphonic coordination

Polyphonic necessarily owns behavior that crosses runtime sessions or defines
the product experience itself:

- stable resident identity and continuity;
- rooms, DMs, projects, visits, and agent-to-agent exchange;
- resident-level grants, visible permission UI, and durable receipts;
- cross-resident or cross-runtime task delegation and progress ownership;
- user-visible cancellation and recovery;
- durable schedules, triggers, and jobs that survive app restarts;
- Polyphonic artifact, Canvas, Gallery, whiteboard, and presentation flows; and
- product voice and companion interfaces.

A runtime may execute individual steps inside these systems. It does not own
the surrounding Polyphonic coordination contract.

## Capability truth model

The frontend must project capability facts from one native source of truth; it
must not infer support from a runtime label or maintain a rival hardcoded table.
For each capability, Polyphonic must be able to distinguish:

- **Provider:** runtime, skill/plugin, MCP, or Polyphonic-hosted.
- **Support:** declared, discovered, or live-verified.
- **Configuration:** configured, needs attention, or absent.
- **Authority:** granted, approval required, or denied.
- **Execution:** available, active, failed, cancelled, or unavailable.

`Declared` is useful catalog metadata, not proof that a particular live session
can execute the operation. An unknown or still-loading fact is not equivalent
to unsupported.

## Implementation order

1. **Audit and handshake.** Query the current branch and installed runtimes;
   replace assumptions with live capability facts wherever the adapter permits.
2. **Expose what already exists.** Complete structured invocation, permissions,
   progress, cancellation, recovery, and result rendering for runtime-native
   capabilities.
3. **Complete portable extensions.** Make compatible Skills and MCP work
   end-to-end without copying secrets or inventing another plugin format.
4. **Fill proven gaps.** Add a Polyphonic provider only when the live audit
   establishes that supported runtimes and portable extensions cannot supply
   the capability reliably.
5. **Build coordination last.** Add cross-resident orchestration, durable
   automations, and computer-wide authority incrementally after ordinary tool
   execution is reliable.

Do not begin a capability lane by cloning a vendor application's feature list
or interface. Begin with the exact runtime protocol Polyphonic launches.

## Acceptance invariants

A capability lane is complete only when:

- the exact provider is visible and truthful;
- the resident uses the user's existing runtime profile and authentication;
- changing conversation context changes working material, not authority;
- runtime-owned policy remains authoritative for runtime-owned tools;
- Polyphonic-owned grants and receipts remain authoritative for hosted tools;
- permissions, activity, failure, cancellation, and results are visible;
- unavailable and needs-attention states do not silently degrade;
- no vendor-native session or transcript is impersonated or synchronized; and
- no duplicate agent engine, plugin system, or hidden runtime profile was
  introduced.

## Dependent plans and contracts

- [POLYPHONIC_RESIDENT_CAPABILITY_PARITY.md](POLYPHONIC_RESIDENT_CAPABILITY_PARITY.md)
  applies this contract to the current capability backlog.
- [RUNTIME_BACKED_RESIDENT_CONTEXT.md](RUNTIME_BACKED_RESIDENT_CONTEXT.md)
  defines what conversation context may change without changing authority.
- [functional-beta/NATIVE_PARITY_CONTRACT.md](functional-beta/NATIVE_PARITY_CONTRACT.md)
  defines exact native identity and binding preservation.
- [EXTENSIONS.md](EXTENSIONS.md) keeps Skills and MCP as the portable extension
  substrate instead of creating a competing plugin system.
- [UNIFIED_DEV_INTEGRATION_HANDOFF.md](UNIFIED_DEV_INTEGRATION_HANDOFF.md)
  records the current implemented baseline and explicit deferrals.
