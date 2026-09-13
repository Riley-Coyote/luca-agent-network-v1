# Agent experience hardening

Starting source: `1e0143292`; installed Dev code: `9f4e68e81`.
Working branch: `codex/agent-experience-hardening`.

## Purpose

Make existing agent work reliable, understandable, and responsive. Preserve
native runtime ownership and the approved UI. No new agent harness, browser
manager, Computer drawer, dependency upgrades, or beta release.

## Ordered work

1. Lifecycle reliability: inspect existing coverage for Stop, runtime failure,
   app quit, and idle session retirement. Run only uncovered representative
   live cases. Confirm test-owned browsers/helpers terminate without touching
   personal browsers or unrelated tasks. Patch concrete failures only.
2. Realistic workload: one bounded three-resident review of mnemos.chat (home
   and at most one linked page; no writes, installs, or delegation). Measure
   process ownership, CPU, approximate memory, and return to idle. While work
   streams, sample composer typing, conversation changes, Quick Chat, and a
   drawer. Distinguish website cost from runtime and app overhead.
3. UX corrections: prioritize broken or misleading states, then noticeable
   interaction latency, then minor polish. Reuse the existing activity and
   permission surfaces. Name actual actions and waiting/error states without
   exposing raw tool identifiers. Do not invent automatic retries for actions
   whose completion is uncertain.

## Ownership and efficiency

- Integrator: decisions, current-state verification, live app work, plan and
  evidence, shared integration, final review/install.
- Sol: initial read-only cleanup audit. Assign exact files for any subsequent
  implementation before edits; no overlap, independent builds, or branch merges.
- Add a second bounded worker only for an independent, proven UI issue.
- Reuse completed isolation/history evidence. No broad acceptance reruns.
- Each observed issue gets a short reproduction, owning layer, smallest fix,
  and focused check. No speculative optimization backlog implemented now.
- Stop testing a path once relevant evidence passes unless code or a new
  failure invalidates it. Perform one final native build if changed components
  require it; preserve rollback and Dev identity.

## Completion criteria

Stop/failure/quit behavior is understood and representative uncovered paths
verified; no test-owned orphan helpers remain; the realistic task completes or
reports an actionable limitation; normal interactions remain usable during
streaming. Any corrected UX is inspected in the installed app. Report actual
measurements and remaining limits rather than a blanket performance guarantee.

Beta publishing, version changes, signing/notarization for distribution, and
replacement of the installed beta remain outside this pass.

## Status

- Baseline source and installed receipt verified; working tree initially clean.
- Prior three-agent local fixture already passed isolation, input, and explicit
  browser closure. It does not establish heavy-site or interrupted cleanup.
- Lifecycle audit complete. Conversation Stop escalates through resident restart;
  ordinary completed sessions are intentionally cached. Runtime failure discards
  poisoned workers; app quit performs the same-instance orphan sweep.
- Live Stop all: three browsers active; 21 Chrome processes sampled. Eight seconds
  after Stop, all original Chrome PIDs and their three process groups were gone.
  Stopped records persisted after restart. Fable raced completion/cancellation;
  this proves cleanup, not instantaneous cancellation of every tool call.
- One real concurrent mnemos.chat review: Opus completed in 68 seconds (14 steps),
  Sol in 86 seconds (13 steps), both reported browser closure and returned actual
  site observations. Fable was stopped at 3m41s (13 steps) to bound the exercise.
  No profile-lock errors were observed. This is a partial workload pass, not a
  three-resident successful completion claim.
- Four-minute process sample: peak 24 Chrome processes, 3041 MiB summed RSS,
  264% summed CPU (100% is one core). Chrome count returned to zero. ACP peak
  combined CPU was 0.5%; eight resident harnesses total used about 111 MiB RSS.
  Summed RSS is not physical memory and may double-count shared pages. This was
  not an isolated benchmark: the installed beta and a cached ACP build also ran.
- Native Dev CPU also spiked (sampled peak 158%; separate spot sample about 189%).
  A native stack sample attributed work to connected Brain snapshot validation
  and age/scrypt encrypted outbox persistence, while the native main thread was
  waiting. A later spot check fell to 9%; sustained return-to-idle is not proven.
  Existing Brain filtering/coalescing already limits common build churn. No
  integrity validation or durable encryption was bypassed to reduce CPU.
- Concrete UX fix committed as `4689a7a55`: namespaced browser navigation, typing,
  snapshot, waiting, and close actions have readable labels. Navigation exposes
  only a sanitized domain; other inputs are excluded. Runtime-written prose wins.
  Shared-room command redaction remains unchanged. Other tool names are outside
  this narrow correction.
- Verification: 39 managed-presentation tests passed; scoped Rust formatting and
  diff checks passed; cached ACP build passed. No frontend changes or broad suites.
- Installed Dev received only the rebuilt ACP helper, preserving bundle/keyring
  identity; codesign deep/strict verification passed. Full app rollback remains
  in `Luca Dev Rollbacks/browser-isolation-2026-09-13`; immediate previous helper
  and receipt are in `Luca Dev Rollbacks/agent-experience-2026-09-13`.
- Quit check: original Dev and all three real-task Chrome root PIDs disappeared;
  no Dev harness or Chrome crash helper remained. Reopened installed Dev and
  confirmed persisted task outcomes through accessibility. Fixture and sampler
  stopped. Installed beta was not modified.

## Follow-up acceptance completed

- Native control failure was reproduced after restarting Codex's control helper.
  Moving Dev through its Window menu to the built-in Retina display restored
  coordinate clicks, text entry, and current-frame capture. This isolates a
  display/window-targeting limitation; it is not evidence of a Dev input bug.
- On the installed helper revision `4689a7a55`, normal composer typing and
  conversation drawer open/close worked during Sol's active browser task.
  The unsent conversation draft survived drawer and Quick Chat interaction.
- Quick Chat opened with composer focus; its separate draft survived minimize
  and reopen. Both diagnostic drafts were cleared without sending them.
- Sol completed the local browser check in 54 seconds and closed the browser.
  His runtime wrapped the calls as generic command steps, so this could not
  verify the browser-specific presentation mapping.
- One direct Opus check completed in 35 seconds. The installed app visibly
  showed Closing the browser while active. Expanded saved history showed:
  Opening a page; Reading the page; Typing in the browser; Reading the page;
  Waiting in the browser; Closing the browser. Tool discovery remains ToolSearch.
  The local URL used the safe fallback label rather than exposing its query.
- Final process check found no Chrome browser roots. The fixture was stopped.
  No new native build or broad test rerun was needed for this acceptance.

## Remaining limits

- Codex wrapper calls may still appear as Running a command / Guardian Review;
  extracting nested tool activity is outside this narrow label fix.
- This was qualitative interaction acceptance, not a frame-time benchmark.
  The earlier three-resident workload remains a partial completion pass because
  Fable was stopped. No blanket claim of performance optimization is made.
- If perceived lag remains, profile Dev without a concurrent build and with
  timestamps for Brain refresh/outbox writes before assigning any optimization.
  Keep the native runtime and cryptographic/durability boundaries intact.
- Beta publishing and the parked Computer drawer remain out of scope.
