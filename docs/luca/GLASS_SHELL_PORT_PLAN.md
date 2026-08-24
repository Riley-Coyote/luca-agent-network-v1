# Glass Shell Port Plan — study → `luca/v1.1`

**For Sol. This is a zero-judgment implementation contract.**
Written by Riley + Fable, 2026-08-24. Reference implementation:
`design-lab/panes-and-widgets.html` at commit `942d9979a` on branch
`design/lab`, verified by `design-lab/verify-panes.mjs`.

---

## 0 · Rules of engagement

1. **Authority order:** this plan → the study file → nothing. If this plan and
   the study disagree, the plan wins; note the discrepancy in your PR body.
2. **You make no creative decisions.** Every color, duration, easing, radius,
   alpha, label, and string you need is IN THIS DOCUMENT, verbatim. If you
   find a decision this plan did not make, that is a **STOP condition**
   (§10): stop, write down the question, ask Riley. Do not pick "something
   close."
3. **"Looks the same" is decided by measurement, not by eye.** Each chunk has
   acceptance probes (§8). A chunk is done when its probes pass and its
   evidence is captured — not before, and not by resemblance.
4. **When a bounded read is required** (this plan tells you to locate
   something in the app), the plan states what you will find. If you find
   something else, that is a STOP condition — the plan's model of the app is
   wrong and Riley needs to know, not route around.

## 1 · Scope

**IN (build in this order, one chunk = one or more atomic commits):**
- **A** — the Smoke + Onyx palettes, the vibrancy floor, desktop tinting,
  reduced-transparency collapse.
- **B** — motion-token additions.
- **C** — the pane system: drawer deck split, the widget card, in-window
  lift (portal swap), lip resize affordances.
- **D** — "What's alive right now" data binding (bounded).

**OUT — do not build, start, or "prepare for":** OS-level floating windows
(separate Tauri windows), user-authored widget manifests/marketplace,
tiling two live conversations, changing the app's DEFAULT theme, the notch/
Prompt Ghost, mobile, any refactor of files not named in this plan.
**Never touch:** `design-lab/shell-lab.html`, `desktop/src/shared/ui/
dot-display/identity/*`, `trafficLightPosition` in `tauri.conf.json`.

## 2 · Where you work

- Base: `origin/luca/v1.1`. Create branch `agent/glass-shell`.
- `. ./bin/activate-hermit` before anything. Hooks stay on (`just setup` if
  needed). Never `--no-verify`, never amend, never force-push. Stage
  explicit paths. Push the branch when each chunk lands.
