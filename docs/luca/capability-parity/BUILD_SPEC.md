# Polyphonic capability parity execution specification

Status: **draft for Riley scope approval**

Branch: `codex/unified-dev`

Source baseline: `f2ee3861f`

Architecture authority:
[`../RUNTIME_FIRST_CAPABILITY_CONTRACT.md`](../RUNTIME_FIRST_CAPABILITY_CONTRACT.md)

Backlog authority:
[`../POLYPHONIC_RESIDENT_CAPABILITY_PARITY.md`](../POLYPHONIC_RESIDENT_CAPABILITY_PARITY.md)

## 0. Approval sheet

This is the only section Riley needs to review before approving or narrowing
the program. `Include` means Codex may implement the lane autonomously under
this specification. `Expose only` means use an already available runtime,
Skill/plugin, or MCP provider; do not build a Polyphonic replacement.

Relative size describes implementation uncertainty after the live audit, not a
time promise.

### 0.1 Runtime acceptance targets

| ID | Target | Recommended decision | Size | Boundary |
|---|---|---:|---:|---|
| R1 | Codex | **Include** | L | Live acceptance through Riley's existing installed profile. No second profile. |
| R2 | Claude Code | **Include** | L | Live acceptance through Riley's existing installed profile. No second profile. |
| R3 | Hermes | **Include if already configured** | M | Audit and live-test only an existing usable profile; absence does not authorize creating one. |
| R4 | OpenClaw | **Include if already configured** | M | Audit and live-test only an existing usable binding; absence does not authorize creating one. |
| R5 | Goose or other discovered ACP runtimes | **Defer** | Unknown | Preserve generic contracts; no release-blocking live matrix in this pass. |

### 0.2 Recommended parity release

| ID | Capability lane | Recommended decision | Size | Included outcome |
|---|---|---:|---:|---|
| P01 | Live capability audit and handshake | **Include** | L | Replace static assumptions with exact runtime/session capability facts where the adapter permits. |
| P02 | Truthful capability inventory | **Include** | M | One native source feeds provider, support, configuration, authority, and execution states to the UI. |
| P03 | Files, repository, shell, Git, tests, and builds | **Include** | M | Expose existing runtime/developer tools end to end in the selected working context. |
| P04 | Skills | **Include** | M | Replace prompt-only handoff with verified compatibility, structured invocation when supported, and honest failure. |
| P05 | MCP | **Include** | L | Complete explicitly granted Polyphonic-managed MCP execution and truthful runtime-owned MCP visibility. |
| P06 | Web search and fetch from an existing provider | **Expose only** | M | Use verified runtime/MCP search with citations; do not add a new paid provider. |
| P07 | Browser use from an existing provider | **Expose only** | M–L | Use verified runtime/MCP browser tools with permission, activity, cancellation, and results. |
| P08 | Image generation/editing from an existing provider | **Expose only** | M | Use a verified runtime/MCP image tool and save results through existing artifact flows. |
| P09 | Runtime-native subagents and parallel work | **Include** | M | Surface runtime-owned delegation and progress without rebuilding its execution engine. |
| P10 | Runtime-native schedules/background work | **Expose only** | M | Surface verified native behavior; do not claim Polyphonic restart authority over runtime-owned jobs. |
| P11 | Unified permissions, activity, cancellation, retry, and results | **Include** | L | Every included capability has a consistent premium conversation experience and truthful receipts. |

### 0.3 Expansions recommended for deferral

These are valuable, but they are substantive Polyphonic product systems rather
than simple runtime exposure. Selecting one for inclusion authorizes a separate
decision-complete lane spec before its implementation; it does not authorize a
provider, purchase, account, or security model to be chosen while coding.

