# Polyphonic resident capability parity

Date: 2026-08-29

Revised: 2026-08-30 — runtime-first exposure contract

Status: authorized priority backlog; not an implementation or release claim

Execution package: [`capability-parity/BUILD_SPEC.md`](capability-parity/BUILD_SPEC.md)
with [`TASK_GRAPH.yaml`](capability-parity/TASK_GRAPH.yaml) and
[`ACCEPTANCE.md`](capability-parity/ACCEPTANCE.md). The package is a draft until
Riley records exact include/expose-only/defer choices in its approval sheet.

Execution trigger: begin immediately after the active Brain session-catalog,
incremental-indexing, and context-handoff work is reliable. Do not interrupt or
fold this work into that prerequisite.

## Product goal

Governing architecture:
[RUNTIME_FIRST_CAPABILITY_CONTRACT.md](RUNTIME_FIRST_CAPABILITY_CONTRACT.md).
If this backlog appears to require rebuilding something the selected runtime
already exposes, the governing contract wins: verify and expose the runtime
capability first.

A resident running through Codex, Claude Code, or another supported runtime
should be able to perform the substantive work a user reasonably expects from
that runtime while the conversation remains inside Polyphonic.

This means capability parity, not application impersonation:

- use the user's existing runtime installation, authentication, configuration,
  skills, and MCP ecosystem wherever the runtime can expose them safely;
- do not create a second runtime profile merely for Polyphonic;
- do not clone the Codex or Claude Code interface;
- do not promise bidirectional transcript synchronization, native-session
  continuation, or exact native-app workflow parity;
- keep Polyphonic's resident identity, conversation, permissions, receipts,
  cancellation, and recovery authoritative.

The existing native parity rule still applies: Polyphonic must not silently
pretend that a runtime exposes a capability it does not. A capability may be
provided by the runtime itself or by an explicit Polyphonic-hosted tool, but its
provider and current availability must be truthful.

The desired invariant is that an imported resident retains everything its exact
runtime exposes through Polyphonic's embedded session. This does **not** mean
that Polyphonic automatically inherits host-only features from a vendor's
separate desktop or web application. Model, runtime/harness, and native product
are distinct layers.

Most parity work should therefore be capability discovery, structured runtime
invocation, permission mediation, activity/cancellation, and result rendering.
Polyphonic builds the substantive capability only when a live audit proves a
runtime/Skill/MCP gap.

## Current comparison

This table records the present development baseline. Every row must be
reverified against the current branch and installed runtimes before its lane is
implemented.

| Capability | Current Polyphonic state | Required outcome |
|---|---|---|
| Project files, repository search, edits, patches, shell, Git, tests, and builds | Substantial foundations exist through the managed ACP host and Polyphonic's repository/developer tools. Exact parity varies by runtime and grant. | One truthful capability view and reliable end-to-end execution through the resident's selected runtime and working context. |
| Runtime projects and session history | Bounded, sanitized Codex and Claude Code session discovery exists. **Start with this context** creates a new Polyphonic conversation; it does not resume or synchronize the native session. Current catalog and Brain refresh behavior need repair first. | Fast metadata-first browsing, useful titles and search, lazy bounded context compilation, and incremental indexing without transcript impersonation. |
| Skills | Bounded installed-skill discovery and inspection exist; **Use** starts a compatible conversation. Polyphonic does not yet prove that every applicable runtime skill is available and usable inside a resident turn. | Discover, explain, select, and invoke compatible skills through the existing runtime with honest compatibility and failure states. |
| MCP | Settings exposes Polyphonic-owned connections and sanitized read-only views of some runtime-owned MCP configuration. End-to-end parity across supported runtimes is not established. | Residents can use explicitly granted compatible MCP tools while secrets remain runtime- or Keychain-owned and tool authority remains visible and revocable. |
| Web search | No universal first-class resident claim is established. Codex or another exact runtime may already expose web research independently. | Audit and expose runtime-native search first, then explicitly granted MCP search, and add a shared Polyphonic provider only for a proven gap. All paths remain sourced and permission-aware. |
| Browser use | No universal resident browser controller is established. A runtime or MCP may expose browser tools independently. | Prefer a live-verified runtime or MCP browser. If none exists, add a Polyphonic-hosted controller for navigation, reading, forms, downloads, and page interaction, separated from unrestricted desktop control. |
| Image generation | No universal resident image-generation claim is established. Image inspection and ordinary attachments are separate capabilities. | Prefer a compatible runtime tool or MCP provider. Add a Polyphonic provider only where required, with previews, provenance, cancellation, and artifact saving. |
| Computer use | No universal macOS screen-and-input claim is established. Some runtimes may describe computer tools whose execution still belongs to the embedding host. | Reuse a live-verified runtime/MCP controller where possible; otherwise provide explicitly enabled Polyphonic execution with macOS permissions, visible active state, confirmation, stop/revoke, and bounded targets. |
| Parallel agents and subagents | Runtime-native subagents and Polyphonic cross-resident orchestration are different layers. A2A messaging exists, but a complete user-visible task system does not. | Expose runtime-native subagents without rebuilding them. Polyphonic separately owns bounded cross-resident delegation, ownership, progress, cancellation, and structured result return. |
| Automations and scheduled tasks | A runtime may have native schedules, while no general Polyphonic user-facing automation system is established for this claim. | Expose verified runtime-native scheduling where appropriate. Polyphonic owns user-visible cross-runtime triggers, budgets, pause/disable controls, receipts, and restart-safe execution. |
| Durable background work | Managed turns have cancellation and recovery foundations, but general long-running Polyphonic jobs across app restarts are not established. | Preserve runtime-native background execution when exposed. Polyphonic-owned jobs must recover honestly, never duplicate side effects, and remain inspectable and cancellable. |
| Connectors and hosted app integrations | Codex-app connectors are not automatically inherited by a resident merely because it uses a Codex runtime. | Prefer MCP or a small Polyphonic connector boundary with explicit authentication, grants, and capability discovery; never imply silent inheritance. |
| Voice and audio tools | Conversation UI support and runtime execution parity are incomplete for a general claim. | Treat voice interaction and audio creation/transcription as separately discoverable, permissioned capabilities. |

