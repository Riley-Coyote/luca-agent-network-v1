# Polyphonic companion delegation implementation specification

Date: 2026-10-04

Status: **approved for implementation**

Approved by Riley: 2026-10-04 (`Approve D0-D6`).

Implementation worktree: `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-delegation-2026-10-04`.

Implementation branch: `codex/companion-delegation-2026-10-04`.

Product: the existing Polyphonic desktop app. Web/mobile and the separate design
exploration are not inputs to this work.

Architecture: [runtime-first capability contract](../RUNTIME_FIRST_CAPABILITY_CONTRACT.md).

## 1. Approval sheet

Approve or remove individual lanes before implementation begins.

| ID | Included outcome |
|---|---|
| D0 | Establish an isolated, reproducible baseline from the shipped desktop release. |
| D1 | Prove exact-session control for Codex and Claude Code, including native-app/active-session limitations. |
| D2 | Resolve the intended harness, project, and existing session without guessing. |
| D3 | Start new work and continue/message existing work through supported native controls. |
| D4 | Reliably follow work, reconcile after restart, and avoid duplicate dispatch. |
| D5 | Surface questions and approvals, deliver replies, stop the intended work, and return results to the companion. |
| D6 | Verify the complete experience and performance; prepare an isolated native candidate for Riley. |

Approval authorizes this bounded queue, not public release or installed-app replacement.
D1 is a feasibility gate, not permission to substitute a different experience.
If a required native control path cannot be proved, report the limitation and
request a scope decision before treating that path as implementable.

### Approved phased boundary — 2026-10-04

Riley answered `yes` to proceeding with the verified dispatch/continuation
paths while temporarily leaving approvals and stopping **externally owned**
sessions in their native apps. D2/D3/D5 may proceed for those proved paths.
Owned Polyphonic tasks retain their existing permission and stop controls.

- Codex app-session follow-ups use the proved public exact-ID queue, clearly
  labeled as queued delivery rather than steering or task completion.
- Saved Codex CLI continuation uses the proved original native ID and workspace;
  it is never presented as app-owned control or a replacement for a live session.
- Claude execution remains gated on its affected native proof; quota is not
  evidence that the native capability is unsupported. No provider/model fallback.
- Externally owned progress/result observation is advertised only when separately
  verified and correlated. Otherwise preserve a truthful native handoff/unresolved
  receipt rather than a successful-looking result or blind retry.

This is phased implementation approval, not full D0-D6 completion or release
approval. All existing isolation, consent, native-proof budget and deferrals
remain unchanged.

Suggested approval:

```text
Approve D0-D6 of the Polyphonic companion delegation specification and its bounded test budget. Implement through an isolated native candidate, with checkpoint commits and pushes on a dedicated feature branch. Preserve design work and personal sessions. Do not merge, replace the installed app, or release publicly without my approval.
```

This is a proposed amendment to the older
[beta capability specification](BETA_IMPLEMENTATION_SPEC.md): exact native-session
continuation and restart-safe delegation tracking move into scope here. Other
deferrals remain deferred. This does not authorize transcript synchronization,
a general automation service, or a redesign of the Work Tray.

## 2. Problem and goals

Polyphonic already runs companions and launches bounded runtime tasks, but that
task lane creates new sessions; importing session context does not control the
original session. Users need one companion that can act in their intended
Codex/Claude project and session, follow the work, handle interruptions, and
bring the outcome back without making the human relay messages between tools.

Required outcomes:

1. New work starts in the explicitly resolved project using the user's existing harness configuration.
2. Continuing or replying targets the exact native session; no silent replacement, fork, or “latest session” shortcut.
3. Progress, questions, blockers, cancellation, and results remain legible in Polyphonic.
4. App restart or a lost acknowledgement does not silently duplicate work or lose its ownership.
5. Coordination uses native capabilities; Polyphonic remains the companion and control bridge, not another harness.

Representative requests:

- “Have Codex start this task in this project.”
- “Respond to Codex in that existing session in the Codex app.”
- “Have Claude Code continue working on this project.”
- “Tell them to use the smaller approach,” then “Stop that task.”

The user can stay in Polyphonic during ordinary delegation. Native login, trust,
or permissions that cannot be mediated must be explained and handed off honestly.
Opening the harness is optional except where its supported control requires it.

## 3. Baseline and evidence boundaries

Recorded local baseline on October 4:

