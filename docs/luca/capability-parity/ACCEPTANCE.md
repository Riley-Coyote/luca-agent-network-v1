# Polyphonic capability parity acceptance contract

Status: draft pending Riley scope approval

Authority: [`BUILD_SPEC.md`](BUILD_SPEC.md)

Task graph: [`TASK_GRAPH.yaml`](TASK_GRAPH.yaml)

## Verdict rules

Source tests can establish contracts and deterministic behavior. They cannot
prove that an installed Codex, Claude Code, Hermes, or OpenClaw session exposes
or successfully executes a capability. Live claims require the existing signed
Dev app and the exact existing runtime profile or binding.

No aggregate pass may hide an unavailable or deferred row. The final matrix
uses only `verified`, `unavailable`, `not_applicable`, and
`deferred_by_riley` as terminal product verdicts.

## Acceptance IDs

### CP0 — Approval and control

- **A001:** Riley's response is transcribed into every `R`, `P`, and `X` scope
  decision without inferred additions.
- **A002:** The spec status, baseline commit, branch, and approved runtime matrix
  are frozen before implementation.
- **A003:** `approved parity complete` and `full backlog complete` remain
  distinct verdicts.
- **A004:** Existing unrelated dirty files are enumerated and excluded from
  every capability commit.
- **A005:** No additional persistent Dev app, runtime profile, or runtime
  account is created.
- **A006:** User-only stop conditions and autonomous authority match the build
  specification.

### CP1 — Live capability truth

- **A101:** Every approved runtime target records executable, runtime version,
  adapter version, existing-profile availability, and sanitized evidence.
- **A102:** Every approved capability records provider, support, configuration,
  authority, and execution state.
- **A103:** Declared/discovered support is never promoted to `live_verified`
  without an exact bounded probe.
- **A104:** Missing runtime, configuration, permission, and provider states have
  distinct reason codes and no credential or private-body leakage.
- **A105:** The renderer receives one native capability projection; it does not
  maintain a rival runtime-ID table.
- **A106:** Loading/unknown does not render as unsupported, and stale audit
  results cannot cross runtime, resident, owner, or community boundaries.
- **A107:** Capability inventory clearly distinguishes runtime, Skill/plugin,
  MCP, and Polyphonic-hosted providers.

### CP2 — Runtime-native execution

- **A201:** Approved residents can perform bounded project read/search/edit,
  shell, Git status/diff, test, and build operations through the selected
  runtime and working context where live-verified.
- **A202:** Context selection never grants filesystem, network, MCP, Skill, or
  tool authority.
- **A203:** Native approval/sandbox policy and Polyphonic grants both remain
  enforceable; denial produces no side effect.
- **A204:** Skill compatibility is resolved against the exact selected runtime.
- **A205:** A supported Skill reaches the runtime through a structured path when
  the adapter offers one; a prose handoff is not reported as verified
  structured invocation.
- **A206:** Missing, incompatible, changed, or failed Skills show an honest
  repairable state without switching runtimes or profiles.
- **A207:** Explicitly granted Polyphonic-managed MCP tools execute end to end
  through the inherited secure transport.
- **A208:** Runtime-owned MCP configuration remains sanitized and read-only
  unless that runtime exposes a supported native mutation path approved later.
- **A209:** MCP secrets remain runtime- or Keychain-owned and never cross the
  renderer, message body, receipt, or log boundary.
- **A210:** Grant, denial, revocation, timeout, server failure, and cancellation
  each have deterministic tests and visible distinct outcomes.

### CP3 — Existing-provider exposure

- **A301:** Verified runtime/MCP web search returns current sourced results and
  visible citations; no provider means honest unavailability.
- **A302:** Verified runtime/MCP browser use exposes navigation/activity and an
  immediate stop without granting unrestricted desktop control.
- **A303:** Verified runtime/MCP image generation or editing returns a preview,
  provider/provenance, cancellation, and optional save through existing
  artifact flows.
- **A304:** `Expose only` rows never create a paid provider, account, API key,
  browser driver, or hidden fallback.
- **A305:** Runtime-native subagent work remains owned by that runtime and does
  not create a fake Polyphonic resident or signed A2A transcript.
- **A306:** Native parallel progress, cancellation, and result return are shown
  only to the degree the adapter truthfully exposes them.
- **A307:** Runtime-native schedules/background work never claims Polyphonic
  restart durability, deduplication, or authority it does not possess.

### CP4 — Unified conversation experience

- **A401:** Ordinary requests remain conversational; capability controls do not
  turn chat into a developer console.
- **A402:** Existing response streaming and premium activity presentation remain
  intact; raw chain-of-thought is never rendered.
- **A403:** Long or external actions show human-readable progress and an
  effective stop; stopped work does not publish a false final.
- **A404:** Failures identify the acting resident, requested capability,
  provider, and repair path without losing the user's draft or silently using a
  weaker provider.
- **A405:** Files, patches, commands, citations, images, previews, and artifacts
  render in their existing natural surfaces with inspectable provenance.

### CP5 — Conditional expansions

- **A501:** Every included `X` row has its own approved provider/security/UX
  lane spec before code begins.
- **A502:** Every non-approved `X` row remains untouched and terminally recorded
  as `deferred_by_riley`.

### CP6 — Source and installed assurance

- **A601:** Focused Rust and frontend tests cover every changed contract, happy
  path, denial, unavailable state, cancellation, retry, and stale-boundary case.
- **A602:** Formatting, lint/type checks, frontend production/E2E build, and
  `git diff --check` pass on the exact candidate.
- **A603:** Messaging, Brain/context, continuity, visits/A2A, artifacts, and
  runtime readiness regressions touched by the program pass without weakening
  assertions.
- **A604:** The existing signed Dev app is rebuilt, replaced in place, and
  relaunched; no second bundle/profile is created.
- **A605:** Every available approved runtime target completes the applicable
  installed matrix using its existing profile/binding.
- **A606:** Dark and light capability, permission, activity, failure, and result
  states are visually inspected at ordinary and narrow desktop widths.
- **A607:** The final verdict names the exact source commit, installed bundle,
  runtime/adapter versions, row-level terminal states, remaining deferrals, and
  any user-only acceptance still outstanding.

## Focused gate families

Exact commands may be narrowed to affected packages, but the final candidate
must include the applicable forms of:

```bash
. ./bin/activate-hermit
cargo fmt --all -- --check
cargo test -p buzz-acp --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib
cargo check --manifest-path desktop/src-tauri/Cargo.toml
cd desktop && pnpm typecheck
cd desktop && pnpm test
cd desktop && pnpm build
cd desktop && pnpm build:e2e
git diff --check
```

The implementation owner records exact selected tests and counts. A filter that
runs zero intended tests is not evidence. Broader `just ci` is required before
any PR or push, but this specification authorizes neither without Riley.

## Installed matrix template

For every available approved runtime target:

1. launch the existing resident with the existing profile/binding;
2. confirm the live capability inventory matches the audit;
3. execute each applicable approved lane using bounded reversible fixtures;
4. exercise approval/denial, cancellation, provider failure, and recovery;
5. confirm result presentation and receipts;
6. relaunch the Dev app and verify no authority or completed side effect was
   duplicated; and
7. record unavailable/not-applicable rows without manufacturing a pass.

Real credentials, runtime configuration, identity, Brain, continuity, and user
messages remain read-only except for the ordinary low-impact conversation turns
required for installed acceptance.