- Known gotcha: `just desktop-tauri-fmt` fails in git worktrees — if the
  pre-commit hook trips on Tauri fmt, run it from the main checkout, restage,
  commit (documented in AGENTS.md → Common Gotchas #6).
- Read before writing (in this order):
  1. `desktop/src/shared/styles/globals/conversation-shell.css` — the token
     single-source. Note its warning: **never set semantic tokens as inline
     styles from JS.**
  2. `desktop/src/shared/theme/adaptive-theme.ts` — palette exports
     (`VOID/ASH/INVERSE/GRAPHITE/PAPER_THEME_COLORS`) and the contrast test
     contract described in its comments.
  3. `desktop/src/shared/theme/theme-loader.ts` — how a palette name is
     registered.
  4. `desktop/src/shared/styles/globals/motion.css`,
     `composer-states.css` — the motion ramp and its reduced-motion patterns.
  5. `desktop/src-tauri/src/commands/window_vibrancy.rs` — the existing
     vibrancy command ("`material` accepts the common `NSVisualEffectMaterial`
     names").
  6. `design-lab/panes-and-widgets.html` (branch `design/lab`) — the
     reference implementation, and `design-lab/README.md`.

## 3 · App ground truth (pre-answered so you never have to judge)

| Fact | Implication for you |
|---|---|
| `tauri.conf.json` already has `"transparent": true`, `titleBarStyle: "Overlay"`, `trafficLightPosition {x:16,y:23}` | The window is ready. You change NOTHING in this file. |
| `window-vibrancy = "0.6"` is a dependency; `window_vibrancy.rs` ships a runtime apply/clear command | You call the existing command. You do not add crates or new commands. |
| Text sizes: rem tokens only; CI guard `pnpm check:px-text` fails on any arbitrary text-size literal (px OR rem) | Any new text style uses existing tokens (`text-2xs`, `text-3xs`, stock ramp) or a named token added to `desktop/tailwind.config.js`. |
| The ink ladder defines roles by CONTRAST, and `adaptive-theme.test.mjs` asserts it | New palettes must pass the existing test with their static token values (Smoke/Onyx below already do — floor-vs-ink runtime behavior is checked separately by the probe in §8). |
| Module-level singletons must reset on community switch (`resetCommunityState()` in `features/communities/useCommunityInit.ts`) | Any new module-level state you add (pane layout, lift state) registers a reset there. |
| Reduced-motion house patterns: ambient animation exists ONLY inside `@media (prefers-reduced-motion: no-preference)`; entrances neutralize via 1ms + neutralized keyframes | Copy these patterns exactly (see `motion.css`, `activity-states.css`). |
| Fonts come from `@fontsource*` packages already installed | Never add a Google Fonts `<link>`. The study's font stacks map to what the app already loads. |
| The desktop app only renders with the E2E mock bridge; `just desktop-screenshot` and `desktop/scripts/lab-shots.mjs` exist | Web-layer verification runs through the existing Playwright infra. |
| PR screenshots go through `scripts/post-screenshots.sh` | Never relay-media URLs in PR bodies. |

## 4 · Chunk A — palettes + the vibrancy floor

### A1. Palette exports (verbatim)

Append to `adaptive-theme.ts` beside the existing exports, with these exact
values and doc comments:

```ts
/**
 * Smoke — the palette built FOR dark glass (decided 2026-08-24, from the
 * HIG protocol: glass has no inherent color; it dims and blurs the desktop
 * into a legibility band). Light glowing rail over a near-black velvet
 * reading plane. Cream ink per the house. `inkFaint` is re-solved for the
 * vibrancy floor (see the port plan §A5): roles are contrast solutions.
 */
export const SMOKE_THEME_COLORS = {
  floor: "#17181d",
  navigator: "#17181d",
  surface: "#0e0f13",
  raised: "#1b1c21",
  hover: "#25262b",
  glass: "#08090c",
  recess: "#08090c",
  border: "#25262b",
  borderStrong: "#31323a",
  ink: "#f4f3f0",
  inkMuted: "#c6c5c0",
  inkFaint: "#a6a5a1",
  inkGhost: "#747370",
  focus: "#a6a5a1",
} as const;

/**
 * Onyx — the dark-FLOOR dark mode, drawn Apple's way (HIG Dark Mode: base
 * recedes dimmer, elevated advances brighter). Cards sit on Apple's own
 * published dark ramp (#1C1C1E / #2C2C2E), whose grey chemistry (B=R+2)
 * matches the house linear-dose lean. Floor stays a breath above #000.
 */
export const ONYX_THEME_COLORS = {
  floor: "#0a0a0c",
  navigator: "#0a0a0c",
  surface: "#1c1c1e",
  raised: "#2c2c2e",
  hover: "#3a3a3c",
  glass: "#050508",
  recess: "#131315",
  border: "#303033",
  borderStrong: "#3c3c3f",
  ink: "#f5f4f0",
  inkMuted: "#c6c5c0",
  inkFaint: "#a6a5a1",
  inkGhost: "#757470",
  focus: "#a6a5a1",
} as const;
```

If the existing exports carry fields not listed here (compare against
`INVERSE_THEME_COLORS` — same shape expected), STOP.

### A2. Registration (mechanical)

In `theme-loader.ts`, `"paper"` appears at approximately six kinds of sites:
a name constant, two name arrays, the shiki syntax-theme import map, and two
theme-pair tuples. `grep -n "paper" theme-loader.ts` — expect ≥6 hits. For
each site, replicate for `"smoke"` and `"onyx"`:
- Name arrays / constants: add both names.
- Shiki map: **copy the value from the `buzz` entry verbatim** for both (dark
  syntax theme; do not choose one yourself).
- Theme pairs (light↔dark counterpart tuples): pair `smoke` ↔ `paper` and
  `onyx` ↔ `paper`.
If the file's shape differs from this description, STOP.

Then mirror wherever `PAPER_THEME_COLORS` is consumed (grep it; expect the
adaptive-theme mapping table and possibly a preview list). Display names for
pickers: **"Smoke"** and **"Onyx"** (strings table §9). The app's DEFAULT
theme does not change in this port.

### A3′ AMENDMENT (2026-08-24, supersedes A3's per-theme alphas)

Glass is a THEME-AGNOSTIC MATERIAL SYSTEM — three weights, exactly these:

| Material | Backdrop treatment (native blur + this CSS filter in the study) | Scrim overlay |
|---|---|---|
| `light` | `saturate(210%) brightness(1.14)` | `rgb(250 249 247 / .56)` |
| `neutral` | `saturate(245%) brightness(.68)` | `rgb(9 10 14 / .36)` |
| `dark` | `saturate(235%) brightness(.42)` | `rgb(5 5 8 / .55)` |

- In the app, NSVisualEffectView supplies the blur; the CSS layer paints the
  scrim at the alphas above when glass is on, the whisper when opaque
  (`.15` dark themes, `.12` paper), and `1` under reduced transparency.
- Polarity guard (hard rule): dark-ink themes (paper) take `light` only;
  light-ink themes take `neutral` or `dark`. Theme defaults:
  slate/inverse/smoke → neutral · dragon/onyx → dark · paper → light.
- **DRAGON GLASS** is a sixth registered theme: token-identical to Smoke
  (alias `SMOKE_THEME_COLORS`; do not duplicate the values), default
  material `dark`, display name `Dragon Glass`.
- Appearance settings gain a material picker beside the Glass toggle,
  shown only when the active theme allows two materials. Strings in §9.
- The luminosity-blend construction is retired everywhere.
- Acceptance replaces per-theme checks: for every theme × its allowed
  materials, faint ink ≥ 4.5:1 over the sampled rail (§A6 probe).
  Study reference numbers: neutral 5.45–6.54 · dark 7.79 · light 5.34.

### A3. Shell CSS — the glass states (original — the state mechanics stand;
its per-theme alphas are superseded by A3′)

All of this goes in `conversation-shell.css` (or a new
`glass-floor.css` imported immediately after it — your call is pre-made:
**new file `desktop/src/shared/styles/globals/glass-floor.css`, imported
directly after `conversation-shell.css`** in the same place its siblings are
imported).

The construction, translated from the study to the real window (the real
desktop sits behind the transparent webview, blurred by NSVisualEffectView —
CSS `backdrop-filter` cannot reach it, so the scrim is a plain overlay):

```css
/* The glass floor. Three states, one overlay.
   glass on      → the floor paints at scrim alpha over the vibrancy view
   glass off     → same overlay at whisper alpha = desktop tinting (HIG)
   reduced transparency → solid token, vibrancy cleared (§A4)              */
:root[data-luca-shell] {
  --glass-scrim-alpha: 1;            /* solid by default (non-glass themes) */
}
html[data-luca-glass="on"][data-theme-name="smoke"]  { --glass-scrim-alpha: .36; }
html[data-luca-glass="on"][data-theme-name="onyx"]   { --glass-scrim-alpha: .55; }
html[data-luca-glass="off"][data-theme-name="smoke"] { --glass-scrim-alpha: .84; }
html[data-luca-glass="off"][data-theme-name="onyx"]  { --glass-scrim-alpha: .86; }
@media (prefers-reduced-transparency: reduce) {
  :root[data-luca-shell] { --glass-scrim-alpha: 1 !important; }
}
```

The floor/rail surfaces (today `background: hsl(var(--mn-floor))`) become
`background: hsl(var(--mn-floor) / var(--glass-scrim-alpha))` — **only** the
surfaces that today paint `--mn-floor` (the app body ground and the global
rail). The conversation plane, cards, composer, and every other surface stay
exactly as they are: opaque. If you find more than three selectors painting
`--mn-floor` as a background, STOP and list them.

Where the `data-theme-name` attribute comes from: the theme provider already
stamps the active theme; locate the attribute it writes (expect one of
`data-theme` / `data-theme-name` on `<html>` — read `ThemeProvider.tsx`). Use
the attribute that exists; if none exists, STOP.

### A4. Native vibrancy (mechanical)

On theme/glass change (same place the app applies theme config to the Tauri
backend — `useCommunityInit.ts` region; read it):
- Smoke or Onyx with glass on or off → call the existing vibrancy command
  with material **`"underWindowBackground"`**. If the command's accepted-name
  list (documented in `window_vibrancy.rs`) does not contain that exact
  name, use the one name in its list containing `underWindow`; if none, STOP.
- Any other theme, or reduced transparency → call the clear variant.
- Glass on/off is a new appearance setting: one boolean, persisted where the
  theme choice is persisted, default **on** for Smoke/Onyx. Settings label
  and copy: §9. It stamps `data-luca-glass` on `<html>`.

### A5. The bounded tuning procedure (this is the only "tuning," and it is
mechanical)

