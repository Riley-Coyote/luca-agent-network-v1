# Polyphonic landing page

Refined from Riley's **Polyphonic Home v3.dc.html**, 9 September 2026. This folder is the editable working copy. The supplied original, earlier website, and application repositories were preserved.

Start with [CLAUDE-HANDOFF.md](CLAUDE-HANDOFF.md) for the current decisions and website integration work. This is the current September 9 page; sibling prototypes are older.

## Run

The preview is running at **http://127.0.0.1:8744/**.

```sh
npm run build
npm start
```

Build and preview use only Node built-ins and need no dependency installation. Node 20+ is sufficient for these two commands. Run commands from this directory. `PORT=8745 npm start` selects a different port if needed. The server binds to loopback and serves only `dist/`.

After changing HTML, CSS, JavaScript, or configuration, rebuild and reload the browser. This is a static production-build preview, without a development runtime or hot reload.

## Edit

- `index.html` — complete semantic page, copy, and deterministic Northstar examples.
- `assets/site.css` — responsive layout, type, materials, interaction states, and motion preferences.
- `assets/site.js` — lower-page Brain grants, permission example, signup state machine, and shared motion controls.
- `assets/demo.js` / `assets/demo.css` — interactive hero app: all sidebar views, conversations, runtime fixtures, shared-context access, progress, drawer, split, expanded and detached chat views. Responses are deterministic and kept only in memory. The detached browser window shares conversation, runtime, progress, and context state over a same-origin `BroadcastChannel` scoped to this demo session.
- `assets/effects.js` — mouse field and lifecycle coordination for the original display engines. Decorative pointer effects are omitted on touch devices; small sigils initialize as they approach the viewport.
- `assets/config.js` — signup endpoint and privacy URL. Empty by default.
- `assets/fonts/` — self-hosted typefaces and their OFL licenses. Doto is subset to the hero word `TOGETHER`; obtain a suitable subset before changing that word.
- The original supplied design remains in the external design-artifacts folder; it is not needed to run this version.
- `audit/` — baseline critique, comparison captures, verification results, and delivery notes.
- `dist/` — generated deployable files; edit the sources instead.

Historical migration tooling is deliberately omitted; build from the editable source files.

The page has no React, Babel, CDN, live-agent, or account dependency. Its complete conversation and marketing content are present before JavaScript runs. The demonstrations never dispatch real tasks or change real access.

## Explore the hero app

Use **Explore the app**, click a provider above the frame, or open any sidebar section. The main conversation accepts typed prompts as well as suggested questions. Try “Could Claude Code and Kimi work on design while Codex handles architecture?”

The header controls open split view, a detached chat, the conversation drawer, and an expanded app view. The detached chat also offers a separate browser window. Escape closes dialogs/drawers, and the expanded view traps keyboard focus until closed. On mobile, the left header control opens navigation; drawers and split conversations use the full available width.

**Play guided tour** visits the five key views. Direct pointer interaction or typing stops the tour. Simulated work progresses while the app is in view; page pause and reduced motion stop that progression. Refresh resets the fixtures. No free-form model responses, native process control, credentials, or live integrations are involved.

See `audit/INTERACTIVE-DEMO.md` for this revision's verification. `npm run verify` covers the marketing page, interactive app, and longer-session release regressions.

See `LOVABLE-HANDOFF.md` for the transfer package and signup contract.

## Beta connection and publishing

The beta destination has not been supplied. The form validates addresses, but with empty configuration it clearly reports that the email was not sent or saved. The preview does not collect email.

For the provided form flow, set `signupEndpoint` to a **same-origin** endpoint that accepts:

```json
{"email":"person@example.com","source":"polyphonic-beta"}
```

A successful 2xx response must mean the request was accepted by the signup service. Non-2xx responses and a 12-second timeout produce a retry state. The frontend prevents concurrent submissions; the service must also validate, rate limit, handle duplicate addresses, and provide the actual email workflow. Set `privacyUrl` to the real privacy notice.

An existing hosted waitlist or download URL can instead be wired to the CTA when Riley supplies it. No backend, account, or mailing service has been invented.

Before public deployment:

1. Connect and verify the real beta destination and privacy notice.
2. Confirm the launch claims and example flows against the shipping app; these are fictional presentational components, not native captures.
3. Set the real canonical domain and social preview metadata. The unused `siteUrl` configuration slot is reserved for that decision; it does not currently create a canonical tag.
4. Remove `noindex, nofollow` from `index.html` and replace the preview-only `Disallow: /` in the build script. Indexing is deliberately blocked until these decisions are complete.
5. Deploy `dist/` to a static host with HTTPS. Carry over or configure equivalent security headers from `scripts/serve.mjs`; adapt `connect-src` only if a verified service requires it.

## Verify

Development checks use pinned dependencies; Node 22.19+ is recommended for Lighthouse.

```sh
npm ci
npx playwright install chromium firefox webkit
npm run build
npm start
# In another terminal:
npm run verify
npm run capture
npm run audit:performance
```

Lighthouse uses installed Chrome; set `CHROME_PATH` if it cannot locate a browser. Verification uses local intercepted signup responses and test-only addresses, never an external signup account.

Read `audit/DELIVERY.md` for the measured results and remaining limits. Browser automation and screenshots complement manual visual inspection; they are not proof of complete accessibility conformance or field performance.
