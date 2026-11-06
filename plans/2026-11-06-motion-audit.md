# Polyphonic beta.14 — interaction and motion audit

Date: November 6, 2026. Source: `2920f802a98897c259689bc7af5c36a87de9a196`,
`claude/native-rail-glass`, internal `luca-beta14-polish` checkout.

## Direction

Every action responds immediately; only the surface that changed settles.
Keep the approved geometry, typography, glass, composer, agent marks and motion
personality. Do not replace them with generic fades, add decorative motion, or
shorten all durations indiscriminately.

## What was actually checked

- Three bounded read-only source reviews: navigation/panels; chat/controls;
  continuous animation/compositing. The integrator reread every finding below.
- Native candidate walkthrough: conversation details open/close, drawer resident
  tab, Agents, agent Settings, Keeps up with, and mini-chat launch. Inspected
  actual dark-theme screenshots. No permissions, content or settings changed;
  no new model message, upload or task sent during this audit.
- Existing live task-pane behavior from the immediately preceding acceptance
  walkthrough was rechecked against its current mount/close/CSS paths.
- Two deterministic, in-memory Node probes of the current scheduler code.
  They are not native frame-rate or CPU benchmarks. No build or source change
  was needed. See evidence below.
- Reviewed send/streaming/attachment motion in production source. Did not send
  another paid message just to create animation traffic.

Native frame pacing, click-to-paint distributions, rapid reversal frame strips,
both-theme viewport comparisons and OS Reduce Motion remain execution-stage
checks. This audit does not claim every animation was watched frame by frame.

## Prioritized findings

Locations are repository-relative, with lines pinned to the source above.

| # | Severity | Category | Location | Finding | Fix summary |
| --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Performance | `desktop/src/app/shell/shellGlass.ts:426`, `:473`; `desktop/src/shared/theme/ThemeProvider.tsx:1152` | Every document `transitionrun`/`animationstart`, including a button's color change, starts 520 ms of frame-by-frame glass geometry measurement. Light-theme shadows install a separate watcher too. Reporter deduplication occurs after geometry reads. | Filter to changes that can actually move the frame/cards, coalesce geometry consumers, and retain exact tracking during real panel/rail movement. Preserve the glass and its shadows. |
| 2 | HIGH | Performance | `desktop/src/shared/ui/inkLight.ts:90–104`; `desktop/src/features/messages/ui/TimelineMessageList.tsx:199`, `:491` | `lit` becomes true before viewport eligibility is checked. An unanswered wet word outside the viewport keeps the shared frame loop alive, rescanning and measuring words. Visible words interleave geometry reads and style writes. | Track drawable words/hosts, batch reads before writes, and stop when nothing can be drawn. Add a reliable intersection/scroll wakeup; moving `lit` alone could leave visible words asleep. Preserve the approved light behavior. |
| 3 | MEDIUM | Continuity/interruptibility | `desktop/src/features/exchange/ui/TaskChatPane.tsx:35`, `:110`; `desktop/src/features/exchange/ui/task-chat.css:1–14` | Task chat mounts/unmounts directly instead of participating in the surrounding panel presence lifecycle. Opening it also hides an existing inspector with `display:none`; closing restores that inspector immediately. There is no local enter/exit treatment. | Retain the closing card and add a restrained, interruptible handoff using existing panel conventions. Preserve 480 px geometry, overlay threshold, focus return, inspector state and execution independence. Do not animate/reflow the reading column on every frame. |
| 4 | MEDIUM | Interruptibility | `desktop/src/features/messages/ui/MessageComposer.tsx:1657`; `desktop/src/features/messages/ui/ComposerAttachments.tsx:515`, `:531` | Removing one of several attachments animates; removing the last one immediately destroys the tray and its presence boundary, bypassing the exit. | Keep a presence boundary alive through the final removal. Preserve keyboard focus and avoid making Send wait for a cosmetic exit. |
| 5 | MEDIUM | Accessibility | `desktop/src/shared/ui/tooltip.tsx:21`; `desktop/src/features/messages/ui/ComposerAttachments.tsx:524–614`; `desktop/src/features/messages/ui/ComposerImageEditor.tsx:379` | Shared tooltips and attachment/layout springs do not have reduced-motion handling. The annotation toolbar still slides 48 px. Nearby components handle this correctly, so behavior is inconsistent. | Give these specific paths opacity-only/no-spatial variants. Preserve prompt state and control feedback; do not globally disable all animation. |
| 6 | LOW | Cohesion/performance | `desktop/src/shared/ui/tabs.tsx:30`; `desktop/src/features/projects/ui/ProjectWorkspaceTabList.tsx:7–24` | Shared tab triggers use `transition-all`; live project tabs also change font weight. That permits unwanted interpolation instead of crisp selection. The invisible semibold label already stabilizes width. | Limit transitions to the intended color/background/shadow properties; keep typography and the width-stabilizing label. Native performance impact is not measured. |
| 7 | MEDIUM, localized | Performance | `desktop/src/shared/ui/VideoPlayer.tsx:344–373`, `:1710` | Open video review schedules rAF indefinitely and redraws its blurred canvas at 15 fps even when playback is paused/ended. This is not the cause of general navigation jank when review is closed. | Preserve the glow; refresh on actual decoded playback frames and once after load/seek/pause. Stop idle/hidden work and handle unsupported frame APIs. |

