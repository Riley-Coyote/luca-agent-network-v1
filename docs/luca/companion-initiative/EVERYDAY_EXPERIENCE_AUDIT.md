# Everyday experience audit — 2026-10-12, performance follow-up 2026-10-13

## Scope and evidence boundary

Improve the existing companion desktop app before the next update. Prioritize
ordinary interactions, truthful status, recovery, and bounded background work.
Do not fold in the separate visual exploration or rebuild harness interfaces.

Audited source: `codex/companion-initiative-2026-10-07`, starting at
`d1a9ef0ec2d49a6a6799fd53469cdd2e6b3c43c4`. The running October 11 candidate
has that source receipt. This audit's fixes are newer working-tree changes;
the running native binary has **not** received them. The shipping branch,
installed app, public downloads, updater, owner data and permissions are unchanged.

Evidence includes current source, the native candidate's UI and operational log,
production React components with synthetic IPC in the browser, and focused
tests. A browser fixture is not proof of real harness behavior or permission
acceptance. Performance on this busy development Mac is not a customer baseline.

## Ranked top ten

| Priority | Improvement | Evidence and confidence | Disposition |
| --- | --- | --- | --- |
| 1 | Prove the complete first useful companion exchange | **Release verification gap.** The prior candidate receipt explicitly leaves real one-approval following, live activity reaching Luca, screenshot understanding, and pause/restart for the owner walkthrough. These are the product promise, not optional polish. | Run one short real-harness walkthrough; fix any failure before publication. Do not automatically grant personal-source access to make it pass. |
| 2 | Stop background refresh failure storms | **Confirmed.** The current operational log contained 1,302 failed refresh attempts between October 11 05:08 and October 12 04:56 UTC. The watcher had an unbounded event channel, no failure backoff, and no maximum debounce delay. Existing logs omit the failing stage, so the underlying source failure is not yet diagnosed. | Implemented bounded wake-ups, per-source coalescing/backoff, a maximum debounce delay, and privacy-safe stage diagnostics. Preserve the last verified index and all existing authority checks. Native post-build observation is still required. |
| 3 | Make delegation dependable in the intended existing session | **Important capability to preserve, not a newly discovered defect.** Existing task-card tests cover exact native references, continuation vs. new tasks, missed events, rejected Stop and summary delivery. `useRuntimeTasks` subscribes before backfill and merges revisions rather than blindly replacing state. | Recheck a real existing-session continuation on each available harness before shipping; record unavailable harnesses honestly. Never convert a failed continuation into a new task or different project. |
| 4 | Protect the everyday composer path | **Focused checks passed; no confirmed new send defect.** Serial tests verified attachment receipt, Enter-send and retained drafts. Plain send also delivered, but its obsolete self-name assertion needed correction to match `resolveUserLabel`. Initial broad-run timeouts remain inconclusive. | Keep concrete delivery and ownership assertions. Recheck on the final build; do not change delivery code merely to appease a stale test. |
| 5 | Keep typing and conversation switching responsive during work | **A repeated-layout hotspot was isolated on October 13.** Each rounded surface measured layout and immediately wrote its clip path, forcing subsequent surfaces to lay out again during a switch. Host load also materially changes absolute timings. | Batch surface measurements before clip-path writes in one animation frame. Normal-speed typing, streaming and the current inline 68-reply conversation now complete with exact text assertions. Native timings remain unverified. |
| 6 | Handle hidden-window navigation without false errors | **Confirmed.** The native log records an unhandled `InvalidStateError` when a view transition is skipped because the document is hidden. The existing wrapper only handled `AbortError`. | Fixed the expected hidden-window case while still awaiting the actual route update and propagating real update failures. No global error suppression. |
| 7 | Finish keyboard and screen-reader behavior in Agents | **Confirmed in the browser.** ArrowRight on the selected All tab did nothing. The search field had a detached screen-reader-only text span instead of an associated label. | Added the label, arrow/Home/End navigation, roving tab stops and named result panels. Geometry, colors and typography are unchanged. |
| 8 | Make companion health understandable at a glance | **UX proposal, not an unimplemented backend claim.** Manual settings now have a direct Agents entry. The review distinguishes permission choices from actual operation, but users still need to connect “chosen,” “paused,” runtime availability and activity freshness. | In the existing lab, explore one compact status summary with the last useful observation and a specific next action when paused/unavailable. Derive it from actual state; do not add another competing settings surface. |
| 9 | Reduce navigation duplication without losing context | **UX proposal.** The inspected Agents screen shows both the global resident list and a second agent roster beside the detail pane. That consumes width and duplicates choices, although it does provide filtering. | Mock a focused alternative in the current production-component lab. Preserve one-click access, selected context, search and keyboard use. No rail overhaul is included in this fix batch. |
| 10 | Recover correctly from outdated agent links | **Confirmed in browser and source.** An unavailable selected agent showed “No residents yet” while three agents remained in the roster. Below the agent pane's compact breakpoint, the same stale selection also hid the roster. | Fix the incorrect empty state and keep the compact roster available. Do not silently switch an action to a different resident. Broader error recovery should remain local to the failed operation. |