| ID | Expansion | Recommended decision | Size | Why separate |
|---|---|---:|---:|---|
| X01 | Polyphonic-hosted web-search fallback | **Defer** | L | Requires a provider, authentication, pricing, citation, and privacy decision. |
| X02 | Polyphonic-hosted interactive browser controller | **Defer** | XL | Requires a browser driver, profile/cookie boundary, download policy, and sensitive-action contract. |
| X03 | Polyphonic-hosted image-generation provider | **Defer** | L | Requires provider, model, cost, provenance, and moderation decisions. |
| X04 | Cross-resident/cross-runtime task orchestration | **Defer** | XL | New durable task ownership and coordination layer, distinct from native subagents and A2A chat. |
| X05 | Polyphonic automations, schedules, and restart-safe jobs | **Defer** | XL | New trigger, budget, retry, deduplication, persistence, and pause/disable system. |
| X06 | Polyphonic macOS computer use | **Defer** | XL | Requires Accessibility/Screen Recording consent, target bounds, confirmations, and emergency stop. |
| X07 | New hosted connectors | **Defer** | L each | Prefer MCP; any exception needs its own authentication and permission contract. |
| X08 | Voice and general audio tools | **Defer** | L–XL | Separate interaction, provider, permission, streaming, and artifact program. |

### 0.4 Approval response format

Riley may approve with one line:

```text
Approve the recommended parity release. Defer X01-X08.
```

Or change only the exceptions:

```text
Approve recommended scope, remove P08 and P10, and prepare X04 for inclusion.
```

After approval, this section is updated with exact `include`, `expose_only`, or
`defer` decisions and the document status becomes **approved for
implementation**. Unapproved rows never enter implementation silently.

## 1. Outcome

Ship the approved parity release in which a resident can use everything its
exact selected runtime exposes through Polyphonic's embedded session, with the
same existing runtime profile, authentication, working context, Skills/MCP,
native policy, and native subagents.

Polyphonic supplies the capability discovery, transport, permission surface,
activity, cancellation, recovery, receipts, and result presentation required
to make that work natural inside conversation. It does not rebuild a runtime
engine or imply that host-only features of a vendor application were inherited.

## 2. Completion vocabulary

- **Lane prepared:** its contract and focused tests exist.
- **Lane source-tested:** its focused source gate passes at one exact commit.
- **Lane installed-tested:** the existing Dev app proves the lane against every
  applicable available runtime target.
- **Approved parity complete:** every approved `include` and `expose_only` row
  is installed-tested, unavailable with an approved honest reason, or marked
  not applicable by the frozen audit matrix.
- **Full backlog complete:** no `X` row remains deferred. This term must not be
  used if Riley defers any expansion.

Deferral is a scope decision, not hidden incompleteness. A missing runtime,
provider, credential, or operating-system permission is recorded explicitly
and never converted into a false pass.

## 3. Frozen product laws

1. Provider resolution is runtime-native, then compatible Skill/plugin/MCP,
   then an explicitly approved Polyphonic-hosted provider, then honest
   unavailability.
2. `Declared` support is not live proof. Unknown/loading is not unsupported.
3. Runtime-owned tools remain governed by runtime-owned approval, sandbox,
   credential, and configuration policy.
4. Polyphonic-owned grants attach to the stable resident and exact tool; room
   membership and context selection grant nothing.
5. The user's existing runtime profile and authentication remain authoritative.
   No sterile or Polyphonic-only Codex/Claude profile is created.
6. Polyphonic never copies credentials, hidden prompts, raw chain-of-thought,
   or private native-session envelopes into messages, receipts, or logs.
7. Native session catalogues remain read-only context sources, not resumed or
   synchronized conversations.
8. Runtime-native subagents are not presented as Polyphonic residents.
   Polyphonic residents remain stable signed identities.
9. No new plugin format is introduced. Skills and MCP remain the portable
   extension substrate.
10. Messaging, Brain/context, continuity, artifacts, and current visual design
    are preserved except where an approved capability lane touches them.

## 4. Existing implementation disposition

### 4.1 Adopt and extend

