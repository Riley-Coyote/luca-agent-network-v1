# Mnemos premium vision design QA

## Comparison target

- Source visual truth:
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_va43TV/Screenshot 2026-07-31 at 8.24.34 PM.png`
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_1DvSv5/Screenshot 2026-07-31 at 8.54.13 PM.png`
  - `/var/folders/rv/v8ffrtfd18qgq08w73m_4qbh0000gn/T/TemporaryItems/NSIRD_screencaptureui_v8SRnc/Screenshot 2026-07-31 at 9.06.16 PM.png`
  - `/Users/rileycoyote/Downloads/ChatGPT Image Jul 18, 2026, 01_07_46 AM.png`
  - `/Users/rileycoyote/Downloads/ChatGPT Image Jul 31, 2026, 07_12_19 PM.png`
- Implementation route: `http://127.0.0.1:4322/?vision=demo`
- Implementation screenshots:
  - `docs/vision-demo/captures/mnemos-opening-1440x900.png`
  - `docs/vision-demo/captures/mnemos-memory-1440x900.png`
  - `docs/vision-demo/captures/mnemos-inspector-1440x900.png`
  - `docs/vision-demo/captures/mnemos-opening-390x844.png`
  - `docs/vision-demo/captures/mnemos-memory-390x844.png`
  - `docs/vision-demo/captures/mnemos-inspector-390x844.png`
  - `docs/vision-demo/captures/mnemos-wordmark-1440x900.png`
  - `docs/vision-demo/captures/mnemos-wordmark-lockup-1440x900.png`
- Combined comparison evidence:
  - `docs/vision-demo/captures/qa-buzz-vs-mnemos.png`
  - `docs/vision-demo/captures/qa-mockup-vs-inspector.png`
  - `docs/vision-demo/captures/qa-wordmark-reference-vs-implementation.png`
  - `docs/vision-demo/captures/qa-wordmark-lockup-reference-vs-implementation.png`
- States: Network opening, recalled memory, memory-provenance inspector, and responsive sheet.

## Viewport and normalization

- Requested desktop viewport: 1440×900 CSS px. The Codex in-app browser was running at a 1.1 scale, producing a 1309×818 capture at device scale 1. The comparisons normalize both source and implementation to 818 pixels high without changing aspect ratio.
- Requested mobile viewport: 390×844 CSS px. The same browser scale produced a 354×767 capture. Runtime layout assertions also run at unscaled 390×844 through Playwright.
- Source pixel dimensions: Buzz 2662×1852, NYX 1448×1086, Mnemos mockup 1586×992.
- Full-view comparisons exclude native window chrome as a fidelity requirement because the implementation is rendered in the browser preview; the Tauri shell remains the production host.

## Full-view comparison evidence

The final side-by-side comparisons show the same governing composition as the references: a quiet base rail, an inset rounded conversation card, a conventional open message plane, a bottom composer card, and an independent context card when open. The implementation intentionally uses deterministic key specimens instead of portrait avatars and reserves black for selection, primary action, and active memory evidence.

## Focused-region comparison evidence

The inspector comparison is large enough to judge header density, card separation, information rows, typography, borders, identity marks, and the active-memory surface. Separate memory and mobile captures verify the focus treatment and sheet behavior. The wordmark comparison isolates the reference's NYX dot-matrix label and the rendered MNEMOS label at matching display scale so the dot structure, weight, tracking, and sidebar alignment are directly reviewable.

## Required fidelity surfaces

- Fonts and typography: Instrument Sans is used for navigation and conversation; Fragment Mono is restricted to receipts, timestamps, shortcuts, and provenance; Doto is reserved for the product wordmark and active display surfaces. Product text is no longer rendered as ornamental microtype.
- Spacing and layout rhythm: the 270px rail, 10px base gutter, 22px application-card radius, 68px header, 900px message measure, and 344px inspector reproduce the source hierarchy without the earlier full-bleed slab effect.
- Colors and tokens: the surface is neutral and light; selection and active memory are black; the red operational lamp is the only chromatic state accent. There are no decorative gradients or glow effects.
- Image and asset fidelity: the supplied references contain portrait avatars, but Mnemos intentionally substitutes the approved deterministic cryptographic identity specimens. Utility controls use the existing icon library. No missing raster asset is represented by a placeholder.
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

### Iteration 4 — passed

- [P2] The font-only wordmark sat on an undersized 38px row, began at the sidebar edge rather than the shared label column, lacked a structural boundary, and floated independently from the adjacent collapse control and 68px conversation header.
- Fix: created a 68px masthead aligned to the conversation header; placed the existing Mnemos product glyph in the navigation icon column; aligned the Doto wordmark to the sidebar label column; added a quiet divider; optically retuned size, weight, and tracking; and made the collapsed product mark act as the expansion control.
- Post-fix evidence: `docs/vision-demo/captures/qa-wordmark-lockup-reference-vs-implementation.png` and `docs/vision-demo/captures/mnemos-wordmark-lockup-1440x900.png`. Browser measurements confirm the masthead and conversation header share the same vertical center, the wordmark begins at 52px on the label grid, and the shell has zero horizontal overflow.

## Findings

No actionable P0, P1, or P2 visual mismatches remain for the Phase 1 shell-approval scope.

## Primary interactions and runtime checks

- Opened and navigated the eight-beat demo control.
- Opened recalled memory and the provenance inspector.
- Verified inspector close and responsive sheet behavior.
- Verified composer focus inversion and local-note sending.
- Verified deterministic identity patterns remain stable and unique.
- Verified no document overflow at 1440×900, 1280×800, 1024×768, or 390×844.
- Checked the live browser console: no errors.
- Typecheck, focused E2E (5 tests), E2E build, and production build pass.

## Follow-up polish

- [P3] Native Tauri window chrome should be recaptured when the design is promoted from the browser vision branch.
- [P3] Agents, Brain, and Continuity remain deliberate approval-gate placeholders and are outside this Phase 1 visual pass.

final result: passed
