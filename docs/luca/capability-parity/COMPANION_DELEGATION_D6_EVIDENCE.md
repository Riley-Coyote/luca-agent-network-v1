# D6 native and performance evidence

Recorded 2026-10-06. This supplements the implementation specification; it
does not authorize a merge, installed-app replacement, public release, or
controls over externally owned native work beyond the approved phased boundary.

## Native executable correction

The first signed `c6fd4fa27` conversation attempt failed with the configured
`gpt-6.1-sol` model. Desktop discovery selected Codex `0.160.1` from the current
ChatGPT app, but the ACP adapter actually spawned its nested Codex `0.153.4`.
This was not evidence that the current account lacked model access.

The supported adapter override is `CODEX_PATH`. Source `a605916b0` pins the
discovered native executable for resident launches, model discovery, and new
owned tasks; Claude uses its supported `CLAUDE_CODE_EXECUTABLE` override through
the same discovery boundary. Missing native resolution fails rather than
silently using the adapter's bundled dependency. No global profile, model,
provider, credentials, dependency, or account configuration was changed.

With the current executable and the same model, one disposable native Codex
turn returned the exact `PP_D2_CURRENT_CLI_6e21` marker, using session
`01a1117d-67b1-7f30-a553-38ac98554e27`. The signed candidate's observed process
tree now contains that current application-bundled native executable instead
of the nested dependency. Native launch and model-route fixtures, formatting,
and desktop Clippy with warnings denied pass.

## Signed app question and result loop

Signed artifact source: `a605916b08a462d84033683b388f4b45b9dfdfeb`.
Separate app identity: `chat.polyphonic.desktop.companion-delegation.dev`.
Launch PID was `42749`; the exact-PID/start-time entrypoint verified the source,
six real ARM64 helpers, isolation receipt, and Developer ID strict/deep
signatures before launch. The installed Polyphonic app was not replaced.

Through the actual native UI, Luca proposed one new Claude Code task. The
owner confirmation was changed to the exact disposable folder
`/Users/rileycoyote/Documents/Codex/2026-10-04/polyphonic-d1-exact-session-fixture-20261004`
before Run. Runtime stayed Claude Code; permissions stayed Ask when needed.

- Task: `6502abd4-81f0-4216-9c6d-948254d78271`.
- Provider session: `119e2b67-6660-4982-9f06-21801c2b13eb`.
- Real native AskUserQuestion appeared in Polyphonic: “Which acceptance route?”
  with Alpha/Beta options. Beta was selected and sent through the native UI.
- The question disappeared, the worker succeeded, and Review task result showed
  exactly `POLYPHONIC_D6_CLAUDE_ANSWER_BETA_83cd`.
- Retained raw result is exactly 37 bytes, SHA-256
  `d3c9ec8858505d3472e09e787674992ad1b0a026b8e902b3c0cedf821e9f155b`.
- One synthesis attempt published one signed Luca summary in the initiating
  conversation `65385070-dd5d-493c-a1e1-e8a814b7f377`. Submitted and published
  event IDs agree: `92d800e996dcabe0ab377af42d8abc77a1b1027e51b87390723f0831143c71e8`.
- Question answers were not tool approvals. No unrelated process/session,
  personal project, or native configuration was a test target.

Actual-size native screenshots and accessibility state were inspected. Older
model-error messages remain historical conversation content, not output from
this corrected launch.

Fresh saved-Claude continuation, native Stop, and this loop's restart inspection
are still pending at this evidence checkpoint. The first saved-session lookup
at limit 50 returned an invalid broker response; no native task was dispatched.
Earlier production component
proofs and deterministic coverage are separately identified in the D1 evidence
and implementation specification.

## Native broker transport correction

The native lookup exposed an existing Darwin socket behavior: accepted sockets
inherit the nonblocking flag of the listener. The repository broker configured
timeouts but never cleared that flag on the accepted stream. Large responses
could write only a prefix and then fail with WouldBlock, while small proposal
receipts appeared to work. A standalone local-only socket probe on this Mac
observed immediate WouldBlock from both read and large-response write despite
a configured timeout; no provider profile or private native endpoint was used.

The request worker now explicitly uses a bounded blocking accepted stream;
the listener remains nonblocking. Both read/write deadlines remain five seconds,
and the shorter caller-disconnection probe remains bounded and cancellation-safe.
Diagnostics log only a static error category/byte count, never frame content,
capabilities, paths or answers. Ten broker tests pass, including a fragmented
request plus a 128-KiB-plus complete reply and an exact disconnected-caller test.
The corrected signed-app saved-session acceptance is pending the rebuild.

## Performance evidence boundaries

