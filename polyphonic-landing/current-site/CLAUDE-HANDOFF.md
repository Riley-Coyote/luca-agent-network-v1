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

**WP-02 · warm, flat, light (9 September 2026).** Typography, palette and flatness now follow the old Polyphonic prototype at `GLOBAL-DESIGN-DOCS/polyphonic-particle-field-landing/`: Inter at 200/300/400 (no weight above 500, the hero set entirely in Inter 200 on two lines, no Doto), JetBrains Mono in spaced caps for meta, one warm ink `rgb(236,232,224)` at .92/.72/.56/.40/.22 over `#0a0a0c` with surfaces `#0d0c0e` / `#121114` / `#17161a`, no borders on cards, panels, the app frame, the email input or the footer, every control the same outlined pill, and the hero field and marquee band rendered in that warm ink with a `#c9a23a` glow at the peaks. Layout, copy, structure and JavaScript behaviour are unchanged. `scripts/email-assets.js` still names the old display face for its canvas render and needs the same swap before email assets are re-rendered.

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