| Existing system | Primary sources | Disposition |
|---|---|---|
| Runtime catalog and spawn authority | `desktop/src-tauri/src/managed_agents/discovery/runtime_metadata.rs`, `desktop/src-tauri/src/managed_agents/runtime.rs` | Keep one native source of truth; extend with live/session observations rather than creating frontend runtime tables. |
| Declared runtime manifests | `desktop/src-tauri/src/luca/runtime_capabilities.rs` | Keep as declared adapter metadata; never treat it as installed proof. |
| Repository/developer bridge | `desktop/src-tauri/src/luca/repository_bridge.rs`, `desktop/src-tauri/src/luca/repository_bridge/operations.rs` | Reuse for scoped file/repository work, permissions, and receipts. Do not build another work broker. |
| Resident capability authority | `desktop/src-tauri/src/luca/resident_capability_authority.rs`, `desktop/src-tauri/src/luca/managed_permission.rs` | Extend existing grants, prompts, revocation, and receipts. |
| MCP registry and inherited transport | `desktop/src-tauri/src/luca/mcp_registry.rs`, `desktop/src-tauri/src/luca/managed_mcp.rs`, `crates/buzz-acp/src/managed_mcp_provider.rs` | Preserve secret custody and inherited transport; finish compatibility and execution truth. |
| Skills library | `desktop/src/features/capabilities/` | Preserve browse/read UX; replace prose-only invocation where a structured runtime path exists. |
| Activity and message streaming | `desktop/src/features/messages/`, `desktop/src/features/agents/ui/activityRenderClasses/` | Reuse the current polished stream/activity system and add capability-specific states without a redesign. |
| Artifact presentation | `desktop/src/features/artifacts/`, artifact MCP/Canvas paths | Reuse for generated files, images, previews, and provenance. Sketchbooks remain deferred. |

### 4.2 Do not adopt as capability proof

- A runtime display name or model label.
- A static frontend feature table.
- Presence of a config file without a validated adapter/session.
- A skill-selection prompt that merely asks the model to use a Skill.
- A native vendor application feature that is not exposed through the embedded
  runtime or an explicitly granted provider.
- A mocked E2E capability without matching source and installed evidence.

## 5. Live capability audit contract

Before capability implementation, create a versioned, body-free audit matrix
for every approved runtime target and capability row. Each cell records:

```text
runtime_family
runtime_version
adapter_version
capability_id
provider_kind: runtime | skill | plugin | mcp | polyphonic_hosted
support: declared | discovered | live_verified | unavailable | unknown
configuration: configured | needs_attention | absent | not_applicable
authority: granted | approval_required | denied | runtime_managed
evidence_ref
reason_code?
```

The audit may read sanitized runtime configuration and execute bounded,
non-destructive probes through existing profiles. It may not mutate native
configuration, create accounts, install a second profile, or disclose secrets.

The audit automatically routes work under the approved choices:

- `live_verified` runtime/Skill/MCP provider: expose it.
- declared/discovered but not executable: repair the adapter or report the
  exact incompatibility.
- absent provider in an `expose_only` row: record honest unavailability; do not
  invent a fallback.
- absent provider in a separately approved `X` lane: follow that lane's later
  approved provider contract.

## 6. User-visible behavior

### 6.1 Capability inventory

One resident-facing inventory shows capability, provider, readiness, authority,
and repair state. It must distinguish runtime-provided, extension-provided, and
Polyphonic-hosted tools without making the provider more prominent than the
resident.

### 6.2 Invocation

Ordinary user requests remain conversational. Pickers and explicit actions may
select a Skill, MCP connection, working context, or approved provider, but the
user should not have to manage a developer console to use an agent.

### 6.3 Activity and results

The existing streaming response and premium activity presentation remain. Tool
states use human-readable action summaries; they never expose raw
chain-of-thought. Every long or external action can be stopped. Failures name
the unavailable capability/provider and preserve the user's draft or task.

Results render in their natural form: sourced links, files, diffs, commands,
images, previews, or artifacts. Result provenance and provider are inspectable
without adding permanent clutter to the conversation.

## 7. Workstreams and file ownership

At most three delegated lanes run beside the integration owner. Recursive
delegation is forbidden.

| Workstream | Owns | Must not independently change |
|---|---|---|
| Integration owner | Contract types, shared files, task graph, commits, installed app, final verdict | Nothing is delegated without a bounded file set and acceptance target. |
| Runtime/audit lane | Runtime discovery, adapter probes, ACP/native transport, repository/MCP/Skill execution | Conversation visual design, relay protocols, identity, or persistence outside approved schemas. |
| Capability UI lane | Capability inventory, settings, permission/activity/result presentation, focused frontend tests | Native capability facts, runtime config writers, message transport, or new providers. |
| Verification lane | Fixtures, focused Rust/JS/Playwright gates, audit evidence, installed matrix | Product behavior or production code except isolated testability seams approved by the owner. |

