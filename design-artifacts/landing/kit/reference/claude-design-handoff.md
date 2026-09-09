# Handoff: Polyphonic landing page (beta)

## Overview
Marketing landing page for **Polyphonic**, the Mnemos Research desktop app where a person's AI agents ("residents") live together: they keep their own identity and memory, share the projects you grant them, can call on each other inside one conversation, and every action is signed. The page introduces this to someone who has never used an agent, shows the real app shell running a short scripted conversation, explains four ideas with working UI fragments, and collects beta sign-ups by email.

Voice: plain, short, certain. Sentence case in prose, lowercase in chrome, caps only inside the dot display. No emoji, no gradients that read as decoration, no claims the build cannot do.

## About the design files
Everything in this bundle is a **design reference built in HTML** — a working prototype of the intended look and behaviour, not production code to ship as-is. The task is to **recreate this page in the target codebase** (Next.js/React, Astro, plain Vite, whatever the site uses) using its own patterns. If no site codebase exists yet, a small static site (Astro or Vite + vanilla TS) is the right weight for this page; the only runtime dependency worth keeping is the dot-display engine (plain JS, included).

`Polyphonic Home v3.dc.html` is the current design. Open it directly in a browser (it needs the sibling `support.js`, `dot-display.js`, `mnemos-scenes.js` and `polyphonic/` folder alongside it). `previous/` holds the two earlier iterations for reference only.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii, motion timings and copy are final unless noted. Recreate pixel-close. The two runtime marks that are drawn glyphs (Kimi Code, Grok) and the generic plug glyph for Hermes/OpenClaw are placeholders until real brand marks are supplied.

## Page structure (top to bottom)

1. **Nav** — sticky, 56px, `rgba(0,0,0,.72)` with `backdrop-filter: blur(22px) saturate(1.5)`, 1px bottom hairline `#232323`. Left: 7×7 dot mark (2px dots, 1px gap; lit `#FAFAFA`, unlit `#2E2E2E`) + "Polyphonic" 15px/500. Centre links (14px, `#7E7E7E`, hover `#FAFAFA`): How it works → `#how`, Works with → `#works`, Beta → `#beta`. Right: mono label `beta · macos` (10px, .16em tracking, uppercase, `#565656`) + button "Get the beta" (32px tall, 14px side padding, 6px radius, `#FAFAFA` on black, 13.5px/500).

2. **Hero** — centred, max-width 1240, top padding `clamp(72px,11vh,128px)`.
   - H1 "Your agents, together." — Instrument Sans 500, `clamp(2.7rem,6.6vw,5.4rem)`, tracking −.042em, line-height .97, `#FAFAFA`, max 14ch.
   - Sub — "Polyphonic is a Mac app where Claude Code, Codex and the other agents you use live in one place. They remember you, share your projects, and can call on each other, with you in the room." `clamp(1.05rem,1.35vw,1.2rem)`, 1.55, `#B4B4B4`, max 54ch.
   - Buttons: pill "Get the beta" (42px, 20px padding, 999px radius, `#FAFAFA`/black, 14.5px/500, hover `#E4E4E4`, active translateY(1px)) and text link "See how it works →" (`#B4B4B4` → `#FAFAFA`).
   - Entrance: each block fades in from 10px below, 420ms `cubic-bezier(.16,1,.3,1)`, 60ms stagger, once.

3. **Live product shell** — max-width 1240, top padding `clamp(48px,7vh,80px)`. Outer frame: 1px `#2a2a2a`, 14px radius, 4px black padding, shadow `0 40px 100px -30px rgba(0,0,0,1), 0 16px 40px -20px rgba(0,0,0,.9)`. Inner: 10px radius, grid `224px minmax(0,1fr)` (rail hidden under 760px), height `clamp(700px,78vh,780px)`, 14px text, ink `#c7c6be`.
   - Rail (black): traffic lights (13px; `#ff5f57 #febc2e #28c840`), search field (`#111`, 33px, 6px radius, "Search everything · ⌘K"), nav rows 37px min-height (Library, New conversation, Agents, Activity, Brain, Settings; 17px icons, 1.5 stroke, square caps), hairline, "DMs" group (Luca selected: `#c8c5b9` bg / `#1b1b19` ink; Research with a live status "reading…"/"answered" and a 5px dot `#5a5a55` → `#A8D2E0`), "Runtimes" group (Claude Code `#c77553`, Codex `#c8c7c0`, Kimi Code, Grok), footer avatar "R · Riley · Personal workspace".
   - Floor: 5px black gutter, conversation card `#101010`, 10px radius. Header 76px "Luca" 17px/600. Thread max 665px, 16px/1.68. User bubble `#222221`, 16px radius, inset highlight. Luca turn: name 14px/600 + time 11px `#93928a`, paragraphs, two "saved session" cards (`#181818`, 9px radius, 22px runtime mark, title/“Saved · 9:38”/subtitle 13px `#aaa99e`), memory receipt line (13px, `#bab9ae`, 1px underline `#474740`). Composer `#171717`, 12px radius, 46px, "Message…" + up arrow; tool icons row below.
   - Caption under frame (13px `#7E7E7E`): "Luca, with Research listening in. Northstar is a worked example; the conversation replays." + mono `polyphonic · current dev shell`.