## Priority after Brain and context reliability

The next capability program is exposure-first:

1. **Live capability audit and handshake.** Reverify the exact installed
   runtime/adapter/session and distinguish declared, discovered, configured,
   granted, live-verified, unavailable, and needs-attention states. No duplicated
   profiles, runtime-label inference, or hidden fallback.
2. **Expose native developer work.** Complete invocation and presentation for
   the selected runtime's existing file, repository, shell, Git, test, build,
   web-research, and native-subagent capabilities before building substitutes.
3. **Skills and MCP end to end.** Move beyond discovery/presentation so a
   resident can actually use compatible, explicitly granted capabilities from
   inside Polyphonic. These are non-negotiable parity foundations.
4. **Internet work.** Expose verified runtime or MCP web search and browser use
   first. Add Polyphonic-hosted providers only for remaining gaps; keep sourced
   retrieval separate from interactive browser control.
5. **Image generation and editing.** Prefer compatible runtime/MCP providers,
   then fill proven gaps with Polyphonic artifact/preview integration.
6. **Parallel task orchestration.** Preserve native runtime subagents and build
   explicit cross-resident delegation, independent
   parallel execution, progress, cancellation, and result return on top of
   existing resident/A2A identities rather than inventing a mandatory
   conductor.
7. **Automations and scheduled tasks.** Add durable user-authorized triggers
   only after ordinary tool execution and parallel task ownership are reliable.
8. **Computer use.** Expose a verified runtime/MCP controller if present;
   otherwise add macOS-wide execution incrementally under a narrow permission
   and safety contract. Browser use should not wait for full desktop control.

This order is intentionally incremental. It may be regrouped into build lanes
after the prerequisite closes, but none of these capabilities should be
quietly dropped from the parity program.

## Shared implementation laws

- The user's existing runtime profile and authentication remain authoritative.
- Provider resolution is runtime-native, then compatible Skill/plugin/MCP,
  then explicit Polyphonic-hosted fallback, then honest unavailability.
- A declared catalog capability is not live-session proof. Unknown or loading
  metadata is not equivalent to unsupported.
- Capability grants attach to the stable resident identity and exact tool or
  connection; room membership never grants tools.
- Context selection changes working material, not authority.
- Polyphonic owns the permission UI, cancellation, visible activity, and
  durable outcome receipts for Polyphonic-hosted capabilities.
- Runtime-owned tools remain runtime-owned. Polyphonic discovers and invokes
  them through supported interfaces instead of copying secrets or rewriting
  native configuration.
- Polyphonic does not rebuild a substantive capability merely to give it a
  native-looking frontend. The bridge may still own discovery, transport,
  permissions, activity, cancellation, recovery, and result presentation.
- Raw chain-of-thought, hidden prompts, credentials, and private native-session
  envelopes never enter conversation history or capability receipts.
- Background and parallel work must identify who is acting, what it may touch,
  how to stop it, and whether it survived a restart.
- Fail honestly. Never replace an unavailable capability with a weaker one
  while presenting it as equivalent.

## Explicit non-goals

- Bidirectional synchronization with Codex or Claude Code transcripts.
- Resuming a native session as though Polyphonic were the native app.
- Reproducing native task sidebars, archives, forks, pins, worktree UI, or
  provider-specific chrome.
- A new plugin format or marketplace. Skills and MCP are the portable
  capability formats unless a later concrete gap proves otherwise.
- Rebuilding a capability already exposed by the selected runtime or an
  explicitly granted compatible extension.
- Automatic broad filesystem, network, browser, screen, or external-service
  authority based on the resident's runtime or room membership.

## Relationship to current work

The prerequisite Brain/session/context program should produce:

- a metadata-first Codex and Claude Code session catalog;
- incremental per-session refresh instead of complete reindexing;
- search across the user's runtime sessions;
- lazy, bounded, provenance-visible context packets for new Polyphonic turns;
- clear source health, retry, reconnect, and stale-state behavior.

Only after that foundation is reliable should this capability program begin.
The session catalog supplies knowledge and working context; this document
tracks what residents can *do* with that context.

## Existing source contracts to preserve

- [`RUNTIME_BACKED_RESIDENT_CONTEXT.md`](RUNTIME_BACKED_RESIDENT_CONTEXT.md)
  defines the current context and native-session boundary.
- [`UNIFIED_DEV_INTEGRATION_HANDOFF.md`](UNIFIED_DEV_INTEGRATION_HANDOFF.md)
  records current Skills, MCP, and session behavior in the unified app.
- [`functional-beta/NATIVE_PARITY_CONTRACT.md`](functional-beta/NATIVE_PARITY_CONTRACT.md)
  requires honest native binding and capability claims.
- [`EXTENSIONS.md`](EXTENSIONS.md) rejects a competing plugin API and treats
  skills and MCP as the portable capability substrate.

## Return point

When Brain and runtime context reliability are accepted, reopen this document,
perform the live runtime capability audit required by the governing contract,
freeze the provider and permission contracts, then write the smallest
decision-complete exposure spec for the first lanes. Do not begin by attempting
the entire matrix or by building substitutes before proving the gap.
