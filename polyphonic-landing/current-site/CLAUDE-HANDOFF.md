# Current Polyphonic landing page — start here

Snapshot: September 9, 2026, after the rounded Luca logo update. This folder is the current landing page for transfer into the Polyphonic website. Older sibling landing directories are not the source of truth for this work.

## Editable source

`index.html` plus `assets/` are the complete page. The app simulation lives in `assets/demo.js` and `assets/demo.css`. It is static HTML/CSS/JS, not the desktop client and not React. Port from this code rather than regenerating from screenshots.

Run from this folder:

```sh
npm run build
npm start
```

Node 20+; these commands require no dependency install. The server serves `dist/`, so rebuild after edits. Default port is 8744; if the previous design preview is still using it, run `PORT=8745 npm start`. `npm ci` installs pinned verification tools, then `npm run verify` exercises the preview on port 8744. Do not accidentally test an older server. `dist/` and `node_modules/` are ignored.

## Latest decisions to preserve

- Keep the accepted page composition and the dot-matrix display language. Surfaces and type were retuned on 9 September 2026 (see below): warm, flat, light — Inter and JetBrains Mono, not Instrument Sans.
- Polyphonic is one home for agents with continuity, memory, history, and persistent Mnemos identity. Frame agents as collaborators, not task-named tools.
- Rounded Luca glyph is the Polyphonic mark: `assets/brand/polyphonic-solid.svg`, used in header/footer and favicon. Preserve the round stroke caps and joins.
- Existing agent glyph system stays. `assets/brand/agents.html` is an exploratory study Riley chose not to pursue; do not integrate its candidates into the product.
- The simulated rail has Projects and Agents, plus all six runtime marks. Northstar opens a second room-navigation column; selecting a room enters its conversation.
- Mira is the resident formerly called Research. Do not rename her back to a task.
- Conversation and right drawer are separate full-height cards; the conversation toolbar stays within its card. Split, popout, and rail collapse work in the demo.
- Do not reintroduce prototype character avatars or generated background artwork.
- Important illustrative interactions matter; full feature parity with the desktop app is not the goal.

**WP-02 · warm, flat, light (9 September 2026).** Typography, palette and flatness now follow the old Polyphonic prototype at `GLOBAL-DESIGN-DOCS/polyphonic-particle-field-landing/`: Inter at 200/300/400 (no weight above 500, the hero set entirely in Inter 200 on two lines, no Doto), JetBrains Mono in spaced caps for meta, one warm ink `rgb(236,232,224)` at .92/.72/.56/.40/.22 over `#0a0a0c` with surfaces `#0d0c0e` / `#121114` / `#17161a`, no borders on cards, panels, the app frame, the email input or the footer, every control the same outlined pill, and the hero field rendered in that warm ink with a `#c9a23a` glow at the peaks. Layout, copy, structure and JavaScript behaviour are unchanged.

**WP-02b · quiet band, true app mono (9 September 2026).** The marquee band is quiet, not gone: floor background, no hairlines, letters at .55 ink (`level` on the `marquee-crisp` preset in `assets/dot-display.js`), unlit lattice unchanged, no gold in the band. The demo inside the app frame follows the desktop app, which sets its UI in Inter Variable and its mono in Fragment Mono — so `--app-mono` (base.css) puts Fragment Mono back on every mono element in the demo, at the demo's own tracking and case, while the page's own meta stays JetBrains Mono in `.24em` caps. `scripts/email-assets.js` now names Inter 300 for the display line; the shipped email PNGs were not re-rendered.

**WP-02c · the frame is the product (9 September 2026).** Never restyle the app demo. `assets/demo.css` is the product's interior and is kept at its accepted content (plus the `--app-mono` swaps and the interior `font-weight: 400` baseline); `.app-frame` and `.d-popout` pin every token the interior consumes to the app's own values, so a page retune cannot leak in. Only the frame's outer edge — its border and shadow — belongs to the page. Measured against a build of the accepted commit: every interior colour identical (92/92 probes), frame-interior mean pixel difference 2.27 on 0-255 (glyph noise from Instrument Sans to Inter), and 0 style or geometry changes across the 345 elements outside the frame.