Matched fake-provider host comparison:
`/Volumes/LaCie/Luca-Development/build/companion-overhead-Wt3fbs/comparison.json`.
Exact shipped beta.13 source `f84aaafa53386f213b832441983838b23c32c745` versus
candidate `c6fd4fa27`, matching executable hashes, same machine and debug
toolchain, 10 alternating runs per lane plus recorded warmups, concurrency one.
The shared fake provider schedules 160 ms of work; it uses no account/model.

| Metric, median / small-sample p95 | Baseline | Candidate |
|---|---:|---:|
| Net host overhead, ms | 69.60 / 553.14 | 72.45 / 193.06 |
| Progress pipe delay, ms | 0 / 88 | 0 / 24 |
| Completion to host result, ms | 0.5 / 344 | 2 / 23 |
| Full runner exit, ms | 233.58 / 839.18 | 235.05 / 355.12 |
| Sampled aggregate RSS, KiB | 62,184 / 62,544 | 62,296 / 62,640 |

Median net overhead differs by 2.85 ms, sampled median RSS by 112 KiB. Two
processes were sampled per lane. CPU is a sampled lifetime-average proxy,
not an interval idle measurement. These data do not cover Tauri IPC, GUI,
catalogue reads, provider latency, or private synthesis.

Native fresh-profile ABBA comparison:
`/Volumes/LaCie/Luca-Development/build/delegation-native-idle-9x4184/comparison.json`.
Both app identities were Developer-ID verified and launched with fresh isolated
first-run profiles, no onboarding action or provider prompt. Native profile/auth
variables remained unchanged. Each app settled for 20 seconds and then received
a 10-second sample. Separately-parented WebKit/XPC processes are excluded.
The first pair still had startup/probe activity (not settled idle). The second
pair had one persistent app process and zero measured CPU-time advance in both
lanes; sampled main RSS was candidate 134,144 KiB versus baseline 214,512 KiB.
This is first-run debug idle, not warmed conversation or optimized release
certification. Unrelated user apps stayed running; load was recorded.

The first native measurement directory `delegation-native-idle-AxdyQ4` is an
incomplete diagnostic: the screenshot service relaunched only the isolated
baseline after the timed process exited, invalidating the last sample. That
exact baseline PID was stopped; no installed/personal app was signalled. The
successful repeat did not perform UI inspection during timed app lifetimes.

Matched browser snapshots and corrected common fixture receipts:
`/Volumes/LaCie/Luca-Development/build/delegation-browser-perf-kVp4OTc6`.
Both snapshots are served from the same volume, explicit owned ports, identical
Chromium/viewport, serial ABBA, no stale server reuse. Old performance tests
depended on a retired resident mote and split-thread surface; test-only repairs
use current readiness and focused-thread semantics without changing budgets or
product design. The warm-DM readiness repair passes. The attempted long-thread
repair did not pass the full scenario and was undone, not committed as a fix.

Original full-suite ABBA was 12 passed / 8 failed: the project navigation budget
fails both versions, and the 68-reply setup is unavailable. Within that protocol,
candidate quiet typing had a +28-ms median run-mean difference and +124-ms p95
difference. The generic old mock lacked successful task/input list responses;
machine load was high and free memory fell. These are confounds, not a proven
explanation or permission to discard the recorded difference.

A distinct successful-empty-list quiet ABBA supplied the same three API defaults
to both immutable snapshots and waited for native-listener/list setup to settle.
All four controls passed: baseline/candidate medians were both 32/24 ms, p95
run-mean difference was 4 ms (8-ms measurement quantization). Each burst had
exactly 173 DOM mutations, with zero list/listener/refetch/focus/visibility
events. Direct quiet-only follow-ups were likewise fast. No sustained input-loop
regression was reproduced, and no speculative product optimization was made.
The original whole-suite signal remains disclosed; the full performance suite
is not declared green. Reports are `summary.json` and
`empty-control-summary.json` in that comparison directory. Owned preview servers
were stopped without touching user apps or native profiles.

## Full-suite disclosure

Frontend helpers and focused activity/task/input UI checks passed on fresh E2E
assets. Full ACP library tests passed serially (992 passed, two explicit native
tests ignored), and the last three parallel runs were green. Two earlier
parallel runs failed while spawning an older fake child, before its privacy
assertions. The cause is not established; neither that flake nor the earlier
six config failures is labelled pre-existing without reproduction. Untouched
beta.13 passed its ACP library suite (899 passed, two ignored).

Full `just ci` is not green: unmodified shipped `buzz-db` formatting fails the
global formatter. Scoped checks do not erase that baseline gate failure.