The study's scrim values were solved against fake wallpapers; the real
desktop varies. After Chunk A builds, run the probe (§8-A). If Smoke's
measured faint-ink ratio over the rail is **< 4.5:1**, raise
`--glass-scrim-alpha` for that state in steps of **+.04**, re-run, stop at
the first passing value, and commit the measured number with the probe output
in the commit body. Ceiling `.60`; if you reach it without passing, STOP.
You adjust NOTHING else — not the ink, not the material, not the tokens.

### A6. Acceptance (Chunk A)

Web (Playwright against the built app with the mock bridge):
- computed background of the rail resolves to `--mn-floor` at the exact alpha
  for each of the four state combinations;
- `prefers-reduced-transparency: reduce` emulation → alpha 1;
- theme picker shows Smoke and Onyx with the §9 names; switching stamps the
  attribute.
Native (the installed Dev app, `scripts/rebuild-luca-dev-app.sh`):
- screenshot via `screencapture -l <windowid>`, sample a 64×48 empty rail
  patch, compute faint-ink contrast (the sampling/ratio code is in
  `design-lab/verify-panes.mjs` — port it as
  `desktop/scripts/vibrancy-probe.mjs`); Smoke ≥ 4.5:1 over at least two
  different desktop wallpapers (one vivid, one near-white).