## Implemented first batch

### Connected Brain refresh scheduling

- One pending entry per changed source, plus a one-slot wake-up channel; event
  bursts do not accumulate an allocation per filesystem event.
- A quiet burst settles for 750 ms. Continuous writing cannot postpone a ready,
  healthy source indefinitely: the debounce deadline caps at five seconds.
- Failures back off for 30, 60, 120, 240, then at most 300 seconds. A new change
  is required; a failure alone never creates an autonomous retry loop.
- A failing source does not impose its backoff on healthy sources. Changes that
  arrive during indexing are retained. Disconnect clears pending retry state.
- Read/access notifications are ignored. Incremental index reuse, manual refresh,
  persisted authority and source selection behavior are unchanged.
- Failure diagnostics identify only a fixed operation stage, not source paths,
  file bodies, credentials or arbitrary provider errors.

This bounds the retry behavior. It does **not** claim that the currently failing
source has been repaired; the old log did not expose enough information to tell.
Brain remains optional and separate from companion harness following.

### Navigation

Treat the native hidden-document `InvalidStateError` as an expected skipped
animation only when the document was hidden. Await `updateCallbackDone` so a
real routing failure still surfaces. Preserve the native transition object and
all router callbacks. Visible-document readiness failures still propagate.

### Agents accessibility

Associate the search label with its input, support Left/Right/Home/End on filters,
keep only the selected filter in the Tab sequence, and label the current result
panel. Tab then moves into the resident list rather than visiting every filter.

### Outdated agent selection

When an agent link no longer resolves, keep the remaining roster visible at
compact widths and explain that the selected agent is unavailable on desktop.
Only a genuinely empty library says “No residents yet.” Selecting another agent
remains an explicit owner action; no runtime, permission or message is changed.
The visual review also found that compact mode retained a desktop-width roster
inside a wider single pane. The roster now fills that pane; the two-pane layout
and other roster consumers retain their existing sizing.

## Verification record

Working evidence directory: `/private/tmp/polyphonic-everyday-qa.PnZFVc`.

- Navigation regressions: 18 tests passed, including real callback failure
  propagation, hidden at start, and becoming hidden during navigation.
- Refresh scheduler: nine deterministic Rust tests passed through a standalone
  module harness. This does not replace compiling the native integration.
- Initial 120-test browser selection was stopped after repeated timeouts:
  14 passed, 16 failed, one interrupted, 89 not run. Treat this as an inconclusive
  broad run, not a green gate or a list of confirmed product bugs.
- The approved halo completion test passed in an isolated serial rerun.
- Native `cargo check --manifest-path desktop/src-tauri/Cargo.toml --lib` passed
  with existing warnings; no native release build or installation was performed.
- The final optimized frontend build (`build:e2e`) and its TypeScript check
  passed for all four fixes. Existing chunk-size/dynamic-import warnings remain.
- Scoped Biome passed for all seven changed JavaScript/TypeScript/TSX files;
  Rust formatting and `git diff --check` passed.
- Thirteen focused browser checks produced 12 passes and one stale assertion:
  sending succeeded, but the old test expected `npub1mock...` instead of `You`.
  `resolveUserLabel` explicitly defines the self-label as `You`; the test now
  verifies that accessible author label and the self-authored message marker.
  This changes no delivery code and is not a weakened delivery assertion.
- The final focused serial run passed **15/15**: file attachment delivery,
  companion-settings keyboard/focus behavior, agent search/filter keyboard
  behavior, stale selection recovery at 800/1440 px, Library closing at
  800/1024/1440 px, the approved halo lifecycle, runtime-check failure feedback,
  exact-target native follow-up, saved-session continuation, plain send,
  Enter-send, and draft retention across channel switches.
