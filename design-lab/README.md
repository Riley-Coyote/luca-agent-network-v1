# design-lab

`shell-lab.html` is the whole Luca desktop shell in one self-contained file —
the real components, the real providers, a seeded scene. Double-click it. No
dev server, no Tauri, no network. For previewing UI explorations, handing the
UI to another agent, and marketing screenshots.

## The design workflow (standing, agreed with Riley 2026-08-23)

**Any agent doing design/UI work with Riley uses this lab.** The loop:

1. Riley opens the lab (Desktop shortcut "Luca Design Lab.html" →
   `/Volumes/LaCie/Luca-Development/worktrees/luca-design-lab/design-lab/shell-lab.html`)
   and screenshots what he wants to point at.
2. The agent changes real components, rebuilds (`just shell-lab`), and
   **verifies with `node desktop/scripts/lab-shots.mjs`** — all three themes,
   DOM-measured geometry, captures inspected by eye before reporting.
3. Riley looks again. Repeat until it is excellent.

**Keep it in sync:** whenever the app shell changes (any commit touching
`desktop/src`), rebuild `shell-lab.html` in the same change. A stale lab is
worse than none — it makes design decisions against a UI that no longer
exists. The durable lab worktree tracks `luca/v1.1`; after a release lands,
fast-forward it and rebuild.

- Scene data (people, rooms, transcript, visit, exchange): `desktop/src/testing/labScene.ts` — edit freely.
- Boot machinery (storage seed, mock bridge, mount): `desktop/src/testing/labEntry.tsx`.
- Build: `desktop/scripts/build-shell-lab.mjs` + `shell-lab.template.html`.
- Themes: `?theme=buzz` (default dark) · `?theme=graphite` · `?theme=catppuccin-latte` (light).

## Related design references

- `design-artifacts/Luca-Design-Artifacts/` (main checkout; also
  `Luca-Design-Artifacts.zip`) — the Aug 6 sigil session: the phosphor engine
  running live, the charcoal palette ladder + WCAG matrix, fourteen animation
  scenes, interface captures. Reference museum, not the working shell.
- `docs/luca/DOT_MATRIX_DESIGN.md` — the sigil engine doctrine and house laws.
- `panes-and-widgets.html` (this folder) — the shell study for widgets, the
  pane system, and the agent's place. **A study, not a fork:** its floor,
  card, ink and type tokens are copied verbatim from `conversation-shell.css`
  and `typography.css`, and its identity marks come from the real
  `glyph.ts`, so only what it *adds* is new — a card that splits, a card
  that holds a widget, cards that tile, and a card that leaves the floor.
  Both palettes are real: Slate (the linear-dose default) and Paper, copied
  from `adaptive-theme.ts`. The Glass toggle expresses the same ladder as a
  tint over the desktop — one material for the floor, white-alpha lifts for
  every rung above it, and the two quietest ink roles re-solved so AA holds.
  Scenes: `?theme=paper`, `?glass=off`, `?tile=1`, `?place=1`, `?lift=1`,
  `?laws=1`. Brief: `docs/luca/EXTENSIONS.md`.
- `visit-variants.html` (this folder) — the structural options explored for
  the visit design before the threshold construction won.

Known noise: six console 404s for `/pow/*` poof-animation assets, which live in
`public/` and cannot be inlined. Harmless.