4. **The band** — full-bleed, `clamp(96px,13vh,132px)` tall, glass `#0A0B0A`, 1px hairlines `#232323` above and below, square corners. Dot-matrix marquee (engine scene `marquee`) scrolling `WORKS WITH · CLAUDE CODE · CODEX · KIMI CODE · GROK · HERMES · OPENCLAW · ANY AGENT THAT SPEAKS ACP · `. Mono caption row below: "works with · agents and providers" / "open acp · hermes · openclaw".

5. **Section title** — "Built for working alongside agents." centred, `clamp(1.9rem,3.9vw,3.1rem)`/500, −.034em, 1.04.

6. **Four rows** (alternating text/artifact, `display:flex; flex-wrap:wrap; align-items:center; gap:clamp(24px,4vw,64px)`; text column `flex:1 1 280px; max-width:40ch`; artifact column `flex:2 1 440px; min-height:clamp(480px,60vh,600px)`, artifact centred). Row spacing `clamp(56px,8vh,96px)`. H3 `clamp(1.5rem,2.4vw,2rem)`/500, −.028em, 1.15; body 16.5px/1.62 `#B4B4B4`; optional "Try it:" hint 13.5px `#7E7E7E`.
   Every artifact card: width `min(100%, 420–440px)`, 1px `#2E2E2E`, 10px radius, `#0E0E0E`, shadow `0 32px 80px -24px rgba(0,0,0,.95), 0 12px 28px -14px rgba(0,0,0,.8)`, 14px text, rows separated by 1px `#232323`, 11–14px vertical padding, 18px horizontal.
   - **Works with the agents you already use.** (text left) — "Agents · 6 connected" list: Claude Code (2 agents · local), Codex (1 agent · local), Kimi Code (ready), Grok (ready), Hermes (2 agents linked as they are), OpenClaw (1 agent linked as it is); each with a 5px `#86D8A8` dot + "connected".
   - **They remember you.** (artifact left) — "Brain" grant matrix: columns Luca / Research; rows Northstar brief.md (project folder), How I like to work (note), Codex session · Sep 6 (saved session), Tuesday's decisions (conversation). Checkboxes are 22px buttons, 5px radius: on = `#FAFAFA` fill with black check; off = 1px `#2E2E2E` outline. **Interactive:** toggling Luca's column rewrites the footer line "Luca · on Northstar, right now" (see State).
   - **They work together.** (text left) — room card "launch · Luca · Research · you": user bubble, Luca 9:44 "Asked her. One question, scoped to the brief.", Research 9:46 "The brief asks for one route from a note to a plan. The empty screen needs a single clear next step.", Luca 9:46 "Back to you. I would add the prompt and hold the rest, which matches what you asked for on Tuesday." Speaker emblems are 22px glass tiles holding a 9×9 generated dot emblem.
   - **You stay in control.** (artifact left) — permission prompt on `#161616`: "Vektor wants to write `src/FirstRun.tsx`" with buttons Allow once (filled) / Deny (outline). Below, a signed activity feed (Research/hermes 9:46, Luca/hermes 9:44, Ziggy/openclaw 9:31), each with mono runtime label, time and "signed ✓" (`#86D8A8` check). **Interactive:** Allow/Deny replaces the prompt with a result line + "Ask again", and prepends a new signed row.

7. **Beta** — centred, min-height `clamp(380px,48vh,520px)`. H2 "Meet your agents." `clamp(2rem,4.4vw,3.4rem)`/500, −.036em. Sub: "Polyphonic is in beta for macOS. Leave your email and I will send you the app as builds are ready." Form: email input (44px, pill, `#0E0E0E`, 1px `#2E2E2E`, focus border `#7E7E7E`) + pill button "Request the beta" → "Sending…" → "Requested". Note line 13px `#7E7E7E`: default "macOS · one email with the app, nothing else." Sign-off "Riley Coyote · Mnemos Research".