- Installed `/Applications/Polyphonic.app`: `0.5.0-beta.13`.
- Shipped source: `v0.5.0-beta.13`, commit `f84aaafa53386f213b832441983838b23c32c745`.
- Canonical checkout: `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-first-meeting-finish`.
- App branch: `codex/first-meeting-finish`; audited HEAD: `f96a3c7bc`.
- That checkout includes committed and uncommitted design exploration. Do not use its complete working tree as the implementation base.
- The post-release incremental Brain optimization is separate work, not an automatic addition to this queue.

Revalidate these identities when implementation begins; stop if a newer desktop
release or competing implementation changes the base. Use an isolated managed
worktree and dedicated feature branch from the verified shipped release. No
website branch merge, shared `node_modules`, stash, or cleanup of another tree.

| Existing foundation | Evidence | What it does not establish |
|---|---|---|
| Companion session restoration and warm reuse | Implemented; prior native acceptance is recorded in [session-resume notes](../NATIVE_SESSION_RESUME_CANDIDATE.md). | Control of an arbitrary session in another app. |
| Cross-resident consultation | Native exchange-plan implementation, with bounded ownership and return routing. | External Codex/Claude session control. |
| Explicit Codex/Claude runtime tasks | Confirmation, execution, activity, stop, and result receipt path exist in source. | Existing-session continuation: the runner calls `session_new_full`. |
| Native session catalogue and attachments | Read-only metadata/context paths exist. | A session attachment is not a resumed or synchronized session. |
| Restart handling for runtime tasks | Persisted active work is marked interrupted. | Reconnection to externally continuing work or durable result delivery. |

These are source/audit findings, not a fresh end-to-end certification of the installed app.

Harness observations from the audit:

| Harness | Audited CLI/protocol interface, not native acceptance | Still requires D1 proof |
|---|---|---|
| Codex CLI `0.160.0` | Exact-ID CLI resume; app-server thread/turn methods and control-socket tooling. | A supported connection to the controller owning the actual Codex app session. A separate app-server process is not equivalent. |
| Claude Code `2.1.283` | Exact-ID resume, structured streaming, native agent status/background-session tooling. | Sending to an already-running interactive session. Background resume can copy a session, especially when it is already running. |

Installed versions and capabilities must be discovered again, not hardcoded from
this table. The Codex tools available inside this assistant's chat do not prove
that Polyphonic can invoke those host-bound tools.

Blocking technical questions belong to D1: can Polyphonic reach the supported
controller owning a Codex app session, and can Claude accept a message into an
already-running interactive session without copying it? Investigate these
without asking Riley to choose speculative architecture. If a required path
remains unavailable, present the evidence and the smallest scope decision.
Adapter/module naming and compatible receipt migration are non-blocking
implementation choices governed by existing repository conventions.

