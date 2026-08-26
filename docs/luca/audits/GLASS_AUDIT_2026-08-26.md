# The Two-Glass Audit — why Obsidian & Crystalline look wrong in the app

2026-08-26, read-only. Evidence: live window capture of the installed app,
git archaeology (old glass system vs new), a full component paint map of the
worktree, and a measured computed-style census of the actual built bundle in
a browser harness with the glass rules force-engaged — plus composite proofs
(the same CSS over a luminous backdrop) that isolate the failure.

Worktree audited: `~/.codex/worktrees/e5f6/luca-agent-network-v1` @
`codex/polyphonic-glass-shell-integration` (head `5c8899305`). No code touched.

---

## Verdict

The CSS system mostly *works* — measured, the plate/card/held/panel scrims all
engage with the agreed values, and over a luminous backdrop the shipped CSS
reproduces the lab design almost exactly (see `obsidian-composite-proof.png`).
The app looks wrong for two structural reasons and a pile of coverage bugs:

1. **The backdrop is the wrong physics.** The lab's "one backdrop" was CSS
   `blur(70px) saturate(170%)` of an actual wallpaper. The app's backdrop is
   macOS's `NSVisualEffectMaterial::UnderWindowBackground` — a *semantic*
   material that mixes in its own grey base and desaturates, rendering
   mid-grey mush over a dark desktop (lighter than the theme — inverted
   polarity) and never the deep luminous glass of the mock. CSS cannot reach
   through the webview to correct it: `backdrop-filter` only samples page
   content, never the native layer behind the window. The obsidian plate at
   `0.12` alpha exposes ~88% raw material — the thinner we made the scrim, the
   more of the wrong material we showed.
2. **The app's real anatomy was never treated — only a lab-shaped yield list.**
   Dozens of components paint their own opaque backgrounds inside the glass
   regions. Each one is a mismatched patch. Measured inventory below.

Everything else (half-landed strokeless, role collision, appearance
decoupling, a minifier casualty) compounds it.

---

## Root causes, ranked

### RC1 — Native material ≠ lab physics (the "looks nothing like the mockup" core)

- Old system and new system use the **same** material string
  (`under-window-background`, ThemeProvider `GLASS_VIBRANCY_MATERIAL`); the
  new system added `state:"active"` (glass persists unfocused — good).
- The old system's look survived it because the old recipe was **one heavy
  scrim (0.36–0.55) with every UI surface opaque on top** — the material was
  a dimmed band glimpsed in gaps. The new recipe exposes the material nearly
  raw (plate 0.12) and builds the whole UI out of translucencies stacked on
  it. Raw `UnderWindowBackground` in dark appearance = grey, desaturated,
  polarity-inverted over a dark wallpaper. That grey is what the settings
  rail shows in the live capture.
- **Proof of isolation:** force the same shipped CSS over a vivid gradient
  (`obsidian-composite-proof.png`) and the design appears — thin luminous
  rail, deeper card, held bubbles. The CSS math is right; the native
  backdrop is the broken layer.