Shared files such as runtime catalog types, Tauri command registration, shared
API types, and primary message surfaces are integration-owner files. Delegates
propose changes or take an explicit short ownership window; they do not edit
them concurrently.

## 8. Ordered implementation and commit boundaries

1. **Control:** record approved rows, exact baseline, relevant dirt, installed
   runtime/profile availability, and no-touch paths.
2. **Audit:** add the body-free live capability matrix and deterministic
   adapter probes.
3. **Truth:** expose one native capability view and renderer-safe projection.
4. **Native work:** prove files/repository/shell/Git/tests/builds through the
   selected runtime and context.
5. **Skills:** finish compatibility and structured execution where supported.
6. **MCP:** finish managed execution, runtime-owned visibility, grants,
   revocation, and failure states.
7. **Existing-provider tools:** expose approved web/browser/image/subagent/
   schedule capabilities found by the audit.
8. **Conversation integration:** unify permission, activity, cancellation,
   retry, result, and receipt presentation.
9. **Conditional expansions:** execute only separately approved `X` lane specs.
10. **Assurance:** run focused source gates, rebuild/relaunch the existing
    signed Dev app, execute the installed matrix, and publish the final verdict.

Each numbered implementation step receives its own reviewable commit, or a
small series split by native/frontend/test ownership. No unrelated dirty file
is included. Failed experiments are not hidden inside a successful lane commit.

## 9. Autonomous authority and stop conditions

### 9.1 Pre-authorized after spec approval

Codex may autonomously:

- inspect installed runtime executables and sanitized read-only configuration;
- use Riley's existing authenticated runtime profiles for bounded tests;
- edit in-scope source, tests, fixtures, and documentation;
- add ordinary repository dependencies when they do not create an account,
  service, runtime profile, or competing subsystem;
- create isolated fixtures and temporary test homes;
- build, sign through the existing development workflow, replace in place,
  relaunch, and inspect `/Users/rileycoyote/Applications/Luca Agent Network Dev.app`;
- fix in-scope regressions revealed by the approved gates;
- use the bounded agent team in Section 7; and
- commit each accepted lane on `codex/unified-dev`.

### 9.2 Stop and request Riley

Stop only for:

- a new account, subscription, purchase, API key, OAuth login, or provider
  choice not frozen in an approved `X` lane;
- an interactive macOS Accessibility, Screen Recording, microphone, camera, or
  other system-consent prompt;
- mutation of a real native runtime configuration or credential store;
- deletion or migration of real messages, identity, Brain, continuity, or
  runtime data;
- push, merge, public release, notarization, or external publication;
- a required product decision absent from this specification;
- repeated evidence that the approved architecture is false; or
- overlap with unrelated dirty work that cannot be isolated safely.

Ordinary implementation uncertainty, a failing test, or a recoverable adapter
bug is not a reason to stop. Record it, repair it, and continue.

## 10. Explicit non-goals

- Native-session transcript synchronization or impersonation.
- New runtime profiles or copied credentials.
- A competing plugin or agent engine.
- Full Mnemos reflection/metabolism work.
- Brain/session-catalog expansion beyond regressions required by this program.
- Sketchbooks, Gallery/Edition rooms, notch companion, Motes, broad project
  organization changes, mobile production work, or general UI redesign.
- Relay protocol, production onboarding, cloud sync, or runtime-authentication
  architecture changes unless an approved lane proves an unavoidable narrow
  dependency and Riley approves it.

## 11. Verification and completion

[`ACCEPTANCE.md`](ACCEPTANCE.md) is the human-readable gate and
[`TASK_GRAPH.yaml`](TASK_GRAPH.yaml) is the ordered execution record. Source
tests prove deterministic contracts; only the installed app may prove live
runtime capability.

The final verdict lists every row as `verified`, `unavailable` with reason,
`not_applicable`, or `deferred_by_riley`. It may say **approved parity
complete** only when every approved row reaches a terminal accepted state. It
may say **full backlog complete** only when no expansion remains deferred.
