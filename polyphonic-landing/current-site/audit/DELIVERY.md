# Delivery — Polyphonic Home v3 refinement

9 September 2026. Preview: http://127.0.0.1:8744/

## Design retained

This is a refinement of the supplied version: centered two-voice headline, Instrument Sans / Doto / Fragment Mono, neutral black surfaces, subtle reactive lattice, substantial app conversation, one full-width display band, and alternating product stories. The original file remains untouched. No generated background or new hero concept was introduced.

## Changes and rationale

| Area | Result |
| --- | --- |
| Typography | Balanced hero copy and line breaks; more deliberate hierarchy, contrast, and readable application text |
| Composition | Content-led feature heights replace repeated 600px stages; wider useful product panels and consistent insets keep each scroll meaningful |
| Materials | Restrained edge light and local tonal separation give the panels depth without changing the neutral palette |
| Mobile | Conversation is recomposed at a readable size; explanation precedes Brain/control examples; sidebar is intentionally omitted |
| Reading and motion | Complete first frame; explicit replay reveals whole message blocks; interrupt, global pause, live reduced-motion preference, and hidden-tab handling |
| Accessibility | Semantic landmarks, skip link, email label, keyboard focus, larger targets, accessible grant state and result announcements |
| Product truth | Saved connected sessions retain timestamps; fictional profile is `You`; grant/permission actions are local examples; unsupported universal signing/permission claims removed |
| Delivery | Static HTML with self-hosted fonts and assets replaces CDN React/Babel compilation; build output and preview server are separate from the archived design |
| Beta | Validated pending/success/error/timeout paths are implemented; unconfigured preview truthfully declines to collect email |

## Evidence

The original critique is `AUDIT.md`. Baseline, intermediate, and final captures are kept here so changes can be reviewed without relying on memory.

- Visually inspected desktop at 1440px and mobile at 390px and 320px, including hero, conversation, Brain, permission, and beta states.
- Chromium: no document overflow at 1440, 1024, 768, 390, and 320px. A 720px viewport also passed as a desktop reflow proxy; this is not a claim of testing actual browser zoom controls.
- WebKit and Firefox: mobile rendering inspected and no document overflow at 390px. A focused final pass in all three engines verified the subset font, Brain toggles, permission decisions, browser Back restoration, pause/resume, and absence of page errors; see `cross-browser.json`.
- Keyboard: skip link is first; Space toggles Brain access; permission decisions return focus to the next useful control.
- Replay: finite, interruptible, and complete content is immediately restorable.
- Motion: pause freezes rendered sigils; changing reduced-motion preference stops both engines. Decorative touch-device background processing is omitted, and sigils initialize lazily.
- Signup: required/invalid input, empty destination, success, duplicate-submit guard, and service failure checked using intercepted local responses. No real account contacted.
- JavaScript disabled: headline and complete product conversation remain readable.
- Axe: zero detected violations in the tested state using WCAG 2 A/AA, 2.1 AA, and 2.2 AA rules. Console/page errors: zero in the automated Chromium pass. Results are in `verification.json`.

## Performance

Local Lighthouse 13.4.1 mobile simulation against the static preview:

| Measurement | Initial production build | Refined build |
| --- | ---: | ---: |
| Performance score | 80 | 96 |
| Accessibility score | 100 | 100 |
| Best practices score | 100 | 100 |
| First contentful paint | 1.2s | 1.2s |
| Largest contentful paint | 2.7s | 1.9s |
| Total blocking time | 660ms | 200ms |
| Cumulative layout shift | 0 | 0 |

Reports: `lighthouse-mobile.json` and `lighthouse-mobile-final.json`. Doto's font payload fell from roughly 140KB to 4.4KB by subsetting the actual hero word. Canvas initialization now avoids the touch background and offscreen sigils. Scores vary with hardware and environment; these are laboratory results, not measured visitor Core Web Vitals. SEO remains 63 while intentional preview indexing restrictions are enabled.

## Remaining launch dependencies

**The frontend is ready for review; publication remains blocked on the real beta destination and privacy notice.** Canonical domain, social-sharing metadata, and indexing must be configured with the release destination.

The application examples are adapted fictional HTML from the chosen design, not fresh screenshots or imported components from the native app. The sidebar shape is consistent with the supplied shell references, but this work does not certify pixel-for-pixel native parity or shipping runtime support. Hermes/OpenClaw currently use generic connection glyphs inherited from the source. Verify official marks and release capability claims before publishing.

The initial P0 conversion dependency is therefore openly unresolved. The other audited layout, loading, reading, interaction, and contrast issues have been addressed within the tested scope. No award, complete accessibility conformance, or native-product acceptance is claimed.
