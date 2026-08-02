# Mnemos premium vision design QA

## Comparison target

- Source visual truth:
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_va43TV/Screenshot 2026-07-31 at 8.24.34 PM.png`
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_1DvSv5/Screenshot 2026-07-31 at 8.54.13 PM.png`
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_v8SRnc/Screenshot 2026-07-31 at 9.06.16 PM.png`
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_ARFXuX/Screenshot 2026-07-31 at 9.35.09 PM.png`
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_oIYp6U/Screenshot 2026-08-01 at 4.57.13 PM.png`
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_Fru9K0/Screenshot 2026-08-01 at 9.24.10 PM.png`
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_sxwkpd/Screenshot 2026-08-01 at 9.25.52 PM.png`
  - `/Users/rileycoyote/Downloads/ChatGPT Image Jul 18, 2026, 01_07_46 AM.png`
  - `/Users/rileycoyote/Downloads/ChatGPT Image Jul 31, 2026, 07_12_19 PM.png`
- Implementation route: `http://127.0.0.1:4322/?vision=demo`
- Dark-system reference:
  `/Users/rileycoyote/Documents/Repositories/luca-terminal/luca-terminal-design-language-v2.html`
- Implementation screenshots:
  - `docs/vision-demo/captures/mnemos-opening-1440x900.png`
  - `docs/vision-demo/captures/mnemos-memory-1440x900.png`
  - `docs/vision-demo/captures/mnemos-inspector-1440x900.png`
  - `docs/vision-demo/captures/mnemos-opening-390x844.png`
  - `docs/vision-demo/captures/mnemos-memory-390x844.png`
  - `docs/vision-demo/captures/mnemos-inspector-390x844.png`
  - `docs/vision-demo/captures/mnemos-wordmark-1440x900.png`
  - `docs/vision-demo/captures/mnemos-wordmark-lockup-1440x900.png`
  - `docs/vision-demo/captures/mnemos-wordmark-centered-1440x900.png`
  - `docs/vision-demo/captures/mnemos-opening-complete-1440x900.png`
  - `docs/vision-demo/captures/mnemos-memory-complete-1440x900.png`
  - `docs/vision-demo/captures/mnemos-agents-1440x900.png`
  - `docs/vision-demo/captures/mnemos-brain-1440x900.png`
  - `docs/vision-demo/captures/mnemos-continuity-1440x900.png`
  - `docs/vision-demo/captures/mnemos-network-return-1440x900.png`
  - `docs/vision-demo/captures/mnemos-agents-390x844.png`
  - `docs/vision-demo/captures/mnemos-brain-390x844.png`
  - `docs/vision-demo/captures/mnemos-continuity-390x844.png`
  - `docs/vision-demo/captures/mnemos-icons-1440x900.png`
  - `docs/vision-demo/captures/mnemos-icons-390x844.png`
  - `docs/vision-demo/captures/mnemos-rail-refined.png`
  - `docs/vision-demo/captures/mnemos-scrollbar-beat-08.png`
  - `docs/vision-demo/captures/mnemos-theme-light-opening.png`
  - `docs/vision-demo/captures/mnemos-theme-dark-opening.png`
  - `docs/vision-demo/captures/mnemos-theme-dark-inspector.png`
  - `docs/vision-demo/captures/mnemos-theme-dark-agents.png`
  - `docs/vision-demo/captures/mnemos-theme-dark-brain.png`
  - `docs/vision-demo/captures/mnemos-theme-dark-continuity.png`
  - `docs/vision-demo/captures/mnemos-theme-dark-390x844.png`
- Combined comparison evidence:
  - `docs/vision-demo/captures/qa-buzz-vs-mnemos.png`
  - `docs/vision-demo/captures/qa-mockup-vs-inspector.png`
  - `docs/vision-demo/captures/qa-wordmark-reference-vs-implementation.png`
  - `docs/vision-demo/captures/qa-wordmark-lockup-reference-vs-implementation.png`
  - `docs/vision-demo/captures/qa-wordmark-centered-reference-vs-implementation.png`
  - `docs/vision-demo/captures/qa-reference-vs-complete-shell.png`
  - `docs/vision-demo/captures/qa-complete-surface-set.png`
  - `docs/vision-demo/captures/qa-custom-glyphs-vs-lucide.png`
  - `docs/vision-demo/captures/qa-rail-before-vs-refined.png`
  - `docs/vision-demo/captures/qa-light-vs-dark-theme.png`