HIGH here means high leverage and potentially app-wide frame contention, not a
claim that a particular FPS loss has been measured.

## Deterministic scheduler evidence

### Offscreen wet ink

Imported the current `inkLight.ts` directly with Node's type stripping. Supplied
one unanswered mock word whose rectangle was wholly above a 900 px viewport;
advanced the mocked rAF queue for 60 frames, with reduced motion off.

```json
{"probe":"offscreen unanswered wet word, 60 simulated frames","rectangleReads":60,"styleWrites":0,"framesStillQueued":1}
```

This proves continued scheduling/measurement with no drawable word. It does not
prove how much CPU the native engine spends or how many words a user's current
timeline retains. The native screenshot and AX tree do not expose JS frame cost.

### Glass watching a color transition

Extracted the unchanged private `watchLayout` function from the current source
and transpiled it in memory. Mocked its DOM/observer boundaries, delivered one
`transitionrun` event with `propertyName: "color"` on a button, and advanced the
existing 520 ms follow window at simulated 60 Hz.

```json
{"probe":"one unrelated button color transition, simulated60Hz","layoutCallbacks":32,"framesStillQueued":0}
```

The rail add button really has color/background transitions at
`desktop/src/app/shell/shell-rail.css:66`. `useShellGlassReporter` calls
`measureCard(conversationCard())` before reporter deduplication; the day shadow
consumer measures its own cards. The probe counts callbacks, not native IPC
posts or milliseconds of layout cost.

## Deliberate motion not condemned

- The 460 ms rail width/edge choreography is explicitly approved in
  `docs/luca/rail-system/SHELL_SPEC.md`; do not replace it merely because a
  generic duration rule says 300 ms. Measure its frame pacing first.
- Send's squish/release spring, asymmetric arm/disarm, mini-chat spring morph,
  streamed-word stability and activity text-window spring are approved behavior.
  No evidence here warrants changing their visual identity.
- Navigation pins root snapshots; conversation-to-conversation changes use the
  motionless case. Section tabs already have a deliberately small opacity-only
  arrival. Brain's rare 420 ms dissolve is documented separately.
- Shared popovers/dropdowns use the trigger's transform origin. Modals are
  correctly centered; centered origin is not a defect there.
- Dormant `FocusThreadDrawer` code and the auxiliary overlay below 600 px were
  excluded from the current native desktop findings.
- No recommendation to change agent-mark shapes, engine constants, grain,
  materials, blur appearance or the approved reading/composer geometry.

## Missed opportunities, after the corrective work

1. One retained panel handoff for inspector ↔ task chat, rather than independent
   cuts. This is finding 3, not a second task or a new UI concept.
2. Consistent last-attachment removal, using the same lifecycle as other items.
3. An interaction regression harness for the current shell: first feedback,
   reversal continuity, and frame pacing of the actual high-frequency paths.
   This adds evidence, not more visible animation.

No other delight/decorative animation is recommended for this pass.

## Measurement gaps and verification sequence

The current `desktop/dist` is the real native production build, whose bootstrap
correctly excludes the mock bridge. Existing mocked performance specs cannot
be run against it as if it were an E2E build. No historical results are presented
as fresh measurements.

`desktop/tests/e2e/nav-motion.perf.ts` primarily exercises the older
`agent-chats-column` path, not the current embedded task chat. Reuse its
long-task/CDP utilities, but update the scenarios to the shipping shell before
using it as evidence for this request. The rail LayoutCount case currently
reports a count; it does not enforce a frame-cost upper bound.

After Riley selects fixes:

1. Baseline current shell routes, conversation switching, inspector tabs,
   task open/close, mini-chat, composer typing/send/stream and attachment add/remove.
   Separate cold loading, warm rendering and model/network wait.
