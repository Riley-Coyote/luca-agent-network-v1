# Polyphonic Home v3 — visual and interaction audit

9 September 2026. Baseline is the exact supplied `Polyphonic Home v3.dc.html`, with missing support/display scripts and provider assets restored from the supplied handoff ZIP. The original is untouched. Baseline images and measurements sit beside this report.

## Verdict

The centered “Your agents, TOGETHER” opening and large native-shaped conversation establish the right product and emotional register. This is a promising authored direction, not a reason for another redesign. Its weakest point is precision: excessive dead space makes the product demonstrations feel incidental; the small details have not received the care of the headline.

Preserve the centered composition, Instrument Sans / Fragment Mono / Doto roles, black material palette, single lattice band, recognizable shell, fictional Northstar conversation, interactive Brain example, and alternating narrative. Mode: refinement. Variance 4, motion 4, density 4. Generic skill defaults that contradict this chosen direction are not applicable.

## Coverage before repairs

| Surface | Baseline evidence | Finding |
| --- | --- | --- |
| Desktop 1440 × 1000 | baseline-desktop.png, baseline.json | Hero and app coherent; lower rows share a 600px minimum height |
| Mobile 390 and 320 | baseline-390.png, baseline-320.png | No document overflow; visual order reverses for Brain/control; extensive gaps remain |
| Brain access | Both residents' toggles examined, Luca brief toggled | 22px targets; contrast and accessible response need work |
| Permission example | Allow once then result | Works, but uses a different named agent and claims every action is signed |
| Beta | Valid local test address submitted, no external transmission | Ends with internal “Set an endpoint or address in Tweaks” message |
| Motion | Source plus normal browser render; reduced baseline | Conversation resets every 12.6s with no pause/replay; reduced preference read once |
| Structure/loading | DOM and console | No document title/lang/main/nav; invalid template paths log errors before hydration; React/Babel loaded from external CDNs |

## Prioritized findings

### P0 — real beta destination missing

The main conversion path cannot complete. In the baseline it reveals development instructions to the visitor. Wire a provided destination; support actual success/failure and duplicate-submit prevention. Until configured, report unavailability clearly and never simulate signup success. Publishing remains blocked on the destination and its privacy policy.

### P1 — production depends on a design-editor runtime

`support.js` fetches React, ReactDOM and Babel from unpkg, then compiles the page in the browser. Without that dependency chain, the content contains template expressions and is unusable. Convert the selected rendering to semantic, static HTML with small progressive enhancements. Success: meaningful first frame with JavaScript disabled, self-hosted assets, no template errors or runtime compiler.

### P1 — long gaps obscure the narrative

At 1440 × 1000 each of the four product rows reserves 600px before its next 80px margin. The Brain section begins at y2583; the beta section at y4703. Mobile inherits very tall presentation wrappers. Tighten to content-led rows, increase the useful product panel width, and keep text before its example in mobile reading order. Success: every scroll advances the argument; no miniature desktop or forced empty stage.

### P1 — animation overrides reading

The conversation erases and restarts every 12.6 seconds. The marquee and ornamental field keep moving without controls. Preserve motion but make it controllable: complete conversation by default; deliberate replay; one shared motion control; reduced-motion changes observed live; suspend work in hidden tabs and offscreen elements. No paragraph should depend on catching an animation frame.

### P1 — small text and interactive targets

Informative `--t3` (#565656) on black is about 2.86:1. The 22px Brain controls and 30px approval buttons are uncomfortable on touch. Use sufficient contrast, 44px interaction areas, visible keyboard focus, a real email label, semantic landmarks, and a polite response to changed context. Success: automated checks plus keyboard and narrow-width interaction passes.

### P2 — shell and copy consistency

The fictional Northstar demo contains Riley's profile and introduces Vektor and Ziggy late. Keep the example coherent; identify it as an interactive example rather than a current native screenshot. Connected saved sessions must stay distinct from live work. Avoid the unsupported universal promise that every file access requires a new prompt or every activity item is individually signed. Retain agent identity and continuity as the product's central story.

### P2 — materials need optical separation

Black cards cast black shadows onto black backgrounds, so the shadows contribute little. Keep neutral materials but add subtle edge light and a restrained local stage under the product panels. Improve type hierarchy and consistent insets before adding effects. Do not introduce new generated backgrounds, decorative copy, or another hero concept.

## Implementation order

1. Static delivery, missing assets, semantic structure and conversion states.
2. Typography, spacing, responsive composition and readable examples.
3. Context/permission interactions, demo replay and shared motion control.
4. Browser refinement, contrast/keyboard/overflow/reduced-motion checks, local performance measurements.

## Standards and limits

Benchmarks: [WCAG pause/stop/hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html), [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and the product-first hierarchy of [Linear](https://linear.app/homepage). A comfortable 44px hit area is our design target; WCAG 2.2 AA minimum has a smaller threshold and spacing exceptions.

An audit and a Lighthouse run cannot establish awards, legal compliance, real-user comprehension, or field Core Web Vitals. The fictional product demonstrations do not prove release integration acceptance. Keep release verification separate from this page's frontend checks.

The audit phase is complete. The current user request explicitly authorizes polishing and implementation, so repairs proceed in the isolated working copy.