- States: Network opening, recalled memory, synthesis, later return, Agents
  dossier, Brain provenance, Continuity evidence, inspectors, and responsive
  product surfaces.

## Viewport and normalization

- Requested desktop viewport: 1440×900 CSS px. The Codex in-app browser was running at a 1.1 scale, producing a 1309×818 capture at device scale 1. The comparisons normalize both source and implementation to 818 pixels high without changing aspect ratio.
- Requested mobile viewport: 390×844 CSS px. The same browser scale produced a 354×767 capture. Runtime layout assertions also run at unscaled 390×844 through Playwright.
- Source pixel dimensions: Buzz 2662×1852, NYX 1448×1086, Mnemos mockup 1586×992.
- Full-view comparisons exclude native window chrome as a fidelity requirement because the implementation is rendered in the browser preview; the Tauri shell remains the production host.

## Full-view comparison evidence

The final side-by-side comparisons show the same governing composition as the references: a quiet base rail, an inset rounded conversation card, a conventional open message plane, a bottom composer card, and an independent context card when open. The implementation intentionally uses deterministic key specimens instead of portrait avatars and reserves black for selection, primary action, and active memory evidence.

## Focused-region comparison evidence

The inspector comparison is large enough to judge header density, card separation, information rows, typography, borders, identity marks, and the active-memory surface. Separate memory and mobile captures verify the focus treatment and sheet behavior. The wordmark comparison isolates the reference's NYX dot-matrix label and the rendered MNEMOS label at matching display scale so the dot structure, weight, tracking, and sidebar alignment are directly reviewable. The focused icon comparison places the former custom glyph rail beside the final Lucide rail, making silhouette quality, optical size, stroke consistency, and active-state contrast directly reviewable.

## Required fidelity surfaces

- Fonts and typography: Instrument Sans is used for navigation and conversation; Fragment Mono is restricted to receipts, timestamps, shortcuts, and provenance; Doto is reserved for the product wordmark and active display surfaces. Product text is no longer rendered as ornamental microtype.
- Spacing and layout rhythm: the 270px rail, 10px base gutter, 22px application-card radius, 68px header, 900px message measure, and 344px inspector reproduce the source hierarchy without the earlier full-bleed slab effect.
- Colors and tokens: the surface is neutral and light; selection and active memory are black; the red operational lamp is the only chromatic state accent. There are no decorative gradients or glow effects.
- Image and asset fidelity: the supplied references contain portrait avatars, but Mnemos intentionally substitutes the approved deterministic cryptographic identity specimens. Navigation and semantic utility controls now use a typed Lucide vocabulary; handcrafted SVGs remain only for the approved deterministic identity specimens. No missing raster asset is represented by a placeholder.
- Copy and content: the seeded launch-room narrative remains unchanged in meaning. Demo disclosure, memory scope, authorization, receipt, and provenance remain explicit.

## Comparison history

### Iteration 0 — blocked

- [P1] The prior shell preserved the information architecture only abstractly. It flattened the main plane into the housing, overused engraved micro-labels, and looked like a design study rather than Buzz-derived product UI.
- Fix: rebuilt the shell around a continuous housing rail plus inset conversation and inspector cards; restored familiar header, open timeline, selection, composer, and readable product-scale type.
- Post-fix evidence: `docs/vision-demo/captures/qa-buzz-vs-mnemos.png`.

### Iteration 1 — blocked

- [P2] Populated demo beats expanded the main grid beyond the viewport, moving the header and rail off-screen instead of scrolling only the timeline.
- Fix: constrained the main, workspace, conversation card, and conversation grid with explicit minimum heights and overflow containment.
- Post-fix evidence: desktop opening, memory, and inspector captures; focused E2E assertions at 1440×900, 1280×800, 1024×768, and 390×844.

### Iteration 2 — passed