- Screenshot review covered keyboard focus and both stale-selection widths.
  It caught the compact roster's unused strip, prompting a small responsive fix
  and an explicit width assertion. The final rebuild passed, then all four
  affected Agents/companion-settings checks passed again. The assertion compares
  the usable card width, preserving its intentional border and outer floor lip.
- The rebuilt browser preview also showed the corrected unavailable-selection
  state with no captured warning/error console entries in that inspection.
- Evidence logs: `build-responsive.log`, `native-check.log`,
  `navigation-final.log`, `refresh-queue.log`, `focused-verified.log`,
  `responsive-complete.log`, `perf-normal.log`, and `performance.log`.
  The `responsive-complete/` results contain the final 800/1440 px screenshots.

## October 12 performance baseline and limits

The optimized E2E bundle was served locally without a concurrent build during
measurement. Synthetic IPC exercised the production components; no real model
calls were timed. These numbers are a diagnostic baseline, **not a speed-up claim,
a native WebKit benchmark, or a customer performance guarantee**.

| Browser scenario | CPU throttle | Median event duration | 95th percentile |
| --- | --- | --- | --- |
| Quiet composer | None | 120 ms | 232 ms |
| Eight agents typing, plus live messages | None | 112 ms | 224 ms |
| Quiet composer, separate stress run | 4x | 112 ms | 240 ms |
| Three streaming 150-line replies, updated every 120 ms each | 4x | 288 ms | 560 ms |

The typing observer samples `input` and `keydown` entries taking at least 16 ms.
It can record more than one event for a keystroke; these are not all-keystroke
percentiles or an INP score. The normal-speed quiet/busy test passed, including
exact text assertions after typing. The overlapping normal-speed and throttled
results show that host contention prevents a clean CPU-scaling comparison.

The warm-switch stress test completed: median wall time was 1,825 ms for its
plain-text scenario and 3,790 ms for 60 markdown-heavy messages. The longer typing
stress test measured five scenarios, then timed out locating an old thread root.
The initial hypothesis was a fixture/virtualization setup issue. October 13
inspection also confirmed that the benchmark expected the retired separate thread
panel, while the actual app opens replies inline. That old full stress run was
**not green**; the corrected current-flow run is recorded below.

Next measurements should use a quiet host, an unthrottled native interaction
trace, and a repeatable browser CPU profile. Do not close Riley's other apps
without permission. Prioritize typing/streaming, then warm conversation switching;
defer broad bundle surgery until traces identify relevant work.

## October 13 performance and interaction pass

### Change and visual review

| Before | After | Why |
| --- | --- | --- |
| Each smoothed code block/control read layout and wrote its clip path before the next surface measured. | One document-local frame gathers all measurements, then applies all clip paths. Duplicate work is coalesced; unmount cancels pending work. | Remove repeated forced layouts without changing corner geometry, typography, spacing or visual identity. |
| The Agents filter row had no arrow-key behavior or associated search label. | Associated search label, roving tab stops, Left/Right/Home/End navigation and named results. | The same quiet visual layout now works with keyboard and assistive technology. |
| An obsolete agent link could say there were no agents and hide the compact roster. | A truthful unavailable-selection state leaves the roster reachable at both compact and wide sizes. | Recovery stays in context and never silently redirects an action to another agent. |

The shell lab was regenerated from this exact checkout and visually inspected,
including the production conversation, Agents roster, keyboard filters and
Companion settings entry. It is a synthetic browser fixture, not native glass or
live harness proof. The separate visual exploration was not merged or changed.

The profiler attributed substantial main-thread samples to `getLayoutSize` during
switches. The new scheduler has explicit read-before-write, deduplication,
cancellation and next-frame tests. Existing geometry tests remain unchanged.
The editor already avoids rerendering on every Tiptap transaction and debounces
draft persistence, so neither was rewritten without evidence.

### Current measurements

Optimized E2E build; one Chromium worker; normal CPU speed; profiling off for
the following final typing run. Each burst asserts the full typed text.

| Scenario | Median sampled event duration | 95th percentile |
| --- | --- | --- |
| Quiet conversation | 24 ms | 32 ms |
| Eight agents typing plus live messages | 24 ms | 32 ms |
| Six-agent observer storm | 24 ms | 32 ms |
| Observer storm, typing and live messages | 24 ms | 40 ms |
| Three concurrent long streaming replies | 32 ms | 40 ms |
| Inline 68-reply conversation, quiet | 48 ms | 72 ms |
| Inline 68-reply conversation with live replies/edits | 64 ms | 80 ms |

