# Polyphonic — Lovable handoff

Prepared 9 September 2026. Preserve this page's composition and interactive behavior while connecting email signup. This is a static HTML/CSS/JavaScript implementation with local assets and deterministic fictional Northstar data, not a live agent client.

## Start here

`index.html` and `assets/` are the editable website. `npm run build` produces the deployable `dist/`; `npm start` serves it on localhost:8744. Build/start require Node 20+, no installed dependencies. `npm ci` installs the pinned development verification tools. Do not run historical migration scripts from older copies.

The handoff ZIP includes source, build/preview/check scripts, lockfile, font/brand provenance, and verification receipts. The original design and previous prototypes remain preserved in the working folder outside this package. No accounts, credentials, live agents, or signup records are included.

## Preserve during integration

- Instrument Sans, Fragment Mono and the subset Doto font; the latter contains the hero word TOGETHER only.
- Current neutral materials, headline proportions, full app frame, mobile recomposition, readable first frame and static no-JavaScript fallback.
- Resident companionship and continuity framing. Polyphonic is the home; Luca is a resident; Brain controls context. Do not replace this with generic productivity-tool copy.
- Six branded provider marks and their provenance in `assets/polyphonic/BRAND-SOURCES.md`.
- Main/split/popout conversations, independent drafts, navigation, drawers, runtime selection in Settings, Brain grants, search, guided tour and pause control. The conversation shell now follows the integrated app; see audit/SHELL-ALIGNMENT.md.
- Detached windows use same-origin BroadcastChannel and URL state. Test them on the destination domain. If popups are blocked, the in-page popout remains usable.
- Reduced-motion, hidden-tab and offscreen canvas handling. A framework port must clean up event listeners, observers, timers and canvases on unmount and avoid duplicate initialization.

Use the existing implementation as the reference, rather than asking a generator to recreate it from screenshots. If the destination project requires React, port incrementally and compare each interactive state. Asset URLs must resolve on the destination route. Do not retain loopback URLs in deployed configuration.

## Email signup contract

Set `signupEndpoint` and `privacyUrl` in `assets/config.js`. With an empty endpoint, the preview intentionally does not save or send email.

Prefer a same-origin server endpoint accepting POST JSON:

```json
{"email":"person@example.com","source":"polyphonic-beta"}
```

Return a successful 2xx only after the service accepts the request. Optional response bodies:

```json
{"status":"subscribed"}
{"status":"already_subscribed"}
{"status":"confirmation_required"}
```

The first shows the success state; the second explains that the address is already on the list; the third asks the visitor to confirm their email. An empty successful body is also supported. Return non-2xx for failure. The frontend displays a retry message, prevents concurrent requests and times out after 12 seconds. Editing the address enables a new request after success.

The backend must validate input, handle repeat requests idempotently, protect against abuse, and keep service credentials server-side. Do not log raw addresses into analytics. Connect the actual email workflow and an accurate privacy notice. A form success response alone is not evidence of email delivery.

## Verified locally

- Chromium widths 1440, 1024, 768, 390 and 320: no document overflow.
- WebKit and Firefox focused mobile navigation/popout checks.
- Main app sections, six runtimes, search, drawer, split, expanded and detached chat; focus/Escape behavior; guided tour interruption.
- Draft persistence across navigation, Mira reply routing, repeated conversation submissions and scroll behavior.
- Keyboard controls, accessible labels, reduced motion, pause, no-JavaScript content and zero detected Axe violations in tested states.
- Signup invalid/unconfigured/loading/success/failure paths; duplicate and confirmation responses tested with intercepted local fixtures.
- No page errors or broken HTTP requests in the automated regression runs.
- Lighthouse local mobile simulation: performance 98, accessibility 100, best practices 100; FCP 1.4s, LCP 2.3s, TBT 0ms, CLS 0. These are lab results, not field guarantees. SEO is 66 with intentional preview indexing restrictions.

Receipts live in `audit/`. Automated accessibility checks do not replace a complete screen-reader audit. Cross-browser coverage is focused rather than every permutation of every feature.

## Product claims boundary

The integrated app source supports independent cryptographic resident identity across model/runtime changes (`ResidentSetup.tsx`) and encrypted Brain sources/access grants (`BrainFilesDetails.tsx`). Native Hermes/OpenClaw import/setup surfaces exist. These source checks do not certify every provider's shipping compatibility, subscription entitlement, or all illustrated behaviors end to end.

The demonstration uses fictional presentational components, not exact native captures. Live activity, saved sessions and task dispatch remain separately described. Confirm the release compatibility matrix and beta availability before publishing. Hermes provenance currently uses the official site's Nous favicon, not a verified Hermes-specific vector mark.

## Final checks after Lovable integration

1. Test real signup storage, duplicate submission, confirmation delivery, service failure/retry and any unsubscribe workflow appropriate to the mailing service.
2. Set the real privacy URL and verify its link. Confirm final beta and provider claims.
3. Set canonical URL and social-sharing image/metadata. `siteUrl` is reserved configuration and does not currently generate metadata.
4. Remove preview `noindex, nofollow` and replace `Disallow: /` in `scripts/build.mjs` only when ready to publish.
5. Configure HTTPS and equivalent security headers. The local server uses a self-only connection policy; adapt it deliberately if the actual signup API is cross-origin.
6. Repeat keyboard/mobile/popout checks on the deployed domain. Check real browser zoom and screen-reader operation, and rerun performance after adding third-party services.

Suggested integration prompt: “Integrate this existing Polyphonic page without redesigning it. Preserve its fonts, spacing, responsive layout and deterministic interactive demo. Connect the email form using the contract in LOVABLE-HANDOFF.md, keep secrets server-side, and implement the remaining domain/privacy/metadata configuration. Compare against the included source and rerun the documented checks before publishing.”
