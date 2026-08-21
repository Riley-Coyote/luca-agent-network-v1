# Milestones and Gates

The artifact milestone namespace is `MA*`; gate namespace is `GA*`; task
namespace is `A*`. These are local to this packet and are not silently inserted
into `.codex/luca-v1/TASK_GRAPH.yaml`.

## External activation gate

Implementation requires either:

- formal current G1 PASS, or
- an explicit Riley priority override recorded by the implementing session.

The override changes ordering, not security, identity, data-loss, or authority
requirements.

## MA0 — Source reconciliation and contract freeze

**Outcome:** the packet is reconciled with the active branch; public types,
bounds, sandbox fixture, route ownership, broker seam, and synthetic fixtures
are frozen.

**Tasks:** `A00`.

**GA0 gate:**

- active commit and dirty-worktree boundaries recorded;
- no overlap with unrelated user work;
- exact owned paths and task mutexes validated;
- packaged WebKit sandbox spike proves fail-closed isolation or HTML Preview is
  explicitly disabled;
- fixture set covers create, update, conflict, restart, identity scope, missing
  source, malicious HTML/SVG, and service absence;
- no implementation begins before the verdict is PASS.

## MA1 — Local artifact substrate

**Outcome:** owner-scoped local artifacts can be imported, versioned, queried,
exported, soft-deleted, restored, and recovered after restart without UI or
agent dependencies.

**Tasks:** `A01`–`A04`.

**GA1 gate:**

- atomic capture and crash-point tests pass;
- content hash and canonical manifest vectors pass;
- idempotent replay and expected-version conflict pass;
- traversal, symlink, MIME mismatch, oversize, identity-scope, and corruption
  tests pass;
- missing source does not break managed snapshot;
- metadata search never loads bodies;
- artifact failure cannot affect messaging state.

## MA2 — Library and static Canvas

**Outcome:** the owner can browse Library and open supported static artifacts in
a shared Canvas from Library or conversation-shaped fixtures.

**Tasks:** `A05`–`A09`.

**GA2 gate:**

- Library route, search, filters, empty/loading/error/large-library states pass;
- existing Channel Canvas is named Room brief in public UI;
- Preview/Source/Versions and revert-as-new-version pass;
- HTML sandbox denial fixture passes in the real packaged/dev Tauri webview;
- unsupported/corrupt/missing-source states retain download/recovery actions;
- zoom, keyboard, focus, reduced-motion, overflow, narrow-layout, and console
  checks pass;
- no HTML executes in Library cards.

## MA3 — Resident artifact bridge and conversation receipts

**Outcome:** a supported managed resident can explicitly create and update an
artifact; Luca shows activity, links the local receipt to the accepted final,
and opens Canvas without altering signed message content.

**Tasks:** `A10`–`A13`.

**GA3 gate:**

- versioned protocol vectors and all broker bounds pass;
- create/update/read/list work for every supported managed runtime or expose an
  honest capability-unavailable state;
- stale epoch, wrong resident/owner/conversation, replay-with-different-bytes,
  and timeout fail closed;
- direct and nested descendants lack artifact broker capability;
- observer and diagnostic captures contain no body or path;
- successful final with failed artifact and successful artifact with failed
  final both remain truthful and recoverable;
- provisional, linked, interrupted, and orphaned receipts render correctly;
- auto-open focus policy and Back/Close behavior pass.

## MA4 — Static artifact candidate

**Outcome:** the standalone HTML v1→v2→revert/relaunch demonstration and the
supported static-kind matrix pass in one real desktop candidate.

**Tasks:** `A14`–`A15`.

**GA4 gate:**

- staged-file reconciliation, retention, quota, and garbage collection pass;
- clean-profile Library and existing-profile upgrade pass;
- one real managed resident completes the acceptance demonstration;
- installed/dev-native app visual inspection covers desktop and narrow layouts;
- relevant upstream messaging, attachment/media, search, activity, permission,
  cancellation, and community-switch regressions pass proportionally;
- artifact/secret/path scan passes;
- no unresolved P0/P1;
- known limits explicitly say Luca owns no application build/runtime process,
  remote/LAN preview, cross-device sync, sharing, or collaborative board.

## MA5 — Agent-neutral live-preview candidate

**Outcome:** Codex, Hermes, and any compatible ACP runtime can use the same
artifact tools; a harness-started loopback app can be attached, recovered, and
detached through Canvas without giving Luca process authority.

**Tasks:** `A16`.

**GA5 gate:**

- static HTML isolation passes in native WebKit with CSP outside
  attacker-controlled markup;
- loopback proxy URL, Host, Origin, redirect, cookie, top-navigation, parent,
  Tauri, HTTP-stream, and WebSocket revocation attacks fail closed;
- Codex and Hermes complete real end-to-end artifact journeys;
- Claude Code and OpenClaw either pass the same capability/isolation checks or
  expose an honest unavailable state;
- an unknown compatible ACP fixture succeeds only after a capability-free
  probe, while an incompatible fixture retries without artifacts and preserves
  conversation behavior;
- live Canvas close/reopen, server loss, recovery, relaunch, and unsent restart
  request pass;
- observer, relay, logs, diagnostics, and retained evidence contain no artifact
  body, source path, URL query, broker capability, or signing material;
- no unresolved P0/P1 remains.

## Estimated effort

| Milestone | Engineer-weeks |
|---|---:|
| MA0 | 0.5–1 |
| MA1 | 1.5–2.5 |
| MA2 | 2–3 |
| MA3 | 2–3 |
| MA4 | 1–2 |
| MA5 | 1.5–3 |
| **Artifact Canvas total** | **8.5–14.5** |

These are engineering-effort ranges, not calendar promises. Shared-path and
security tasks remain dependency-ordered even if other UI work is parallelized.

## Evaluation fixtures

| Fixture | Proves |
|---|---|
| standalone HTML v1/v2/v3 | identity, versions, update, diff, revert |
| Markdown with code and links | safe content rendering |
| large code file | truncation and source/download behavior |
| PNG plus decompression-bomb header | image success and rejection |
| active SVG with scripts/external refs | non-executing image boundary |
| HTML network/parent/Tauri attack page | sandbox and CSP |
| traversal/symlink swap file | working-root confinement |
| duplicate/reordered broker frames | idempotency and binding |
| two simultaneous updates | compare-and-append conflict |
| missing original source | durable managed snapshot |
| crash at each capture point | recovery and no partial committed version |
| successful final with artifact service absent | fail-soft conversation |
| committed artifact with interrupted turn | orphan retention and truthfulness |
| identity/community switch | owner isolation and cache reset |
| 10,000 metadata rows | Library pagination/search responsiveness |

## Definition of done for every task

1. Dependencies and external activation state are recorded.
2. Only owned paths are modified.
3. Focused positive and negative tests pass within the active failure budget.
4. Raw command output and safe receipts are stored under the task's declared
   `evidence/MA*/<task>/` path when implementation begins.
5. Evidence contains no secrets, protected bodies, broker capabilities, or
   absolute local paths.
6. User-visible work is inspected in the real app when available.
7. The final report names what works, what was verified, what is deferred, and
   any source conflict requiring Riley.

## First recommended implementation assignment

`A00` only: reconcile the packet with source reality, freeze fixtures and exact
paths, and return `GA0` PASS/FAIL. Do not begin `A01` in the same task.