Evidence: probe outputs + before/after screenshots in the PR via
`scripts/post-screenshots.sh`.

## 5 · Chunk B — motion tokens (verbatim, additive only)

`motion.css` already owns: instant 120ms, fast 180ms, standard 240ms,
arrival 500ms, `--motion-ease-standard: cubic-bezier(0.25, 1, 0.5, 1)`,
`--motion-ease-arrival: cubic-bezier(0.16, 1, 0.3, 1)`. `composer-states.css`
owns arm 140ms / disarm 90ms. **Do not re-declare any of those.** Add to
`motion.css`, with this comment:

```css
/* Additions for the pane system (glass-shell port). The spring is the one
   overshoot curve in the system — spent rarely: toast entries and the
   lift's pickup. The draw duration is the ring/dial coming to its reading. */
--motion-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--motion-duration-draw: 1.2s;
```

## 6 · Chunk C — the pane system

New feature directory: `desktop/src/features/panes/`. New CSS:
`desktop/src/shared/styles/globals/panes.css`, imported after
`glass-floor.css`. All values below are final.

### C1. The deck (drawer split)

- The right drawer is the component toggled by the header control labeled
  **"Open conversation details"** (locate by that aria-label; expect exactly
  one component; else STOP).
- Wrap the widget card's slot in a `PaneDeck` component:
  grid `grid-template-rows: 1fr` ↔ `0fr`, transition
  `var(--motion-duration-standard) var(--motion-ease-standard)`; inner
  wrapper `min-height:0; overflow:hidden`; the deck unmounts its slot only
  after `transitionend` for `grid-template-rows` (else the collapsed slot
  costs a flex gap). Interruptible (it is a transition, not a keyframe).