**Fix directions (Riley's call — design language):**
- **(a) Recalibrate for the material we have.** Pick the least-mush material
  (candidates in the Rust map: `hud-window`, `fullscreen-ui`, `popover`,
  `sidebar`, `under-window-background`), then re-solve every scrim alpha
  **on-device against the real backdrop** — the panes-widgets study already
  proved lab-solved alphas don't survive the vibrancy floor. Cheapest;
  bounded; result is "macOS-native glass," never the lab's saturated look.
- **(b) In-page wallpaper architecture (the Prompt Ghost recipe).** Read the
  desktop wallpaper, render it *inside* the page as the bottom layer, and
  run the lab's actual filter stack over it. This exactly reproduces the
  mock (it's how the mock works) at the cost of: wallpaper read/refresh,
  window-position tracking for parallax-correct alignment, and it shows the
  wallpaper rather than true see-through (no windows behind). Highest
  fidelity; real engineering.
- **(c) Hybrid:** native vibrancy stays as the base; an in-page tint layer
  adds back saturation/deepening. Middle cost; partial fidelity.

### RC2 — Nothing couples window appearance (Crystalline mud)

No code anywhere sets the NSWindow appearance when the app theme changes
(verified: only a read-only `onThemeChanged` listener exists,
ThemeProvider:790). With macOS in dark mode, Crystalline's light scrims
composite over the **dark** variant of the vibrancy material → grey mud.
The "light-over-dark-mud fix" (plate 0.72) fought the symptom with alpha.
Fix: when a glass theme is active, set the window's effective appearance to
the theme's polarity (Tauri window theme API / NSAppearance), and revert on
opaque themes.

### RC3 — Opaque patchwork: components that paint over the glass (measured)

Census of the built bundle, glass engaged, obsidian. Every one of these
painted opaque (or near-opaque) *inside* the glass shell:

| Element | Paint | Where |
|---|---|---|
| Chat header | `bg-background` solid `#0b0b0e` | channel view top strip (the "header is a different color" defect) |
| Channel header backdrop | `bg-background/80` | `channel-shared-header-backdrop` |
| Project room navigator | `bg-sidebar` solid `#060608` | second column on project routes — the solid slab in the composite proof |
| Active room row | `bg-muted` solid | `project-room-<id>` |
| Message hover pills ×25 | `bg-background/95` + `border-border/70` | rounded-full per-message toolbars |
| Settings option cards | `bg-background/70` + `border-border/70` | `profile-metadata-card`, `profile-identity-card`, and ~14 more `bg-muted*`/`bg-background*`/`bg-card*` chips across settings panels (full list in the paint map) |
| Settings rail footer | `hsl(var(--sidebar-background))` via components.css | glass yield keyed under `[data-testid="app-sidebar"]`; settings rail is `settings-sidebar` → **selector miss**, footer + its ::before gradient stay opaque (the v0.4.22 black strip) |
| Dead selector | `[data-app-top-chrome]` | matches nothing; real testid is `app-top-chrome` (both glass-floor.css and conversation-shell.css carry the same dead selector) |

**Architectural conclusion:** the yield-list approach (enumerate every
painter, clear each) loses against a living app — every new component with a
`bg-*` class is a future mismatched patch. The durable fix is **token-level**:
under the two glass themes, remap what the paint tokens *resolve to*
(`--background`, `--sidebar-background`, `--mn-surface`, `--mn-raised`…) to
translucent values, so every component inherits glass automatically, and keep
explicit rules only for the few true roles (plate, card, held, panels).
That's "add a theme" behaving like adding a theme.

### RC4 — Strokeless universal half-landed

- `--mn-card-edge` is **referenced twice** (conversation-shell.css:371 card,
  :971 day pill) **and defined nowhere** → `box-shadow: var(--mn-card-edge)`
  is invalid at computed-value time → **no replacement edge anywhere, any
  theme** (verified empty on :root; shadows compute `none`).
- The conversation surface still declares `border: 1px solid hsl(var(--mn-border))`
  (conversation-shell.css:341-347) — measured visible in the opaque-theme
  control (buzz). Strokeless never landed on the app's main card in opaque
  themes; it only *looks* strokeless in glass because the glass rules set
  `border-color: transparent`.
- Day pill still carries `border border-border/70` classes; composer border
  transparent ✓ but its rest edge is the missing token.

### RC5 — Role collision: no floor around the card

`ContentSurface` (BuzzThemeSurfaces.tsx:21-26) carries
`data-luca-floor-host` **and** `data-luca-conversation-surface` **on the same
element** on chat routes. The yield rule says "transparent floor," the card
rule says "card weather" — the card rule wins by source order. Consequence:
the card fills the content region edge to edge; the lab's floor-with-8px-lip
anatomy structurally does not exist on chat routes. (Library/Agents/Pulse
hand floor-host to route roots and are closer to correct.) Decide the
intended anatomy, then split the roles onto separate elements.

### RC6 — Deep-panel blur is webkit-only in the shipped CSS

The minifier emitted the deep-panel rule with **only**
`-webkit-backdrop-filter:blur(40px)saturate(150%)` — the unprefixed property
was dropped (build targets). Harness Chromium did not apply the prefixed
form (measured `none`); WKWebView may honor it (Safari's native prefix), but
shipping one prefix is fragile. Fix: ensure both forms survive the build
(vite/lightningcss targets, or explicit doubled declarations).

### RC7 — Smaller, real

- **Accent neutrality gap:** `isFixedNeutralTheme` (ThemeProvider:265-274)
  omits obsidian/crystalline → the stored chromatic accent applies (measured
  blue `#60a5fa` active rows) and the accent picker renders for glass themes
  while every other first-party palette pins neutral and hides it.
  Violates accent-as-signal-only.
- **Fallback asymmetry:** the vibrancy-failure collapse restores root/plate/
  cards only — dialogs, menus, pane float, day pill, own plate, composer keep
  translucent values with no desktop behind them (glass-floor.css:247-272 is
  a strict subset of the reduced-transparency block).
- **Glass held-things rule freezes bubble states:** the own-plate override
  (specificity 0,8,0) outranks hover/reminder/highlight rules in
  message-anatomy.css (0,7,0) — own bubbles lose their hover/reminder/
  highlight states under glass (highlight flashes back to opaque
  plate-strong mid-animation).
- Sidebar pinned header/footer keep `isolation:isolate; z-index:30` from
  components.css under glass (the legacy system reset these; glass doesn't).

---

## What was verified clean

- Theme registration parity is complete (all theme-loader sites, builders,
  preview vars, pairs both directions; no dead registrations).
- The obsidian var ladder (incl. `--mn-recess`) lands on :root; values match
  the design law. Crystalline correctly reuses Paper's ladder.
- Plate/card/held/panel scrim values compute exactly to spec when engaged.
- Vibrancy sequencing (buzz clear → glass apply), request tokens, fallback
  stamping, localStorage hygiene, `state:"active"` all present in the
  shipped JS bundle.
- Own-bubble + composer read correctly as held glass in the census (early
  contrary readings were mount/transition artifacts).
- Browser-safety contract holds: without `data-luca-native`, both themes are
  fully opaque.

## The composite proofs

- `obsidian-composite-proof.png` — shipped CSS, glass engaged, vivid
  gradient backdrop: the lab look appears (and the chat-header slab shows as
  the one opaque band).
- `crystalline-composite-proof.png` — same for light: at plate .72 × card
  .82 the backdrop reads only as a faint tint; with a real blur behind it
  this is "paper with weather," which is the intent — but it means
  crystalline's glassiness is inherently subtle, worth a taste decision.
- `app-window-live.png` — the installed app tonight: grey-mush settings
  rail (raw material), murky .56 panel, opaque black strips. The delta
  between this and the composite proof *is* RC1 + RC3.

---

## The fix plan (app-grounded, for approval — nothing done yet)

1. **Decide RC1 direction** (a/b/c above). Everything else is worth doing
   under any of the three.
2. **Token-level glass** (kills RC3 as a class): under
   `[data-luca-theme="obsidian"|"crystalline"][data-luca-native]`, remap the
   paint tokens to translucent values; delete the per-component yield list
   except true roles. Then a short on-device pass hunts the residue
   (component-local literals), instead of hand-listing every painter forever.
3. **Window appearance coupling** for glass themes (RC2).
4. **Define `--mn-card-edge`** (both polarities) and finish strokeless on the
   conversation surface + day pill classes (RC4) — one bounded commit.
5. **Split floor-host / conversation-surface** per the decided anatomy (RC5).
6. **Build config:** keep both backdrop-filter forms (RC6).
7. **Small fixes:** add glass themes to `isFixedNeutralTheme`; extend the
   fallback block to full parity; re-permit bubble state changes under glass
   (scope the glass override to rest state or carry state variants);
   settings-rail footer selector; delete the dead `[data-app-top-chrome]`
   selectors (both files); isolation/z-index resets.
8. **On-device calibration + acceptance:** scrim alphas re-solved against
   the real material on Riley's wallpaper, contrast probes ≥4.5, seven-screen
   tour, screenshots compared against the mock **before** any "done."

## Process change (binding on me)

"Verified" for visual work = screenshots of the real surface (installed app
via window capture, or the harness with glass engaged) compared against the
agreed values/mock, per screen, before reporting. Unit tests, greps, and
bundle inspection are necessary but claim nothing about pixels. Three bug
classes this audit caught that only eyes/measurement can: an undefined CSS
custom property (silently `none`), a minifier dropping an unprefixed
property, and a native material whose physics differ from the CSS mock.