2. Run one E2E build and one heavy job at a time; use the shared native cache.
   Keep the candidate's profile, daily app and other sessions intact.
3. Start with findings 1 and 2. Gate scheduler work directly: unrelated hover
   does not start a geometry follow loop; offscreen ink reaches zero scheduled
   frames and resumes correctly on return; no duplicate per-frame consumers.
4. Measure main-thread long tasks, layout/style counts and frame intervals at
   the display's refresh rate, not just animation duration. Compare the same
   native/browser workloads under similar machine load. No made-up speedup.
5. Then implement finding 3, followed by 4–6. Verify fast reversals, no one-frame
   snaps, no duplicate transcripts, focus recovery, and that closing a task
   surface never changes its execution. Video scheduling is a separate small fix.
6. Inspect actual captures/short frame sequences in both themes, DPR 1 and 2,
   desktop widths 1440/1280/1024 and the native minimum. Browser-only 390-wide
   reflow is not a claim that Polyphonic is a phone product. Use browser-emulated
   reduced motion; do not toggle Riley's OS settings without separate approval.
7. Retest retained message/attachment semantics and user text zoom. Preserve all
   settled pixels except the explicitly selected motion changes.

The current machine has concurrent film/browser/development work. An observed
slow run without a same-load baseline would not isolate Polyphonic's cost.
Nothing from another session was stopped or altered.

## Verdict

**Block calling the interaction layer finished.** There is concrete avoidable
scheduler work and inconsistent presence behavior. Start with 1–3; measure the
gain before tuning approved springs. Source and candidate behavior are unchanged
by this audit; this file is the only new repository artifact.

Harshest three-line critique:

The shell promises one calm material, but its surfaces do not share one lifecycle.
Invisible animation work competes with the moments the user is actually watching.
More easing cannot hide that; fix scheduling and continuity before adding polish.

## Implementation checkpoint — November 6

All seven source fixes are implemented. The original audit above records the
baseline; it is not a description of the updated implementation.

- Glass reporting and day shadows share one measured snapshot, observer set and
  animation clock. Only frame-affecting geometry events start the follow loop.
- Wet ink caches candidate words, sleeps when clipped/offscreen/hidden, wakes
  through intersection/scroll/media/appearance events, and reads before writing.
- Task chat uses retained, scope-keyed panel presence. Closing disables view-only
  subscriptions/reads, never execution. Inspector state and focus survive the
  handoff, including an inspector that finishes entering while covered.
- Attachment presence survives final removal; outgoing controls are inert and
  focus returns to the editor without delaying Send. Existing springs remain.
- Tooltip/attachment/annotation spatial motion has local reduced-motion gates.
  Tab transitions name only color, background and shadow properties.
- Video glow follows decoded frames (15 fps drawing cap), rests paused/hidden,
  refreshes after seeks, and retains a still wash under Reduce Motion.

### Equivalent-workload evidence

`interaction-motion.perf.ts` replaces the retired second-column scenario with
the current shell, embedded task pane, section navigation and typing. Both
builds use the same fixtures, 1440×900 Chromium software rendering and probes.
The original frontend is loaded from Git by `build-motion-baseline.mjs`, without
checking out files, linking dependencies or creating another native cache.
The native geometry reporter is exercised through a mock post bridge; this does
not simulate the optical appearance of native glass.

| 700 ms observation after settling | Original `2920f802a` | Candidate |
| --- | ---: | ---: |
| Unrelated rail-button hover, dark: card geometry reads | 132 | 0 |
| Same hover, light: card geometry reads | 256 | 0 |
| Offscreen unanswered ink: word reads, dark | 85 | 0 |
| Same offscreen ink, light | 85 | 0 |

The three 800 ms task-entry samples had p95 rAF intervals of 9.1–9.3 ms on the
baseline and 16.8–24.9 ms on the candidate. Candidate entry now actually animates
instead of cutting in. Candidate layout counts were 18–21 versus 4–5; the old
cut-in is not an equivalent visual animation. An unrelated 1773 ms long task
also occurred during the candidate light-theme idle run while other builds
were active. These samples **do not establish a frame-rate improvement** or
isolate native compositor cost. The measured improvement is eliminated
unnecessary scheduler/measurement work, not a claimed FPS multiplier.

### Verification in progress

Focused scheduler/lifecycle tests, current-shell browser regressions and native
candidate proof are recorded in the isolated candidate's `proof/motion-2026-11-06`
folder. Final check totals and native limitations are added after the build.
No other session's jobs, daily-app data, permissions or release channels change.