- The lip between drawer and widget: 1px row, hit area ±4px via `::after`,
  hover/drag reveal `--mn-border-strong` at instant/standard, cursor
  `row-resize`, `tabindex=0 role=separator aria-orientation=horizontal`,
  arrow keys ±16px, `aria-valuenow` kept current, drag writes a
  `--widget-h` custom property (default `320px`, clamp 170–640).

### C2. The widget card

A card exactly like the drawer card (same header anatomy at the compact
height, same tokens), title **"What's alive right now"** (§9), body = rows
grid `22px 1fr auto`, gap 12px, row padding `10px 4px`, hairline
`--mn-border` between rows, meta column mono + `tabular-nums`, and the
signature footer: left `reads · projects · conversations · activity`
(ellipsizes, never wraps), right = Vektor's identity mark at 12 + `v3`.
Ring: 22×22, stroke 1.5, `r=8.6`, dasharray 54, draw-in by transitioning
`stroke-dashoffset` over `var(--motion-duration-draw)
var(--motion-ease-arrival)` one frame after mount; under reduced motion the
transition is `none`.

### C3. Lift — the portal swap (state must survive)

React owns the tree, so "move the DOM" translates to: the pane's content
renders through **one `createPortal` whose container element is swapped**
between the docked slot and the floating layer — the component never
unmounts, so its state (timers, subscriptions) survives the trip. Acceptance
asserts this: a ticking value visible in the widget continues advancing
after lift and after dock.

Floating panel (`LiftedPane`): `position:fixed; z-index` above all cards;
spawns at the source card's `getBoundingClientRect()`; width/height clamped
300–640 × 210–720; background `hsl(var(--mn-surface) / .82)` +
`backdrop-filter: blur(44px) saturate(190%)` (this one is INSIDE the webview
so backdrop-filter works); border `--mn-border-strong`; radius 10px; shadow
`0 34px 84px rgb(0 0 0/.58)` + the lit edge; deeper shadow while dragging.

Pickup animation (WAAPI, skipped under reduced motion):
`[{opacity:0, transform:"scale(.985) translateY(4px)"},
  {opacity:1, transform:"scale(1.015) translateY(-3px)", offset:.7},
  {opacity:1, transform:"none"}]`, 280ms, `--motion-ease-standard`.
Drag: pointermove writes a target; a rAF loop lerps at factor **.22**
(**1** under reduced motion) writing
`translate3d(...) scale(1.01)`; release bakes the transform into left/top
and settles scale→1 over 160ms standard. Viewport clamps at 4px margins,
re-clamped on window resize. Escape docks. Dock animation:
`scale(1)→scale(.97) translateY(4px)` + fade, 180ms standard, then the
portal container swaps home and the source card plays the app's own land
animation (160ms, 4px, no blur — `message-anatomy.css` pattern).
Dock/close buttons both dock (a widget is never destroyed by close in v1).
Lift state is module-level → register its reset in `resetCommunityState()`.

### C4. States and focus (apply to every new interactive element)

