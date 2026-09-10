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
