# Polyphonic resident capability parity

Date: 2026-08-29

Status: authorized priority backlog; not an implementation or release claim

Execution trigger: begin immediately after the active Brain session-catalog,
incremental-indexing, and context-handoff work is reliable. Do not interrupt or
fold this work into that prerequisite.

## Product goal

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
| Web search | No general first-class resident web-search capability is established. A runtime may expose one independently, but Polyphonic cannot claim it universally. | A clearly sourced, permission-aware web-search tool available to supported residents, with current results and visible citations. |
| Browser use | No first-class resident browser controller is established. | A Polyphonic-hosted browser capability for navigation, reading, forms, downloads, and page interaction, separated from unrestricted desktop control. |
| Image generation | No general resident image-generation capability is established. Image inspection and ordinary attachments are separate capabilities. | Provider-backed image generation and editing with previews, provenance, cancellation, and artifact saving. |
| Computer use | No general macOS screen-and-input control is established. | Explicitly enabled screen capture and input control with macOS permissions, visible active state, sensitive-action confirmation, immediate stop/revoke, and bounded targets. |
| Parallel agents and subagents | A2A messaging exists, but it is not a complete task/subagent orchestration system equivalent to Codex parallel work. | Residents can delegate bounded tasks to available agents/runtimes, run independent work in parallel, show ownership and progress, cancel safely, and return structured results without creating a hidden conductor. |
| Automations and scheduled tasks | The repository contains workflow and continuity scheduling foundations, but no general user-facing resident automation system is established for this claim. | User-created scheduled or event-triggered resident work with clear scope, budgets, permissions, pause/disable controls, durable receipts, and restart-safe execution. |
| Durable background work | Managed turns have cancellation and recovery foundations, but general long-running jobs across app restarts are not established. | Jobs can continue or recover honestly, never duplicate side effects, and remain inspectable and cancellable. |
| Connectors and hosted app integrations | Codex-app connectors are not automatically inherited by a resident merely because it uses a Codex runtime. | Prefer MCP or a small Polyphonic connector boundary with explicit authentication, grants, and capability discovery; never imply silent inheritance. |
| Voice and audio tools | Conversation UI support and runtime execution parity are incomplete for a general claim. | Treat voice interaction and audio creation/transcription as separately discoverable, permissioned capabilities. |

## Priority after Brain and context reliability

The next capability program should prioritize what users will feel most often:

1. **Capability truth and compatibility.** One resident-facing inventory must
   distinguish runtime-provided, Polyphonic-provided, configured, granted,
   unavailable, and needs-attention states. No duplicated profiles or hidden
   fallback.
2. **Internet work.** Deliver web search and browser use as separate tools: web
   search for fast sourced retrieval; browser use for interactive pages and
   workflows.
3. **Skills and MCP end to end.** Move beyond discovery/presentation so a
   resident can actually use compatible, explicitly granted capabilities from
   inside Polyphonic. These are non-negotiable parity foundations.
4. **Image generation and editing.** Make visual creation a normal resident
   tool with Polyphonic artifact/preview integration.
5. **Parallel task orchestration.** Build explicit delegation, independent
   parallel execution, progress, cancellation, and result return on top of
   existing resident/A2A identities rather than inventing a mandatory
   conductor.
6. **Automations and scheduled tasks.** Add durable user-authorized triggers
   only after ordinary tool execution and parallel task ownership are reliable.
7. **Computer use.** Add macOS-wide control incrementally, beginning with a
   narrow permission and safety contract. Browser use should not wait for full
   desktop control.

This order is intentionally incremental. It may be regrouped into build lanes
after the prerequisite closes, but none of these capabilities should be
quietly dropped from the parity program.

## Shared implementation laws

- The user's existing runtime profile and authentication remain authoritative.
- Capability grants attach to the stable resident identity and exact tool or
  connection; room membership never grants tools.
- Context selection changes working material, not authority.
- Polyphonic owns the permission UI, cancellation, visible activity, and
  durable outcome receipts for Polyphonic-hosted capabilities.
- Runtime-owned tools remain runtime-owned. Polyphonic discovers and invokes
  them through supported interfaces instead of copying secrets or rewriting
  native configuration.
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
re-audit the current installed capabilities, freeze the capability provider and
permission contracts, then write the smallest decision-complete build spec for
the first lanes. Do not begin by attempting the entire matrix at once.