- [P2] Keyboard focus on the black memory surface inherited a blue application outline that conflicted with the monochrome display language.
- Fix: replaced it with a high-contrast inset neutral focus boundary that remains visible without introducing a second accent.
- Post-fix evidence: `docs/vision-demo/captures/mnemos-inspector-1440x900.png`.

### Iteration 3 — blocked

- [P2] The MNEMOS wordmark still used the general UI sans and therefore missed the sparse dot-matrix identity treatment in the selected NYX reference.
- Fix: moved only the product wordmark to the existing self-hosted Doto display face, with rounded terminals, restrained weight, and tighter tracking; all other shell typography and geometry remain unchanged.
- Post-fix evidence: `docs/vision-demo/captures/qa-wordmark-reference-vs-implementation.png` and `docs/vision-demo/captures/mnemos-wordmark-1440x900.png`. The typeface matched, but the isolated text did not yet form a production-quality lockup or participate in the sidebar grid.

### Iteration 4 — blocked

- [P2] The font-only wordmark sat on an undersized 38px row, began at the sidebar edge rather than the shared label column, lacked a structural boundary, and floated independently from the adjacent collapse control and 68px conversation header.
- Fix: created a 68px masthead aligned to the conversation header; placed the existing Mnemos product glyph in the navigation icon column; aligned the Doto wordmark to the sidebar label column; added a quiet divider; optically retuned size, weight, and tracking; and made the collapsed product mark act as the expansion control.
- Post-fix evidence: `docs/vision-demo/captures/qa-wordmark-lockup-reference-vs-implementation.png` and `docs/vision-demo/captures/mnemos-wordmark-lockup-1440x900.png`. The masthead became structurally coherent, but the combined expanded mark and word still read as a left-aligned navigation label rather than a centered title-bar identity.

### Iteration 5 — passed

- [P2] The expanded logo did not honor the reference's title-bar centering or reserve the macOS stoplight region.
- Fix: converted the masthead to a three-zone title-bar grid with a 60px stoplight safe area, a centered wordmark region, and a balanced 34px sidebar-control region. Removed the redundant expanded M glyph while retaining the Mnemos mark as the collapsed expansion control.
- Post-fix evidence: `docs/vision-demo/captures/qa-wordmark-centered-reference-vs-implementation.png` and `docs/vision-demo/captures/mnemos-wordmark-centered-1440x900.png`. Browser measurements place the 92.4px wordmark at x98.3, safely beyond the x72 stoplight boundary, vertically aligned to the masthead at y43.5, and separated from the collapse control at x217 with zero horizontal overflow.

### Iteration 6 — passed

- [P1] Agents, Brain, and Continuity were deliberate approval-gate
  placeholders, so the prototype could not yet communicate the complete product
  vision.
- Fix: implemented all three as production-intent list-detail surfaces inside
  the accepted Buzz-derived shell. Agents now exposes stable identity,
  relationship history, cognition state, access scope, and continuity receipts.
  Brain exposes source, confidence, scope, recall state, authorization, and
  provenance. Continuity exposes the signed session → reflection → proposal →
  return chain with Riley's review authority explicit.
- Post-fix evidence: `docs/vision-demo/captures/qa-complete-surface-set.png`.

### Iteration 7 — passed

- [P2] The completed surfaces initially used an overly tall introduction band,
  which reduced useful evidence density at the browser's scaled 1440×900
  capture size.
- Fix: tightened the surface header from 174px to 150px while preserving the
  approved type hierarchy, breathing room, and full mobile reflow.
- Post-fix evidence: the final Agents, Brain, and Continuity desktop captures.

### Iteration 8 — passed

- [P2] The navigation and semantic icons were custom square-terminal drawings
  whose dense internal geometry rendered unevenly at 17px, making the mature
  shell feel less commercially finished.
- Fix: replaced the entire custom glyph component with a typed Lucide icon
  vocabulary: Messages Square, Users Round, Brain, History, Book Open Text,
  Badge Check, and Activity. Replaced the raw add-room symbol and collapsed
  sidebar mark with Lucide controls, then normalized navigation to 18px / 1.75px
  strokes and optically tuned larger semantic placements. The cryptographic
  agent identity specimens remain unchanged.