Official references: [Codex app server](https://developers.openai.com/codex/app-server/),
[Claude session management](https://code.claude.com/docs/en/agent-sdk/sessions),
[Claude agent view](https://code.claude.com/docs/en/agent-view), and
[Claude CLI](https://code.claude.com/docs/en/cli-reference).
Installed protocol schemas/help and native acceptance determine actual support.

## 4. Scope and non-goals

P0: all D0-D6 outcomes, subject to the D1 feasibility gate. Existing-session
continuation is a core requirement, not a nice-to-have that can disappear during implementation.

Reuse existing confirmation, permission, activity, and result surfaces. Add only
the target/status/question affordances needed to make delegation truthful.

Out of scope:

- Separate design exploration, navigation/rail changes, Obsidian polish, onboarding, and branding.
- Rebuilding files, shell, Git, Skills, MCP, subagents, editors, terminals, or harness settings interfaces.
- Bidirectional transcript mirroring, a second agent engine/profile, or a generic workflow/automation service.
- New paid API providers, credentials, model fallbacks, or changes to personal runtime/global configuration.
- Other harness connectors until their exact external-control capability is separately approved and proved.
- Brain overhaul, unrelated cleanup, public release/update-feed changes, or installed-app replacement.

## 5. Control contract and invariants

Implement within the existing native capability/task authorities. Do not create
a frontend capability table or a parallel task database merely for this feature.

### Target identity

The native host resolves a private handle containing harness/profile identity,
native session ID, controller identity, project association, actual canonical
working directory/worktree, observed state, and supported operations. The UI
receives an opaque reference plus safe display metadata, not credentials or raw
provider envelopes.

- New task: resolve an explicit connected project/folder, or ask one focused question.
- Existing work: resolve the exact native session and its real project/worktree. A different requested project requires clarification, not a silent directory switch.
- Ambiguous names, stale references, duplicate project names, and changed profiles must stop dispatch until resolved.
- Session titles/transcripts are reference material, never authority or reliable live status.
- Catalogue access remains scoped to granted sources; control access is independently checked against the user's requested action.

### Operations

Provide a small native adapter contract for discovery, start-new, continue/send,
observe, answer-input, and cancel. Advertise support per operation and session
state: saved, idle, active, waiting, disconnected, or unknown. Unknown is not
unsupported; process presence alone is not proof of active work or success.

- Codex: prefer the supported controller owning the native-app session for app-directed work. Separate CLI resume can only satisfy a separately verified saved-session operation, not “reply in the Codex app.”
- Claude: exact saved-session resume must retain identity. Active-session messaging needs its own supported path; `--bg` copying is not continuation.
- No `--last`, implicit fork, private-pipe impersonation, forged caller metadata, UI automation, or killing a user's session to make resume possible.
- Preserve native authentication, model/configuration, Skills, MCP, instructions, and permission policy. External tasks do not inherit Luca's resident identity prompt.
- A provider-returned session ID that differs from an existing target is a mismatch, not success. Reconcile and report it; do not silently follow the replacement.
- When active work only supports queued follow-up rather than steering, describe that distinction. Bind steering/cancellation to the expected native turn or equivalent ownership check.

### Durable action and observation

Persist validated intent and ownership before dispatch. Record the native
acknowledgement, exact target, actual working directory, event cursor where
available, and completion/delivery state using atomic, private storage.

- Use provider idempotency where supported and local per-session dispatch exclusion. Local locks do not claim ownership over another client's work.
- Lost acknowledgement means uncertain delivery. Query/reconcile before retry; never blindly repeat a possibly applied message or task.
- Storage failure cannot leave an untracked child or a successful-looking receipt. Verify recovery/cleanup without cancelling unrelated native work.
- Recover observations after app restart. If reconnection is unavailable, retain a truthful interrupted/unknown state and repair action; never start replacement work.
- Sort before limiting persisted receipts; preserve bounded reads and backwards compatibility with existing task records.
- Completion and result delivery must not depend on holding the companion's MCP call open for the entire job. Acknowledge dispatch, observe durably, and resume result synthesis through a bounded host-owned path.
- Deliver results to the originating companion/conversation, including when it is not currently open. Deduplicate delivery by action/result identity; retry synthesis without rerunning the provider task.

No unconditional “exactly once” claim is possible across an unacknowledged
provider side effect. The contract is explicit uncertainty plus safe reconciliation.

### Questions, authority, and stop

Separate waiting for a user answer, permission, provider availability, or ordinary
execution. Questions preserve their exact task/session/turn correlation.

- Use the existing permission/input surface; never manufacture an approval or silently widen an existing grant.
- The companion may answer within explicit user instructions. Material choices, new authority, and unresolved ambiguity go to the user.
- A queued answer invalidated by a newer native turn must be rejected or reconciled, never delivered to a different question.
- Cancellation affects only the requested task/turn. App shutdown must not kill an external session just because Polyphonic observed it.
- Terminal success needs native completion evidence; EOF, exit code zero, and a finished-looking activity label are not enough by themselves.
- Results and transcripts remain untrusted working material. Existing resident grants, signing boundaries, audience checks, and exchange budgets remain intact.

## 6. Ordered implementation queue

| Lane | Work and main existing touchpoints | Done when |
|---|---|---|
| D0 | Verify release/base; isolate source and Polyphonic test data; reproduce relevant checks; inventory runtime discovery and protocol versions. | Baseline, owned paths, test commands, and known failures are recorded. |
| D1 | Disposable native proof for both harnesses: new task, exact saved-session continuation, active-session follow-up, status, questions, stop, and reconnect as supported. Inspect supported app-controller access first. | Each operation has native evidence or a documented blocker. Required unsupported paths receive Riley's decision before D3 commits to a connector. |
| D2 | Extend native target resolution using connected session metadata and live provider facts. Fix relevant runtime executable discovery, including current bundled locations. | Wrong/ambiguous project or session cannot dispatch; the exact target and real workspace are clear. |
| D3 | Extend `runtime_tasks.rs`, its MCP authority, and the ACP/native runner with distinct new/continue/send operations and version-aware capabilities. | Same-ID new/continuation cases work through the proved controls, using existing profile/configuration. |
| D4 | Harden intent/receipt persistence, acknowledgement handling, event normalization, restart reconciliation, and durable completion delivery. | Fault injection cannot produce a hidden duplicate or false completion; observations and results survive restart. |
| D5 | Extend `tauriRuntimeTasks`, `useRuntimeTasks`, confirmation/receipt components, and companion instructions for targeting, questions, follow-up, cancellation, and synthesis. | The user completes the delegation loop from the existing conversation without relaying messages manually. |
| D6 | Deterministic tests, focused E2E, native acceptance, performance comparison, compatibility/regression checks, and isolated candidate packaging. | Evidence satisfies section 7; Riley receives the candidate and a concise handoff. |

Dependencies: D0 → D1 → D2/D3 → D4 → D5 → D6. Independent deterministic tests
and persistence fixes can proceed while a connector feasibility question is
being investigated, but do not label the complete experience finished.
Use milestone gates rather than a speculative calendar estimate.

Existing source anchors:

- Native tasks: `desktop/src-tauri/src/luca/runtime_tasks.rs`.
- Runner/session transport: `crates/buzz-acp/src/runtime_task_runner.rs`, `acp.rs`, `pool.rs`, and `runtime_session_map.rs`.
- Companion tool authority: `crates/buzz-dev-mcp/src/luca_repositories.rs` and `desktop/src-tauri/src/luca/resident_capability_authority.rs`.
- Target/context: `desktop/src-tauri/src/luca/connected_brain/{sessions,session_context}.rs` and `session_attachment.rs`.
- Discovery: `desktop/src-tauri/src/managed_agents/discovery.rs` and `discovery/runtime_cli.rs`.
- Existing UI/API: `desktop/src/features/capabilities/**` and `desktop/src/shared/api/tauriRuntimeTasks.ts`.

Prefer small focused modules when extending oversized files; do not broaden into an architectural rewrite.

## 7. Acceptance and verification

Every P0 case needs evidence naming the harness/version, controller, target
session, actual directory, expected outcome, and observed result. Keep native
proof distinct from mock/fixture coverage.

The acceptance score is all applicable P0 cases passing, with no observed wrong
targets, silent session replacements, duplicate dispatches, or unauthorized
actions in the test matrix. This is a bounded test result, not a statistical
production reliability claim. Do not add a telemetry platform to measure it.

| Case | Required result |
|---|---|
| New Codex task | Starts in the selected disposable project; the native-app visibility claim, if advertised, is observed in the actual app. |
| Reply in existing Codex app session | The original app/controller acknowledges the same session and intended turn; no replacement process/session is presented as equivalent. |
| Continue existing Claude work | Same native session ID and project; previously established context is retained without Polyphonic replaying a transcript as a substitute. |
| Active-session follow-up | Message reaches the intended session using proved steering/queue behavior; conflicting native activity cannot redirect it. Required unsupported active control blocks completion approval. |
| Question and permission | User sees the actual request, can answer/deny, and only that request receives the response. |
| Progress and result | Switching conversations does not stop observation; completion returns to the initiating companion once logically, with truthful provenance. |
| Stop | Stops only the intended task/turn; no broad process kill, unrelated session interruption, or false success. |
| Restart/reconnect | Existing native work is re-observed under the same identity, or honestly retained as unresolved; no implicit redispatch. |
| Uncertain dispatch/storage failure | Lost acknowledgements, disk failure, duplicate events, and partial writes do not cause blind retries, lost ownership, or false completion. |
| Bad target/provider | Ambiguity, missing runtime/auth, unsupported operation/version, changed working directory, and provider errors produce actionable states without fallback. |
| Regression | Existing companion streaming, warm reuse, consultation, task receipts, permissions, and identity/context isolation still work. |

Verification sequence:

1. Unit/protocol fixtures for identity, busy-state races, input correlation, cancellation, storage/recovery, and compatibility. Use fake providers for destructive/failure scenarios.
2. Focused Rust checks in both `crates/buzz-acp` and the separately manifested `desktop/src-tauri` crate; scoped formatting/lint and frontend helper tests.
3. Desktop `pnpm run typecheck`, production build, then `pnpm run build:e2e` and relevant Playwright tests, starting with `desktop/tests/e2e/luca/runtime-task-card.spec.ts`. Add exact-session/question/recovery cases alongside it.
4. Fresh native acceptance on disposable projects/sessions, using the user's existing account authentication and supported native control.
5. Full `just ci` at the integration gate plus `git diff --check`. Rebuild E2E assets after any Tauri build overwrites `dist`.

Activate the repository's Hermit toolchain before commands. Do not claim a green
gate by ignoring failures: record any baseline failure, reproduce it on the
untouched release, and disclose it in the candidate handoff.

Performance: record baseline/candidate dispatch overhead, progress-delivery
delay, catalogue reads, process count, and idle CPU/RSS on the same machine and
fixtures. No full transcript/index scan per chat message, no polling every open
session at high frequency, no redundant worker per observed turn, and no
unbounded event queue. Investigate reproducible regression before handoff;
separate provider/model latency from Polyphonic overhead.

## 8. Autonomous execution limits

The approval phrase above grants only the following proposed operating envelope:

- Read/investigate current implementation and official native interfaces; implement D0-D6 in the isolated feature worktree.
- Use disposable test projects and a separate Polyphonic test-data directory. Keep the native runtime profile/configuration unchanged; isolation is not a new shadow harness profile.
- Native acceptance budget: at most **12 disposable sessions and 40 prompt turns**, across Codex and Claude together; at most **2 concurrent native workers**, and **1 dispatch per exact session at a time**. Record usage; pause for approval if this budget is exhausted.
- Use existing account authentication/defaults; no new paid API billing path, account purchase, permission bypass, or silent model fallback. Authentication or quota problems pause the affected native gate.
- Tests may control only newly created, explicitly identified test sessions. Personal projects/sessions remain read-only during preparation and are never test targets.
- Make small checkpoint commits and push the dedicated feature branch after relevant checks. Do not merge into the shipping branch or publish a release.
- Delegate bounded, non-overlapping implementation/test tasks if useful; the primary agent owns integration and verifies evidence. Do not let parallel workers edit the same files or operate the same native test session.
- Build and open an isolated development candidate with separate app/data identity. Do not replace `/Applications/Polyphonic.app`, wipe profiles, or change native display/system settings.

Pause and request direction for unsupported required controller access, a
material scope change, new authority/cost, conflicting user work, or inability
to preserve exact-session identity. Try safe in-scope diagnostics first. Do not
use private APIs or a replacement session to get around the stop condition.

This spec is not a scheduled automation. If execution is interrupted, resume
from the saved queue and evidence; do not promise that a worker remains running
after its controlling process is gone.

## 9. Durable handoff and completion

Update this section at each checkpoint with owned paths, commit, commands and
results, native proof references, budget used, blockers, and the next action.
Do not commit credentials, raw personal transcripts, or private provider envelopes.

| Lane | Status | Evidence / next action |
|---|---|---|
| D0 | Established | Exact shipped beta.13 base, isolated feature tree, private candidate identity and reproducible checks recorded. Shipping/design tree and installed app preserved. |
| D1 | Codex paths proved; Claude gate paused | Exact saved CLI continuation and public native-app queue verified, including active-session follow-up. Claude proof quota-blocked, not unsupported. Native-app approvals/stopping remain in the native app under Riley's phased approval. |
| D2 | Implemented; deterministic checks pass | Granted-source metadata lookup, exact opaque session reference, canonical native workspace, bounded metadata reads and confirmation-time revalidation. No title/latest guesses or silent source/session switch. |
| D3 | Implemented for proved Codex paths | Separate owned new/continue lane and externally owned native-app queue. Production continuation runner passed same-ID/context proof; actual native queue acknowledgement is fixture-covered. Claude continuation remains disabled until native proof. |
| D4 | Implemented; native loop/restart acceptance pending | Persist-before-spawn, bounded private result/receipt storage, correlated completion, stop/shutdown races, coalesced recovery, and frozen-byte publication recovery. Owned-task return uses the original companion/conversation with digest/epoch/audience authority. Limitations below remain explicit. |
| D5 | Implemented; 23 focused UI cases pass | Exact target/workspace and native handoff confirmation, truthful queued/uncertain states, summary-only retry and command-receipt recovery when a live event is missed. Existing visual design retained. Native complete-loop acceptance remains pending. |
| D6 | Verification and packaging in progress | Scoped Rust/frontend checks and bounded browser regressions complete. Isolated signed candidate, native process metrics and complete-loop acceptance are the next gates; no release or installed replacement authorized. |

Native proof: [Codex](COMPANION_DELEGATION_D1_CODEX_EVIDENCE.md) and
[Claude Code](COMPANION_DELEGATION_D1_CLAUDE_EVIDENCE.md). Verified input delivery
is not a claim of cancellation, approval mediation or a complete delegation loop.

Budget used: **3 / 12 disposable IDs, 12 / 40 prompt attempts** (10 completed
Codex turns, one runner attempt aborted before verified completion, one Claude
quota rejection). All owned native test processes are terminal; the native app
fixture remains idle. No personal session was a test target. Reserve and record
another attempt before submitting a provider prompt; no automatic Claude retry,
paid API path, model fallback, or native-profile repair is authorized.

### Historical checkpoint verification — 2026-10-04

Implementation checkpoint: `6be4891d4462e195be1aa6f64b72b16f440d3f0c`,
pushed to `origin/codex/companion-delegation-2026-10-04`; remote SHA verified.
The shipping branch and installed beta.13 remain unchanged.

| Check | Observed result / boundary |
|---|---|
| Frontend helper suite | 4,096 / 4,096 pass on the release-based worktree. |
| `pnpm run typecheck` | Pass. |
| Storage fault/permission tests | 10 / 10 pass in a standalone Rust harness that includes the production `runtime_tasks/storage.rs` file directly. This is not the full desktop unit suite. |
| Desktop `cargo check --offline --locked --lib` | Pass using Rust 1.95.0 and the existing user Cargo cache. The repo's `_ensure-sidecar-stubs` recipe supplied compile-only placeholders after the initial missing-sidecar failure. This does not verify packaging or runnable sidecars. |
| Scoped Rust formatting | `rustfmt --edition 2021 --check` passes for both changed native files. |
| `pnpm run build:e2e` | Pass; existing chunk-size/dynamic-import warnings remain. |
| Existing runtime task-card Playwright spec | 6 / 6 smoke cases pass, one worker on port 5831. These are mock-backed UI regressions, not native delegation proof. |
| `git diff --check` | Pass. |
| Canonical checkout / installed app | Unrelated design changes preserved; installed beta.13 not replaced or launched. |
| Remaining gates | Full CI, full desktop unit suite, candidate packaging, native end-to-end acceptance and performance comparison are not completed. |

Owned implementation paths: `desktop/src-tauri/src/luca/runtime_tasks.rs` and
`desktop/src-tauri/src/luca/runtime_tasks/storage.rs`. Owned documentation is this
specification and the two D1 proof documents linked above. No other product
source is changed at this checkpoint.

Resume D1 after native Claude account availability and a supported route/explicit
scope decision for existing-session questions, cancellation and observation.
Do not silently substitute CLI-owned work for app-owned work, enable disabled
runtime configuration, or redispatch an unacknowledged provider action.

Scope decision granted: implement verified dispatch/continuation first, with
explicit native-app handoffs for approvals and stopping externally owned work.
The phased boundary in section 1 applies; full D0-D6 completion remains pending.

### Integrated implementation checkpoint — 2026-10-04

The next feature checkpoint contains the integrated phased implementation, not
the separate design exploration. Its exact source revision is recorded by Git
and will be embedded in the isolated candidate's signed source receipt.

| Check | Observed result / boundary |
|---|---|
| Frontend helper suite | 4,106 / 4,106 pass, including 56 runtime-task helper tests. |
| Typecheck, production build, fresh E2E build | Pass. Existing Vite chunk/dynamic-import warnings remain. |
| Task-card Playwright | 23 / 23 pass on fresh E2E assets, including missed delivery-event recovery, exact continuation and native queue handoffs. Mock-backed UI proof, not a native complete delegation loop. |
| Conversation regressions | 10 / 10 conversation-reliability, 2 / 2 send-binding, 1 / 1 messaging gate and 2 / 2 idle activity/focus cases pass. |
| Active activity shelf | Six failures in the bounded regression run; renderer/spec bytes are unchanged from beta.13. An exact untouched release build reproduces five same Sandpile assertions; its sixth case fails earlier at chat-title assertion. No repair/design change included. |
| Desktop scoped Rust tests | 120 / 120 runtime-task/authority/recovery tests and 35 / 35 managed-publication tests pass. Seven additional storage-boundary tests cover the final read-bound repairs. |
| Protocol, MCP, ACP | 81 protocol tests, 13 MCP operation tests and 47 runner/private delivery tests pass; three private-frame tests also pass. |
| Desktop full Rust suite | Earlier integrated batch: 2,616 passed, 18 ignored, two native-runtime probe timeout failures. The unchanged probe module passes all three bounded-command tests when run serially. A full untouched-release Rust reproduction is not established; do not claim the entire suite green. |
| Clippy | Desktop library and ACP library pass with `-D warnings`. |
| Scoped formatting / whitespace | All 51 changed/new Rust files and seven changed TS/TSX/spec files pass scoped formatting; `git diff --check` passes. |
| Full `just ci` | Stops at workspace formatting in untouched `buzz-db` files. Exact beta.13 reproduces those formatting hunks. Full CI is not green and no unrelated formatting sweep is included. |
| Candidate entrypoint | 14 / 14 fixture checks, Bash syntax, ShellCheck and isolated config contract pass. Requires a clean feature checkpoint; builds six real ARM64 sidecars in dedicated storage, then signs/verifies a separate app. No placeholders are accepted for packaging. |
| Native packaging | Initial clean `c2d7aef85` checkpoint built successfully with six real ARM64 helpers; source/isolation receipt, helper hashes and Developer ID signature verified. Not launched or installed. Rebuild from the subsequent storage-hardening checkpoint before native acceptance. |
| Final storage read bounds | Receipt scan counts all entries, including ignored/failed entries, caps work at 40,000 entries and checks a two-second cooperative deadline. Exhaustion rejects the whole selection, not a partial newest set. Delivery-store reads check opened-handle metadata and consume at most 2 MiB plus one sentinel byte before validation. Boundary, growth and failed-read fixtures pass. |
| Receipt-cache microbenchmark | Same outputs on exact baseline/candidate fixtures. Median batch-mean cost at 512 receipts: 15.315 vs 24.740 microseconds (+9.426 microseconds). This is a pure cache update, not native CPU, fsync or provider latency. Native measurements remain pending. |

Owned source spans `crates/buzz-acp` task runner/private cognition, the narrow
`luca-protocol` delivery contract, MCP delegation operations, and the desktop's
existing native tasks, target lookup, authority, publication and recovery seams.
UI changes are limited to `desktop/src/features/capabilities/**`, its existing
Tauri task API and task-card E2E spec. New modules under
`desktop/src-tauri/src/luca/runtime_tasks/` keep identity, event framing, worker
lifecycle and result delivery separate. The candidate script/config/fixtures
are isolated opt-in tooling, not release configuration.

Bounded V1 limitations:

- Externally owned `SendMessage` is exact-session acknowledged input delivery,
  not a trusted progress/completion/result-return/cancellation channel. The UI
  retains an unresolved native handoff rather than manufacturing completion.
- Graceful stop/shutdown reaps only owned work. Hard SIGKILL cannot prove child
  tree cleanup; native work may survive and recovery is `Interrupted`, never
  auto-redispatched. A tiny authority-before-receipt crash window can leave a
  non-projected `AwaitingResult` authority; it cannot publish without proof.
- Deferred startup outbox reconciliation retains and retries the exact frozen
  bytes. Prior-epoch orphan cleanup after a later terminal reconciliation may
  wait until the next companion restart; it does not trigger resynthesis or
  duplicate publication.
- Claude quota pauses that native gate. It is not evidence of unsupported
  same-ID continuation. No complete D0-D6/Claude certification is claimed.
- Filesystem scan deadlines are cooperative checks between OS operations,
  not preemptive wall-clock guarantees. The catalogue's outer three-second
  host budget does not interrupt an already-running filesystem operation.

Next: freeze/push the storage-hardening checkpoint, rebuild and open the isolated
candidate, verify its identity/signatures/data scope, collect native idle
metrics, and exercise applicable owned-task completion/recovery cases only in
disposable fixtures within the remaining native proof budget. Keep failed or
unavailable gates explicit in the candidate handoff.

Completion means the approved delegation cases work through verified native
controls, required tests/evidence are recorded, and Riley can review an isolated
candidate. It does not mean merged, installed, notarized, released, or publicly
available. Any unsupported core case remains explicitly incomplete until Riley
approves a changed scope.
