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
   **verifies with `node desktop/scripts/lab-shots.mjs`** — nine themes by
   default (the five named + default + vitesse-dark, vesper,
   catppuccin-latte), DOM-measured geometry PLUS the theme-system contract:
   rail === floor continuity, owner-plate legibility (ΔRGB ≥ 4), huddle
   surfaces in the shell's hue family, active-row contrast ≥ 4.5, and an
   in-page switch torture (derived → graphite → paper → void → slate) that
   fails if a departing palette leaves anything pinned on the root.
   Captures inspected by eye before reporting.
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
  Six palettes — Slate, Inverse and Paper from `adaptive-theme.ts`, plus
  three designed from Apple's HIG protocol: SMOKE (glowing rail over a
  velvet plane), DRAGON GLASS (Smoke's palette under the Dark material —
  the blackout preset) and ONYX (Apple base/elevated semantics on their
  published dark ramp #1C1C1E/#2C2C2E, whose grey chemistry B=R+2 matches
  the house linear-dose lean). GLASS IS A THEME-AGNOSTIC MATERIAL SYSTEM:
  three weights — Light (pearl) / Neutral (smoke) / Dark (blackout) —
  chosen within ink polarity (dark themes: neutral or dark; light themes:
  light). Every theme declares a default and integrates by construction;
  the old luminosity plate is retired; every theme desktop-tints when
  opaque, and reduced transparency collapses everything to solid. Glass
  changes the FLOOR ONLY: cards stay opaque and on the ladder. Built to
  native-macOS grade: real traffic lights on the shell's own geometry
  (x=16, y=23), the house motion ramp from `motion.css` (split/tile/place
  choreographed; lift MOVES a card's organs into a draggable panel with a
  lagged-lerp drag, so live tickers survive the trip), five states per
  element with in-place focus, overlay scrollbars per `scrollbars.css`,
  seed-phased identity breath, a drifting wallpaper the probe measures
  through, and full reduced-motion neutralization.
  Scenes: `?theme=slate|inverse|smoke|dragon|onyx|paper`,
  `?material=light|neutral|dark`, `?glass=off`, `?tile=1`, `?place=1`,
  `?lift=1`, `?laws=1`, `?wall=dusk|quiet`. Verify with
  `node design-lab/verify-panes.mjs --pass N` (matrix shots, hash gate,
  ambient-under-reduce assertion, faint-AA-over-material probe).
  Brief: `docs/luca/EXTENSIONS.md`.
- `visit-variants.html` (this folder) — the structural options explored for
  the visit design before the threshold construction won.

Known noise: six console 404s for `/pow/*` poof-animation assets, which live in
`public/` and cannot be inlined. Harmless.