Warm switching after the batching change measured 161–173 ms median for plain
conversations and 292–296 ms for markdown-heavy conversations in two runs.
Earlier same-day diagnostic runs measured 207–238 ms and about 365 ms,
respectively, but those used CPU profiling and host load varied. The measurements
are encouraging, **not a controlled percentage-speedup claim**. Do not compare
October 12's busy-host/throttled numbers directly to these as a product gain.
Another concurrent-streaming run reached a 200 ms p95, so worst-case native
responsiveness still needs observation; the fastest sample is not a guarantee.

Event Timing samples only `input`/`keydown` durations at least 16 ms and may
include multiple entries per keystroke. These are not all-keystroke percentiles
or an INP score. No native IPC or model response latency was measured.

### Verification and evidence

- Typecheck, the optimized E2E build and scoped Biome checks passed.
- 24 unit tests passed for navigation lifecycle, corner geometry and scheduling.
- The full seven-scenario typing benchmark passed. The fixture now uses the
  production inline reply flow and seeds it separately from the stress transcript.
- Warm switches still perform zero fresh markdown parses after cache warm-up.
- Focused browser checks cover delivery, retained drafts, autofocus, long code
  paste, table/link overflow, scroll anchoring, composer expansion, loading/error
  recovery and 800/1440 px unavailable-agent layouts. All 23 unique selected
  cases passed across the original run and the corrected-fixture rerun (five
  passing cases, including the four that initially failed and one repeated).
- Old tooltip selectors were updated to the actual Add menu and Formatting
  menu item. Reply autofocus now asserts the inline target and main composer;
  it no longer demands the retired split drawer. No production UI was changed
  to accommodate stale tests.
- Source diff checks pass. The generated self-contained shell lab contains
  vendored multiline JavaScript string whitespace; it is excluded from that
  whitespace check, not manually rewritten.
- Evidence: `/private/tmp/polyphonic-perf-profile-2026-10-13/`,
  `/private/tmp/polyphonic-perf-current-threads-2026-10-13.log`,
  `/private/tmp/polyphonic-perf-verified-2026-10-13.log`,
  `/private/tmp/polyphonic-polish-regressions-2026-10-13.log` and
  `/private/tmp/polyphonic-polish-final-2026-10-13.log`.

### October 13 native candidate gate

The native build preflight refuses to proceed with only about 12–13 GiB available
on the SSD (20 GiB reserve). No native build was started, the reserve was not
lowered, and no active cache, personal profile, installed app or external-drive
working set was moved or removed. Free about 10 GiB before building the private
candidate. The October 11 app still contains the earlier source receipt; it is
**not** the updated candidate and must not be presented as one.

### October 14 candidate preparation

Riley authorized preparing the updated private candidate, with publication still
blocked on their walkthrough. The internal-storage preflight now reports about
48 GiB available, above the unchanged 20 GiB reserve. Incremental snapshots remain
disabled and the existing internal compile cache will be reused. No installed
app, previous candidate, profile or external-drive working set is being removed.

Before freezing this source checkpoint, TypeScript, all 24 focused navigation
and corner tests, scoped Biome for 14 changed files, and source whitespace checks
passed again. The native build, signature, copied-bundle receipt and launch
checks must be recorded with the dated candidate; this source checkpoint alone
does not establish native acceptance or permission to publish.

## Release boundary

No release tag, remote push, update-feed change or installation replacement is
authorized by this audit. After the fixed candidate passes focused checks, Riley
still needs the native walkthrough. Broader design changes require a reviewed lab
direction. Social connectors, iMessage and agent teams remain out of scope.

## Next focused sequence

1. Restore SSD headroom, finish the clean source checkpoint and build a private
   candidate with the existing isolation/signing/receipt script. Do not publish.
2. Verify typing, rapid conversation switching and draft retention in that
   native candidate. Observe the new
   fixed-stage Brain diagnostic and retry spacing; repair the failing source
   cause if it is an app defect rather than a revoked/unavailable source.
3. Run the owner-approved first-use walkthrough: ask Luca to follow a harness,
   approve once, see a real activity update, attach a screenshot, continue an
   existing harness session, then verify pause and restart. Record any unavailable
   harness separately from a passing result.
4. Prototype the companion health summary and navigation simplification in the
   current lab for Riley's review. Do not merge the separate design exploration
   or publish an update merely because these focused checks are green.