- Post-fix evidence:
  `docs/vision-demo/captures/qa-custom-glyphs-vs-lucide.png`,
  `docs/vision-demo/captures/mnemos-icons-1440x900.png`, and
  `docs/vision-demo/captures/mnemos-icons-390x844.png`.

### Iteration 9 — passed

- [P2] The long conversation inherited a dark native scrollbar track, creating
  a black gutter against the light conversation card. Recent conversations also
  retained channel hash icons, loose 36px rows, and a comparatively heavy
  selected state, which made the rail feel more like a workspace channel list
  than a finished personal chat product.
- Fix: explicitly set the conversation scroller to a light native color scheme
  with a white track and narrow neutral thumb; removed icons from recent
  conversation rows; tightened them to 32px; reduced section gaps and label
  tracking; softened the active conversation fill; and tightened resident-agent
  rows while preserving the approved identity specimens.
- Post-fix evidence:
  `docs/vision-demo/captures/qa-rail-before-vs-refined.png`,
  `docs/vision-demo/captures/mnemos-rail-refined.png`, and
  `docs/vision-demo/captures/mnemos-scrollbar-beat-08.png`. Runtime inspection
  confirms a light color scheme, `rgb(251, 251, 250)` track, neutral
  `rgb(212, 214, 211)` thumb, 32px conversation rows, zero conversation-row
  SVGs, and zero horizontal overflow.

### Iteration 10 — passed

- [P2] The vision demo exposed only the light housing system, preventing a
  meaningful comparison with Riley's dark-native Luca language and leaving no
  user-controlled theme preference.
- Fix: added a persistent light/dark control to the conversation chrome and a
  complete semantic dark token layer based on Luca's canonical tonal sequence:
  `#141414` base, `#181818` raised, `#1C1C1C` conversation cards, `#202020`
  elevated controls, and `#111111` inset display wells. No surface uses pure
  black. Ordinary hierarchy remains monochrome; the red lamp remains reserved
  for operational activity. Replaced light-only component colors, borders,
  shadows, scrollbars, overlays, focus rings, and evidence surfaces with
  theme-aware tokens. The short-viewport resident roster now scrolls rather
  than painting beneath the owner footer.
- Post-fix evidence: `docs/vision-demo/captures/qa-light-vs-dark-theme.png`,
  the complete dark surface set, inspector capture, and 390px responsive
  capture. Runtime inspection confirms `rgb(20, 20, 20)` housing,
  `rgb(28, 28, 28)` cards, `rgb(17, 17, 17)` display wells, dark native color
  scheme, no pure-black surfaces, no horizontal overflow, a neutral focus ring,
  and zero browser console errors.

## Findings

No actionable P0, P1, or P2 visual mismatches remain for the completed vision
scope. The rail now has the compact, text-forward rhythm of a frontier chat app,
the light thread scrollbar belongs to the conversation card, and the approved
identity specimens remain visually distinct from ordinary navigation chrome.
The dark mode is a parallel material system with Luca's narrow charcoal
elevation steps, not a generic inversion of the approved light theme.

## Primary interactions and runtime checks

- Opened and navigated the eight-beat demo control.
- Opened recalled memory and the provenance inspector.
- Verified inspector close and responsive sheet behavior.
- Verified composer focus inversion and local-note sending.
- Verified deterministic identity patterns remain stable and unique across all
  four surfaces.
- Verified resident selection, memory selection, receipt inspection,
  continuity-event inspection, pinning, and all eight story states.
- Verified every desktop and mobile destination renders the intended Lucide
  icon contract at a consistent optical size and stroke weight.
- Verified the long-thread scrollbar track and thumb remain neutral on the light
  conversation card and every recent-conversation row is icon-free.
- Verified light/dark switching, saved preference restoration, dark scrollbars,
  every product destination, the memory inspector, and the 390px dark layout.
- Verified no document overflow at 1440×900, 1280×800, 1024×768, or 390×844.
- Checked the live browser console: no errors.
- Typecheck, focused E2E (9 tests), E2E build, and production build pass.

## Follow-up polish

- [P3] Native Tauri window chrome should be recaptured when the design is promoted from the browser vision branch.
- [P3] The deferred top-left wordmark treatment can be revised independently
  without disturbing the accepted shell or surface system.

final result: passed
