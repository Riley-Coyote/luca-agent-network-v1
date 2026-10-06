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

At that historical checkpoint, saved-Claude continuation, native Stop, and
restart inspection were pending. The first saved-session lookup
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
The subsequent signed-app saved-session acceptance is recorded below.

The rebuilt `3762327b6` native app then successfully listed 50 Claude metadata
candidates without Brain and reached the exact `beec542f` Continue review. The
original canonical folder and native policy were locked; the public native
catalogue confirmed no live controller before Continue. Task
`4ae02ad8-8d91-47e8-8601-73d471d523b6` restored native ID
`beec542f-39b1-40a6-8fcd-9e7cc2eaa439` and its own saved context. The native
transcript contains the exact `POLYPHONIC_D6_CLAUDE_SAVED_43f6 Beta` result,
without Polyphonic replaying the conversation or supplying the old answer.

The desktop correctly rejected that terminal frame because the ACP runner
omitted `providerSessionId` from the result, despite acknowledging it earlier.
It retained a failed receipt and no raw result/successful summary. The following
runner correction carries the actual adapter-acknowledged identity through the
unchanged shutdown/observer-drain fence and repeats it in the result frame.
The strict desktop guard is not weakened. This task is considered executed;
there is no blind repeat. A new, explicitly distinct native proof follows after
the corrected artifact rebuild.

## Native Stop

On signed `3762327b6`, an independent task
`8e04e5e0-790b-45b1-bc28-98e21c67f955`, provider session
`dd6967d1-bf9d-4051-ae6c-393c47329982`, started only after the native Run review
selected the disposable folder above. Its real “Which stop route?” Alpha/Beta
question appeared in Polyphonic. No answer was sent.

Stop task removed the question and transitioned through Stopping to Stopped.
The exact owned worker PID `36717`, adapter group `36788` and every captured
worker descendant exited. Native catalogue shows no remaining fixture
controller. The warm Luca host PID `22054` remained alive; no unrelated session
or installed app was signalled. No raw result exists and summary delivery is
cancelled, not falsely completed. Before/after body-free receipts are retained
as `desktop/output/playwright/d6-stop-before.json` and `d6-stop-after.json`.

## Source verification checkpoint

On `3762327b6`: typecheck, full frontend tests 4,114/4,114, scoped Biome,
production build, native Developer-ID signatures/source receipt, and all 65
focused UI cases pass without retries or skips. Tauri packaging was followed by
a fresh E2E build and the same 65/65 pass on an explicitly owned fresh server,
then that server was stopped. Native broker 10/10, runtime-task 115/115 and
input-registry 10/10 tests pass, with desktop Clippy warnings denied. Evidence
roots are `delegation-final-frontend-Z0VaHRoq` and
`delegation-postpackaging-ui-fb8KXpR6` under the dedicated build directory.

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

## Final same-session return and restart — signed `81ca54bc1`

A distinct proof, not a repeat of the executed `43f6` task, used exact native
session `beec542f-39b1-40a6-8fcd-9e7cc2eaa439`. Task
`c3f05c4a-2320-41ff-b2d9-dd0841bea220` was confirmed in its locked original
folder, with preserved native policy and no live external controller. The
native transcript has exactly one new instruction containing the `9f31` marker;
it matches the requested instruction exactly and does not supply “Beta.”

The worker succeeded, retaining its own saved context. Native Review task result
showed exactly `POLYPHONIC_D6_CLAUDE_SAVED_9f31 Beta`: 36 bytes, SHA-256
`8ca9974f8347f3711e2b80ff5a20c82383f3a2ec2f7f65a558645f780bfb40de`.
The worker completed at `2026-10-06T16:26:20.163037Z`. One private Luca synthesis
published in the original chat while Library was open, by
`2026-10-06T16:27:24.234Z`. One submitted/published event ID agrees:
`feba0f1b93e9df8a37f12053bb58a03b9ec0f44e30948cd6e062922366509d0e`.

Owned PID `70969` was stopped through the exact-identity entrypoint, and the same
signed source reopened as PID `82660`. Successful receipt, raw result, purpose
store and native-session map are byte-identical. There is one published delivery,
one synthesis attempt and the same event ID. No redispatch, new native session
or provider turn occurred. The stopped fixture remains stopped with no result.
Native UI shows the retained success; an earlier framing-failure receipt remains
explicitly historical. Before/after receipts are `d6-final-before-restart.json`
and `d6-final-after-restart.json` in the ignored local proof output directory.

Final source gates: full ACP serial and parallel each 995 passed / two explicit
native-model tests ignored; 57 focused runner tests; ACP/desktop Clippy with
warnings denied; scoped formatting/diff; 4,114 frontend tests; typecheck,
production/native build; and all 65 freshly rebuilt post-packaging UI cases
pass without retries or skips. Post-packaging receipt is under
`delegation-binding-postpack-ui-Cmk7JJf6`. Earlier intermittent fake-child spawn
failures remain disclosed as history, not labelled baseline bugs.

The approved phased D0-D6 implementation is delivered for candidate review.
External native approvals/questions/Stop/results remain native unless separately
verified. Neither inbox receipt nor this owned-work proof broadens that boundary.
Global CI formatting and the older full performance suite remain non-green as
disclosed above. This is not a release, installed-app replacement, merge, or
unrestricted parity certification.