8. **Footer** — mark + "Polyphonic", "From Mnemos Research", mono `beta · macos · 2026`.

## The background field (signature element)
A single fixed, full-viewport canvas behind the page (`position:fixed; inset:0; z-index:-1`) running a custom scene (`touch`) on the dot-display engine at a 5px pitch. The page is pure black until the pointer moves. Three layers, all in `Polyphonic Home v3.dc.html` inside `reg()`:

1. **Fluid reveal.** A coarse grid (22px cells) holds a density field `M` and velocity `U,V`. Each frame the pointer deposits density (Gaussian, σ²≈7 over a 9×9 kernel; amount `0.10 + min(1, speed/28)·0.42`) and a little momentum (clamped ±0.5). The field is advected semi-Lagrangian by its own velocity (clamped to 0.6 cells/step), diffused (`0.56 self + 0.11 × 4 neighbours`), decayed (`0.984^k`, `k = dt/38ms`). Density becomes the alpha that reveals what is under it — so the reveal has a wake, drifts, and dissolves like smoke.
2. **Memory graph under the cursor.** ~500 drifting nodes across the viewport; each cursor move (>6 cells, ≥220ms apart) seeds a recall wave at the nearest node that spreads hop by hop (BFS, 210ms per hop). Links brighten with proximity and activation; substrate dither at low value. Charge persists in the engine buffer and decays (`fade(0.92)`).
3. **Formations.** Elements with `data-field="emblems|graph|exchange|ledger"` (the artifact columns) get an illustration drawn in dots around their `[data-card]`, fading in with viewport visibility (smoothed 0.07/frame): four resident emblems in the corners with dotted links to the card (agents); a small living graph with recall waves, hidden where the card covers it (memory); Luca and Research emblems either side with a pulse travelling out, across and back on a 3.6s loop (together); dotted ledger lines above and below the card signing left to right (control). Formation brightness is capped at 0.86 of phosphor; the fluid brightens them further where it passes.

Painting: dots are drawn only where fluid alpha ≥ 0.004 or formation ≥ 0.01; colour interpolates `rgb(42,43,42)` → `rgb(239,239,237)` by charge, then multiplied by alpha so the edge fades to black with no boundary; radius `cell·(0.13 + 0.24·c)·(0.65 + 0.35·alpha)` times a per-dot factor (emblems 1.7, pulses 2.2). Under `prefers-reduced-motion` the engine runs one settled frame only.

Implementation note: the engine is loaded from the component (not `<script>` tags) to guarantee `dot-display.js` runs before `mnemos-scenes.js`; the scene must be registered on `DotDisplay.scenes.touch` before `DotDisplay.mount(root)`. Re-mount when canvases are added; call `settle()` after layout and on resize.

## Interactions & behaviour
- **Live shell loop** (starts when ≥35% of `#preview` is visible; stops and shows the final state when it leaves; never runs under reduced motion). Timeline in ms: 0–900 typing indicator (three 6px dots blinking 1.2s, 200ms stagger); 900→ paragraph 1 types at 20ms/char; 4300 Codex card, 4700 Claude Code card (fade/rise 360ms); 5200→ paragraph 2 at 20ms/char; 7700 memory receipt appears and Research's DM status flips to "answered" (dot `#A8D2E0`); restart at 12600. Paragraphs keep a 27px min-height so nothing jumps.
- **Scroll reveals**: elements marked `data-rv` start at opacity 0 / translateY(26px) and animate to rest over 700ms `cubic-bezier(.16,1,.3,1)` when 12% visible (rootMargin `0 0 -6% 0`), once. Only applied when JS is running (`html[data-rv-ready]`), so no-JS shows everything.
- **Controls**: 90–140ms, `cubic-bezier(.2,0,0,1)`, hover tone change, active `translateY(1px)`. Focus: 2px signal outline (`#E03C2F`) at 3px offset (add in production; prototype relies on browser default).
- **Brain toggles**: `aria-pressed`, keyboard focusable buttons.
- **Permission card**: Allow once → note "Allowed once. Vektor wrote the file and signed it." + new feed row "Vektor · codex · Wrote src/FirstRun.tsx after you allowed it once. · now" on a faint green tint `rgba(134,216,168,.05)`. Deny → "Denied. Vektor was told, and nothing was written." + row "Asked to write src/FirstRun.tsx. You declined; nothing was written." "Ask again" resets.
- **Beta form**: validates `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`. If a `signupEndpoint` URL is configured, POST JSON `{email, source:"polyphonic beta"}`, success → "Thanks. We will be in touch.", failure → "That did not go through. Try again in a moment." If only `signupEmail` is configured, open `mailto:` with the request pre-filled. Neither → "Sign-up is not connected yet." **Production must wire a real endpoint** (Buttondown, Resend, a serverless function) — the prototype stores nothing.
- **Responsive**: content max 1240px, gutter `clamp(20px,5vw,80px)`; rows wrap to one column under ~700px (artifact first when it is the left column); shell rail hides under 760px; band and field are full-bleed at every width.

