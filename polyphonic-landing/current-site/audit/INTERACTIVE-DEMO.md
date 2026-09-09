# Interactive hero app — 9 September 2026

The prior static hero is preserved in `pre-interactive/`. The source design and earlier page remain untouched. This update focuses on the hero and its application stage; the lower narrative remains in place.

The opening now leads from a compact centered headline and clickable provider row into a wider, complete app frame. The neutral tonal stage is retained. An expanded view makes detailed exploration possible without shrinking the desktop layout. Mobile uses a collapsible navigation rail and full-width secondary panes.

## Connected Northstar story

- Luca can report on Claude Code and Kimi's design collaboration and Codex's project-sync work.
- Library opens the brief, preference, earlier conversation, and saved Codex session.
- Brain changes what Luca can connect to the task; the hero and lower-page grants use the same state.
- Agents and six runtime views show distinct roles and work artifacts.
- Activity distinguishes current simulated progress from saved history and agent exchanges.
- Settings switches the simulated runtime while retaining identity and context.
- Luca, Research, and their shared room can be opened and messaged. Responses use fixed local scenarios, with a clear fallback for unsupported prompts.
- The drawer reveals source context or an agent exchange. Split view presents a second conversation.
- Detached chat works as an in-page window and as a separate browser window. Session-scoped BroadcastChannel messages synchronize demo conversation, runtime, progress, and context data. Nothing is written to a live app or account.

## Verified

`explorer-verification.json` records every sidebar route and runtime view, typed collaboration requests, Brain keyboard changes, source search, runtime selection, split/drawer controls, expanded Escape/focus behavior, detached chat submission, separate-window synchronization, tour start/stop, and motion pause.

Visual captures cover desktop, drawer, split, pop-out, Brain, and 390/320px layouts. Capture animations are settled to avoid judging a half-open drawer. A focused follow-up verified that Research remains its own conversation when messaged and that the selected conversation detaches.

Chromium reported no page errors and zero axe violations in the initial, Brain, drawer, detached-dialog, and mobile states. WebKit and Firefox passed navigation/pop-out smoke checks at 390px with no document overflow. The broader marketing checks also passed, including its form fixtures and no-JavaScript fallback.

The interactive-build Lighthouse mobile simulation recorded **98 performance, 100 accessibility, 100 best practices**, LCP 2.3s, TBT 20ms, CLS 0. Report: `explorer-performance.json`. These are local lab results; indexing is still intentionally disabled and the beta destination is still unconfigured.

## Limits

This is an explorable simulation, not the native application running in a browser. Typed messages select illustrative local responses; tasks do not really execute, percentages are scripted, and no subscriptions are authenticated or changed. The current source remains the visual reference for the shell; the website has its own presentational implementation. The earlier release dependencies in `DELIVERY.md` still apply.

## Control and visual polish — 2026-09-09

Replaced the nested rectangular input outline with a rounded composer focus-within border in main, split, detached, and separate-window chats. Keyboard button outlines remain visible. Scroll regions use an inset keyboard cue instead of a surrounding box.

Unified all six harness marks across the interactive navigation, provider strip, agent cards, runtime pages, and runtime chip; updated the lower connection illustration. Asset provenance is in `assets/polyphonic/BRAND-SOURCES.md`. Hermes uses its official site's current Nous illustrated favicon.

Two visual passes refined chat rhythm, compact toolbar controls, progress cards, source rows, Brain checkboxes, identity strip, agent grids, activity rows, runtime documents, settings select, search results, drawer typography, and detached-window materials. Brain's four sources and result now fit the desktop frame together. Captures are under `audit/polish-*.png`; the previous demo implementation is preserved in `audit/pre-polish/`.

Verification: build and both verification suites passed; no page errors or axe violations in tested states. Chromium, WebKit, and Firefox smoke checks passed. Additional checks covered all 15 simulated views at both 390 and 320 pixels with no horizontal page or pane overflow. Focused composer computed outline is `none`, while its parent retains the visible rounded focus treatment. Fictional data and existing production-signup limitations remain unchanged.
