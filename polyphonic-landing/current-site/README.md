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

**Warm, flat, light (WP-02, 9 September 2026).** The page is set in Inter — 200 for display, 300 for body, 400 for chrome — with JetBrains Mono for meta labels in spaced caps; Instrument Sans is gone, Doto stays in `assets/fonts/` for the dot-matrix band's lineage. One warm ink, `236,232,224`, carries every text weight (.92/.72/.56/.40/.22) over a floor of `#0a0a0c` and surfaces `#0d0c0e` / `#121114` / `#17161a`; nothing is pure white. Cards, panels, the app frame, the email field and the footer have no borders — separation is surface tone, with the app frame's one soft shadow and the app frame's one soft shadow as the only exception. Every button is the same outlined pill (1px ink at 18%, hover 30%, focus 50% with no outline), and the dot canvases render in the same warm ink with the brightest tenth of their cells pulled toward `#c9a23a`.

**Quiet band, true app mono (WP-02b, 9 September 2026).** The marquee band was the loudest object on the page, so it was quieted rather than cut: it sits on the floor with no hairline above or below, its letters render at .55 ink (`data-level` / the `marquee-crisp` preset in `assets/dot-display.js`, which lowers the lit phosphor endpoint toward the page's own background), its unlit lattice is unchanged, and no gold is mixed into it. Inside the app frame the demo follows the desktop app rather than the page: the app sets its UI in Inter and its mono in Fragment Mono, so `--app-mono` restores Fragment Mono to every mono element in the demo — with the demo's own tracking and case — while the page's own meta keeps JetBrains Mono in `.24em` caps.

**The frame is the product (WP-02c, 9 September 2026).** The page's palette stops at the frame's edge. WP-02 had moved the demo's interior colours onto the page's warm surfaces; that was wrong — the app frame shows the product, and only the product decides how it looks — so everything inside `.app-frame` (and inside the popped-out `.d-popout` chat) is back to the accepted state and is now immune to the page's tokens: both roots redefine `--bg`, `--s1..3`, `--line`, `--line2`, `--t0..3`, `--glass`, `--glass-line`, `--unlit`, `--radius` and `--app-ink/-sec/-surface` with the app's own values, and restate the app's `font-weight: 400` so the page's `body{font-weight:300}` cannot reach in. Two things inside the frame still follow the real desktop app rather than this file's history: its sans is Inter and its mono is Fragment Mono via `--app-mono`. The frame's outer edge is the page's picture-frame, so it keeps WP-02's borderless treatment and one soft shadow. Retune the page freely; leave `assets/demo.css` and the interior rules alone.

**The demo is the app (WP-03, 9 September 2026).** Every screen inside the frame now follows the real desktop app's structure, labels and rhythm, populated with the same fictional Northstar fixtures. The rail's sections are `PROJECTS` (`#` rooms), `MESSAGES` (Luca, Mira, Ziggy, Luca & Mira with a dot or an age) and `RUNTIMES`, over the "Y / You / Personal workspace" footer; the static no-JS rail in `index.html` carries the same labels. Agents is the app's three-column screen — a list column ("7 agents", "Search agents", All/Running/Attention, a quiet "6 runtimes connected" strip so the runtime set stays visible) beside a detail column with the identity glyph, `Runtime · demo · <key>` line, Message pill and Documents / Notebook / Settings tabs over the six resident files. Brain is the app's Connections screen (Repositories / Codex / Claude Code / Files with Northstar counts, Connections · Activity tabs, "Scan again", "Private and local"); the four Northstar grants the page relies on live outside the frame and are untouched. Activity is the app's screen: the two live runs above a `RECENT` list of residents with `READY` / `STARTED` / `STOPPED`. Project rooms gained the date divider and the app's membership lines; the conversation drawer gained the app's section stack (DIRECT MESSAGE · AT A GLANCE · AGENTS · PEOPLE · WORKING CONTEXT · BETWEEN AGENTS). Interaction is unchanged — history, split, drawer, pop-out, detached window, expanded view, guided tour, draft isolation, progress, pause and reduced motion all behave as before — and the colours and type inside the frame are still WP-02c's; new elements read the pinned interior tokens only.

Historical migration tooling is deliberately omitted; build from the editable source files.

The page has no React, Babel, CDN, live-agent, or account dependency. Its complete conversation and marketing content are present before JavaScript runs. The demonstrations never dispatch real tasks or change real access.

## Explore the hero app

Use **Explore the app**, click a provider above the frame, or open any sidebar section. The main conversation accepts typed prompts as well as suggested questions. Try “Could Claude Code and Kimi work on design while Codex handles architecture?”

The header controls open split view, a detached chat, the conversation drawer, and an expanded app view. The detached chat also offers a separate browser window. Escape closes dialogs/drawers, and the expanded view traps keyboard focus until closed. On mobile, the left header control opens navigation; drawers and split conversations use the full available width.

**Play guided tour** visits the five key views. Direct pointer interaction or typing stops the tour. Simulated work progresses while the app is in view; page pause and reduced motion stop that progression. Refresh resets the fixtures. No free-form model responses, native process control, credentials, or live integrations are involved.

See `audit/INTERACTIVE-DEMO.md` for this revision's verification. `npm run verify` covers the marketing page, interactive app, and longer-session release regressions.

See `LOVABLE-HANDOFF.md` for the transfer package and signup contract.

## Beta connection and publishing

See [CLAUDE-HANDOFF.md](CLAUDE-HANDOFF.md#website-integration-and-signup-wired-2026-09-09) for the deploy build flags, the `/beta` destination, and the Supabase signup backend. With no flags, `npm run build` produces the local preview: indexing blocked, no signup endpoint, and the form says so.

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

---

## v3 (14 September 2026)

The page is now the v3 design that replaced the seven-window beta page wholesale. It ships as
static HTML, one stylesheet and one vanilla-JS file, and it makes **no third-party requests** — no
CDN, no Google Fonts, no framework. The design prototype it was ported from built itself in the
browser from React and Babel over unpkg; none of that ships.

**What the page is.** One scroll: hero, a working model of the app shell, five feature sections
(how it works, the agents it works with, memory under one roof, working together, staying in
control), the rooms rail, the commons, the agents' own voices, and the beta signup. Nine sections,
`#top #preview #how #agents #memory #together #control #rooms #commons #voices #beta`.

**How it is built.**

- `index.html` carries the markup and the identity marks. The marks are **pre-rendered**: the
  glyph generator lives in `scripts/glyphs.mjs` and is run at authoring time, and only the finished
  `<svg viewBox="0 0 7 7">` paths are in the page. No glyph code and no public key reaches the
  browser (`verify.mjs` asserts both).
- `assets/site.css` holds the tokens and layout; `assets/site.js` holds the behaviour — the shell's
  rail and chats column, Luca's `morning` replay, the Brain source toggles, the permission strip,
  the rooms rail and the scroll reveals. Both are cache-busted with `?v=20260914-wp18-1`.
- Fonts are local and preloaded: `assets/fonts/instrument-sans.woff2` (variable 400–700) and
  `assets/fonts/fragment-mono.woff2`. Inter, Doto and JetBrains Mono remain in the repo with their
  licences but are no longer loaded by the page.
- The old page's files are gone: `assets/base.css`, `assets/demo.js`, `assets/demo.css`,
  `assets/effects.js`, `assets/luca-sigil-engine.js`, `assets/dot-display.js`,
  `assets/mnemos-scenes.js`, `assets/brand/**` and `scripts/verify-demo.mjs`.

  **This breaks the `polyphonic-landing/home/` mock**, which is a separate page: its `serve.mjs`
  mounts `/assets/` from this folder, and its `index.html` loads `/assets/base.css`,
  `/assets/luca-sigil-engine.js` and `/assets/brand/polyphonic-solid.svg` — all three now 404. Its
  `/assets/site.css` still resolves but is this page's stylesheet, not the token set it was built
  on. `home/` needs its own copies of those files, or its own decision; WP-18's scope was
  `current-site/**` only, so it was left alone.

**Motion.** The replay runs **once**, when the shell first scrolls into view, and leaves the
finished state behind. Every paragraph's height is reserved before it types — the typing dots and
the typed text are absolute overlays on an already-sized box — so the conversation frame does not
move while it plays (measured: 480px before, during and after). The rooms rail is one rAF chain at
a constant ~19 px/s; it ignores scroll, does not pause on hover, and does not speed up when a
backgrounded tab comes back. Under `prefers-reduced-motion: reduce` all of it collapses: reveals
are shown at once, the rail is static, and the replay's finished state is there from the start.

**The prototype's ambient dot field is not ported.** Measured on the prototype at 1440 @2x, its
fixed full-page canvas costs a p95 of 2.5ms and a max of 9.4ms per rAF callback, against the
0.5ms/frame budget this page was held to (mean 0.29ms). The port's own rAF work — the rooms rail
alone — measures p95 0.1ms, max 0.2ms. `assets/dot-display.js` and `assets/mnemos-scenes.js` were
deleted with it. The page runs no canvas at all.

**Three deviations from the prototype, all legibility.**

1. Below 640px the three nav text links hide and the "Get the beta" pill stays, pointing at
   `#beta`. The prototype pushed them off-screen below ~550px.
2. Faint text is raised for contrast, in two places. The prototype's `#565656` body-side faint
   text (`--t2`/`--t3`) was to become `#7E7E7E`, but that measures 4.46:1 on the `#161616` card
   ground the feed rows actually sit on, so the token is `#848484` — measured 5.62 on `#000`,
   5.16 on `#0E0E0E`, 4.84 on `#161616`. Inside the shell, `--mn-ink-faint` goes from the app's
   own 50.6% lightness to 54%, because at 50.6% the selected chat row's two labels measure 4.43:1
   on its `#1f1e1e` ground (axe agrees); at 54% they measure 4.86:1. Nothing else changes colour.
3. Focus is `:focus-visible` only; the prototype's ring on mouse click is gone.

**Build and publish.** Unchanged in shape:

```sh
npm run build                       # local preview: indexing blocked, no signup endpoint
BASE_PATH=/beta/ PUBLISH=1 \
  SIGNUP_ENDPOINT=https://... \
  PRIVACY_URL=https://polyphonic.chat/privacy npm run build
```

`BASE_PATH=/beta/` rewrites `assets/` references in `index.html`, `site.js` and `site.css`. It is
proved by serving `dist/` under a `/beta/` prefix and checking every request returns 200
(`beta_prefix_build` in the checks).

**Verify.** `scripts/verify.mjs` was rewritten for this page and takes its origin from
`VERIFY_ORIGIN` (default `http://127.0.0.1:8744`), so no one has to edit a port into the file:

```sh
PORT=8749 npm start
VERIFY_ORIGIN=http://127.0.0.1:8749 npm run verify
```

It measures, in a real browser: third-party requests at five widths, a clean console, no
horizontal overflow, the phone nav, that both fonts really load (by `measureText`) and that cold-load
CLS stays near zero, the replay running once without moving the frame, rail and project selection,
the chats column, conversation switching, the shell breakpoints, the Brain toggles, the permission
strip, the rooms rail's speed and its indifference to hover and to a hide/show, the reveals,
reduced motion, the contrast of every text node, axe, the whole signup contract against intercepted
fixtures, the links and metadata, and that no glyph code or 64-hex key ships. `verify-demo.mjs` is
gone from the chain.