Hover = wash; pressed = deeper wash (+ `scale(.96)` on icon buttons); focus
= **inset `0 0 0 1px hsl(var(--mn-focus))`, never an outline ring** (the
shell's focus law); disabled = ghost ink, no pointer. All transitions at
instant/standard. No new colors, no new radii — existing tokens only.

## 7 · Chunk D — "What's alive" data (bounded)

The card binds four row slots to data the app already holds. Investigation
is bounded to these sources (reading them is expected; inventing data is
forbidden):
- active agent turns / working state: the stores reset in
  `resetCommunityState()` named `resetActiveAgentTurnsStore` and
  `resetAgentWorkingSignal` — follow those imports to their hooks;
- conversations awaiting the owner: the unread/mention state the sidebar
  already renders;
- projects: the project list the rail renders.
Rules: a row renders ONLY fields those sources actually provide; any missing
field renders `—` (em dash), never invented copy; elapsed times derive from
real timestamps and tick on a 15s interval (interval lives in the component,
so the portal swap keeps it alive); the live dot pulses 1.8s inside
`no-preference` only. If fewer than two real rows can be bound, ship the card
with the bound rows plus `—` placeholders and STOP-note which sources were
missing — do not fabricate rows.

## 8 · Acceptance and evidence, per chunk

Every chunk: `just ci` green; `pnpm check:px-text` green; the app builds and
runs via the e2e bridge; screenshots hash-distinct; evidence in the PR via
`post-screenshots.sh`; one atomic commit per logical step, pushed.

- **A:** §A6 probes, four state combinations, two wallpapers, measured
  ratios in the commit body.
- **B:** grep proves no duplicate token declarations.
- **C:** Playwright: split animates (grid-rows transition observed) and the
  collapsed slot costs zero height after transitionend; lift → drag → Escape
  round-trip leaves state intact (**the ticking value advanced through the
  whole trip**); keyboard: lip arrows change `aria-valuenow` by 16; focus
  walk screenshot shows the inset hairline, no outline rings anywhere.
- **D:** with the mock bridge seeded, rows render real seeded data; a field
  with no source renders `—`; `getAnimations()` shows the pulse only when
  motion is welcome.
- Final: rebuild the design lab (`just shell-lab`) and run
  `node desktop/scripts/lab-shots.mjs` — the standing rule: the lab must be
  rebuilt in the same change when `desktop/src` shell surfaces change.

## 9 · User-facing strings (verbatim — do not edit, do not add)

| Where | String |
|---|---|
| Theme picker names | `Smoke` · `Dragon Glass` · `Onyx` |
| Material picker label | `Glass material` |
| Material option names | `Light` · `Neutral` · `Dark` |
| Appearance setting label | `Glass floor` |
| Appearance setting sub-copy | `The floor takes the desktop's colour. Off keeps a whisper of it.` |
| Widget title | `What's alive right now` |
| Widget signature left | `reads · projects · conversations · activity` |
| Widget signature right | `v3` |
| Lifted panel subtitle | `Off the floor · above everything` |
| Lift button tooltip | `Lift this card` |
| Dock button tooltip | `Put it back on the floor` |
| Empty meta value | `—` |

## 10 · STOP conditions (ask Riley; do not improvise)

1. Any value, string, or behavior you need that this plan does not state.
2. A named file/anchor doesn't match this plan's description of it
   (§A2 grep counts, §A3 floor selectors >3, §C1 drawer component, §A4
   material name, palette export shape).
3. §A5 tuning reaches the `.60` ceiling without passing.
4. `adaptive-theme.test.mjs` fails for Smoke/Onyx static tokens.
5. Anything would require touching a file in the **Never touch** list or the
   OUT list.
6. The portal-swap acceptance (ticking state surviving lift) cannot be made
   to pass without unmounting.

*Findings that motivated this plan's constructions (for context, not action):
the luminosity-blend/vibrancy contrast finding and the desktop-tinting
doctrine are recorded in the design-lab README and the study's commit
history (`ff1d493..942d997`).*