## State
- `w` viewport width (rail visibility).
- `demo` `{typing, p1, c1, c2, p2, rc}` derived from elapsed time by `demoAt(e)`.
- `grants` `[{a,b} ×4]` → `lucaKnows` string: none → "I have nothing on Northstar yet. Grant me the brief and I will read it before we talk."; brief+note → "You wanted this release kept small, so I held the line on the brief"; note only → "You like releases kept small, so I would hold the line"; brief only → "The brief asks for one route from a note to a plan"; + session → "Codex finished the walkthrough overnight" (or "…; I have not seen the brief itself" when neither brief nor note); + Tuesday → "Tuesday you decided the empty screen needs one clear next step". Sentences joined with ". " and a final period.
- `perm` `'ask' | 'allowed' | 'denied'`.
- `email, busy, sent, note` for the form.

## Design tokens (dark housing)
Colours: bg `#000000`; surfaces `#0E0E0E #161616 #1E1E1E`; hairlines `#232323 #2E2E2E`; text `#FAFAFA #B4B4B4 #7E7E7E #565656`; signal `#E03C2F`; glass `#0A0B0A`, glass hairline `#1C1D1C`, phosphor `#EFEFED`, unlit dot `#1F211F`; resident phosphors Luca `#EFEFED`, Research `#A8D2E0`, Vektor `#E8A33D`, Ziggy `#86D8A8`; runtime marks Claude `#c77553`, Codex `#c8c7c0`.
Type: Instrument Sans 400/500/600 (prose, UI), Fragment Mono 400 (labels 10–11px, .08–.18em, uppercase), Doto 600/900 only inside the display (drawn by the engine here, not set). Body 17px/1.62; small 14.5px; app UI 13.5–16px.
Space: 8px baseline; radii 6px controls, 10px panels, 14px floating frame, 999px pills; section rhythm 96–184px.
Motion: controls `cubic-bezier(.2,0,0,1)` 90–140ms; page `cubic-bezier(.16,1,.3,1)` 260–700ms, once; display continuous.

## Assets
- `polyphonic/claude.png`, `polyphonic/codex.png` — monochrome marks used as CSS masks (colour via `background`).
- Kimi Code, Grok, Hermes, OpenClaw marks — **placeholders drawn as SVG paths**; replace with official marks.
- Polyphonic mark: 7×7 lattice `M`, generated in code (`MARK` array). Resident emblems: generated from the name (FNV-1a → xorshift, mirrored on the vertical axis, 42% density, 9×9) — see `emblem()`; never hand-draw them.
- Fonts from Google Fonts: Instrument Sans, Fragment Mono, Doto.

## Files
- `Polyphonic Home v3.dc.html` — the design. Template between `<x-dc>…</x-dc>`; logic in the `<script data-dc-script>` block at the bottom (class `Component`: engine loader, `touch` scene, demo loop, handlers, `renderVals()` data).
- `support.js` — the prototype's template runtime (needed to open the HTML; not for production).
- `dot-display.js` — the dot-display engine (Display class, built-in scenes, `mount`). Keep in production.
- `mnemos-scenes.js` — brand scenes (`memory`, `headline`); loaded for parity with the design system. The landing page's own scene lives in the component.
- `polyphonic/` — runtime marks.
- `design-system/DESIGN-NOTES.md` — the Mnemos design vocabulary and defaults (materials, tokens, type, motion, voice). Read first; it is written to be dropped in as a project `CLAUDE.md`.
- `design-system/Mnemos Design System (standalone).html` — the full visual guide, self-contained.
- `previous/` — v1 (feature catalog) and v2 (Codex-shaped, static cards) for history; not to be implemented.
