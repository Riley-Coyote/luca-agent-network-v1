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

- Keep the accepted page composition, neutral dark surfaces, Instrument Sans, and dot-matrix display language.
- Polyphonic is one home for agents with continuity, memory, history, and persistent Mnemos identity. Frame agents as collaborators, not task-named tools.
- Rounded Luca glyph is the Polyphonic mark: `assets/brand/polyphonic-solid.svg`, used in header/footer and favicon. Preserve the round stroke caps and joins.
- Existing agent glyph system stays. `assets/brand/agents.html` is an exploratory study Riley chose not to pursue; do not integrate its candidates into the product.
- The simulated rail has Projects and Agents, plus all six runtime marks. Northstar opens a second room-navigation column; selecting a room enters its conversation.
- Mira is the resident formerly called Research. Do not rename her back to a task.
- Conversation and right drawer are separate full-height cards; the conversation toolbar stays within its card. Split, popout, and rail collapse work in the demo.
- Do not reintroduce prototype character avatars or generated background artwork.
- Important illustrative interactions matter; full feature parity with the desktop app is not the goal.

## Next work: website integration and signup

Read `LOVABLE-HANDOFF.md` for the endpoint contract, deployment considerations, and existing audit history. Configure actual signup storage/endpoint and privacy URL in `assets/config.js` or equivalent destination configuration. The current preview does not collect email. Set canonical/social metadata and remove preview indexing restrictions only when publishing. Validate shipping claims, subscription compatibility, and beta availability.

If porting into a framework, preserve listener/timer/canvas cleanup, pause/reduced-motion behavior, detached-window state sharing, project rooms, draft isolation, and keyboard focus. Re-test signup success/failure/duplicates and the key demo flows on the destination domain.

## Provenance and verification

Copied from the active `polyphonic-landing-production` design folder, not an older prototype. The original preview remains available separately. Source assets were compared by hash during transfer. Audit documents describe prior passes; they are historical evidence, not a fresh certification of every interaction. Selected screenshots are included for layout reference. Exploratory logo studies are not production requirements.