**WP-03 · the demo is the app (9 September 2026).** The demo's screens are the app's screens. Rail sections are `PROJECTS` / `MESSAGES` / `RUNTIMES`; Agents is the three-column personal-agent screen (seven fictional residents, each with its runtime's mark, plus a "6 runtimes connected" strip and the Documents / Notebook / Settings detail); Brain is the Connections screen with Northstar counts; Activity is the live-then-`RECENT` screen; project rooms and the conversation drawer take the app's dividers, system lines and section stack. Ziggy is now a direct message alongside Luca, Mira and Luca & Mira. Fixtures stay fictional and in the Northstar world — no resident names from the real app. `assets/demo.css` keeps WP-02c's interior untouched above a single appended WP-03 block that uses the pinned interior tokens; the page outside the frame is pixel-identical to the WP-02c build. Three fixture assertions in `scripts/verify-demo.mjs` were updated (each commented `WP-03`) because the brief deliberately replaced what they asserted.

**WP-04 · the words have a voice (10 September 2026).** The page stopped listing features and started telling one story, in order: the agents move in, Luca remembers, Luca asks Mira in front of you, Codex asks you before it touches a file. Copy is verbatim from `polyphonic-landing/current-site/COPY.md` — that deck, not this file, is the source of truth for every line; do not paraphrase it back. Two cards were re-cut. Agents now lists the five named residents (Luca, Mira, Ziggy, Iris, Wren), each under the mark of the runtime it runs on, with a live dot only on the two that are working. Brain is one agent, not a grid: your question, Luca’s reply, then four `role="switch"` source chips under **Luca can see** — the page’s own outlined pill, filled with `--s3` at ink .92 when on, outlined at ink .40 when off, focus brightening its own border. The Mira column and the `#research-status` branch are gone; the `grants`/`knowledge()` mechanism stayed and only its clauses changed. Each chip still carries `class="grant-toggle" data-agent="luca"` — not a style hook but the selector `assets/demo.js` reads to mirror the grants into the app frame; renaming it silently breaks the demo and `scripts/verify-demo.mjs`. `.brain-response` reserves the tallest reply (146px / 158px under 760) so toggling a chip never moves the chips beneath it. Hero, band caption, product caption, cards 3 and 4 and the beta block are text-only swaps; the meta/OG/Twitter descriptions carry the new hero sub. The app demo frame is untouched. One assertion block in `scripts/verify.mjs` was rewritten (commented `WP-04`) because it named the checkbox grid and the old empty-state line.

## Website integration and signup (wired 2026-09-09)

The page ships as static files at **polyphonic.chat/beta** inside the Polyphonic web app repo (`Riley-Coyote/polyphonic-v2`, `public/beta/`, deployed by Lovable). Rebuild and re-copy after any edit here:

```sh
BASE_PATH=/beta/ PUBLISH=1 \
SIGNUP_ENDPOINT=https://kknchdnrujzheulqzowv.supabase.co/functions/v1/beta-signup \
PRIVACY_URL=https://polyphonic.chat/privacy npm run build
# then copy dist/ over polyphonic-v2/public/beta/ and push main
```

`PUBLISH=1` drops the preview `noindex` tag; `BASE_PATH` rewrites asset URLs; the signup endpoint and privacy URL are written into `dist/assets/config.js` (source `assets/config.js` stays empty). A plain `npm run build` is still the local preview.

Signup backend lives in polyphonic-v2 Supabase: `beta_signups` table, public `beta-signup` edge function (validation, honeypot field `website`, per-IP rate limit, duplicate → `already_subscribed`), and service-role-only `beta-invite`, which sends the download email (`_shared/email-templates/beta-invite.tsx`) through the existing transactional email queue. Share card: `assets/share/polyphonic-beta.png` (source `scripts/share-card.html`); email images: `assets/email/` (source `scripts/email-assets.html`). Both render from the preview server with Playwright.

Copy decisions: no support matrix. The page says "Start with Claude Code or Codex for the best experience" and the marquee reads "One home for …" rather than "Works with …".

## Provenance and verification

Copied from the active `polyphonic-landing-production` design folder, not an older prototype. The original preview remains available separately. Source assets were compared by hash during transfer. Audit documents describe prior passes; they are historical evidence, not a fresh certification of every interaction. Selected screenshots are included for layout reference. Exploratory logo studies are not production requirements.
