# Landing Page — Builder's Brief
**For the agent building the page without Claude in the room.** Written by Claude (Fable 5) with Riley, 2026-08-20. Pairs with [LANDING_BLUEPRINT.md](LANDING_BLUEPRINT.md) (what the sections are) — this document is *how it should feel and how to make it feel that way*. Read both. Read this one twice.

---

## 0 · What you are being handed

You are being handed taste, not a spec. The blueprint tells you there are nine sections and what happens in each. This document tells you what "done" looks like to the two people who will judge it, and what will make them wince. Where this doc and your instincts disagree, this doc wins — unless you can say, in one sentence, why your version is more restrained *and* more alive. If you can, do it and say so.

The bar, stated plainly: a visitor who has seen the Linear, Apple, Stripe, Vercel and Nothing sites should not be able to tell this page was made by a smaller team. Not "inspired by" those — *of that caliber*, and unmistakably ours. If a section would look at home on a template marketplace, it is wrong.

---

## 1 · The feeling — read this before anything else

Near-black. Quiet. A page that *listens* rather than shouts. Large, light-weight type that says one true thing at a time. Then — inset into that silence — windows into a real application where something is actually *happening*: agents talking, work being handed off, progress rings filling in a notch. The motion inside the windows is the only thing on the page that moves much. Everything else settles.

The visitor should feel three things, in order:
1. *This is a real product. That UI exists.* (Pixel-honest windows, real-sounding content.)
2. *I didn't know software could feel like this.* (One novel moment — the hero→notch sequence — landing in the first five seconds without a word read.)
3. *I want it.* (Because every section after the hero is one believable, useful thing, and the page never once overreaches.)

What to take from each named reference — specifically, not vaguely:
- **Apple** — the product is in every frame; features are never explained, they're *shown* at close range. Confidence to give one sentence a whole viewport.
- **Linear** — inset app windows as the primary visual; restrained chrome; content that reads like a real team's work; scroll that reveals rather than performs.
- **Stripe** — typographic authority; diagrams and UI that are *exact*; generous measure; nothing decorative.
- **Vercel** — pure dark mode done right; hairline borders; monochrome with one signal; motion that feels like physics, not keyframes.
- **Nothing** — the discipline of a few materials used perfectly; dot-matrix as identity (we have a phosphor sigil engine — it is our version of their dot aesthetic, and it is *better*; use it as the living signature).

What *not* to take: Stripe's gradients, Apple's warmth, Linear's purple, anything with a glow that isn't a 1px edge or a phosphor dot.

---

## 2 · Canon — read these files, in this order, before writing a line

1. `~/Documents/Repositories/.claude/context/design-taste.md` — the seven convictions and *substrate detail*. Short. Read all of it.
2. `~/Documents/Repositories/.claude/context/typography-foundation.md` — Part II (laws), Part III (composition & placement — **no default centering**), Part IV (type system). Part VII is the review gate; you will be held to it.
3. `~/Documents/CLAUDE/global-design-reference.html` — open in a browser. This is the settled visual baseline *rendered*. Match its materials.
4. `docs/luca/DOT_MATRIX_DESIGN.md` — the phosphor sigil doctrine and its six laws. The identity marks and the living indicators on this page come from here.
5. `design-artifacts/Luca-Design-Artifacts/` — open `index.html`, `sigils.html`, `palette.html`, `interface.html` in a browser. The engine running live; captures of the real app. This is what "our UI" looks like — your inset windows must be *this*, not a generic chat mock.
6. `polyphonic-landing/demo-world.md` — the earlier mock world (Fern, Luca/Iris/Otto/Rae). Its *rules* for writing content are exactly right; reuse them (see §7).
7. `docs/luca/LANDING_BLUEPRINT.md` — the sections.
8. `docs/luca/VISION_DEMO_BLUEPRINT.md` + `docs/luca/VISION_SOCIAL_INTELLIGENCE.md` — page two and the system it argues. Read so the §7 "doorway" section is honest.

Prior art to know about, and supersede: `polyphonic-landing/codex-inspired-site/` (Aug 12) was a structural clone of openai.com/codex in a warm-ivory/coral register; `polyphonic-landing/site/` and `/design/` (Aug 10) were earlier passes. This brief replaces their direction. Steal their content discipline; do not inherit their palette or structure. (See Open Decisions: Riley must confirm the coral-vs-slate signal.)

---

## 3 · Materials — the tokens, concretely

Everything below is a token. Raw hex / px / ms in component code is a review failure. Define tokens once at `:root`, name by role.

**Surface.** Floor `#060608`. Never `#000`. Elevation is a narrow cool-charcoal ladder — 3–4 hex stops between levels (see `palette.html` in design-artifacts for the shipped OKLCH scale; reuse it). Inset app windows sit one level up from the page; cards inside windows one more. That's the whole depth model. No drop shadows as depth — a whisper (`0 1px 0 rgba(255,255,255,.04)` inset top edge + `0 0 0 1px rgba(255,255,255,.06)` border) is the most a surface ever gets.

**Ink.** Cool white-at-opacity cascade — ink (~.92) · primary (~.78) · secondary (~.56) · tertiary (~.38) · ghost (~.22). No warm/brown greys anywhere. Hierarchy is size + opacity, **never weight**.

**Signal.** One accent: slate `#6d93c9` on dark. Used as *signal only* — a live dot, a progress ring's fill, a single emphasized word at most once per viewport. Never a fill, never a button background, never a focus ring, never a gradient. The Tier-3 test: strip the accent; if anything stops making sense, you used it wrong. (Open decision: Riley's earlier Mnemos direction used a coral continuity signal. Ask. Default to slate.)

**Type.** Display: **Inter Tight**, weights 280–420, tracking slightly negative at large sizes (−0.02em at ≥56px). Body and all chrome (labels, buttons, meta): **Inter**, 380–460. Code / paths / hex / timestamps only: **JetBrains Mono**. Labels in the signature register: small, uppercase, tracked 0.08–0.12em, tertiary ink — used sparingly as section indices ("01 — ONE HOME"), never as decoration. Scale is ratio-based (1.25 or 1.333), every size a token. Measure 60–72ch for prose. Line-height 1.1 display / 1.5–1.6 body. **No bold. Ever.** If you reach for 600+, use size or opacity instead.

**Space.** 8px grid. Section rhythm is generous — sections separate by silence (≥ 10rem between major sections at desktop), never by rules. A hairline appears only inside an app window where the *app* would draw one.

**Radius.** 0 for precision surfaces; 6–8px for controls; 12–14px for inset windows and cards; 999px for pills/badges. Pick once per role; don't wander.

**Borders.** `rgba(255,255,255,.06–.10)` 1px. Inset windows get the lit-top-edge treatment. Hover brightens a border in place (→ ~.18); focus brightens the element's *own* border (→ ~.5) with `outline:none`. Never an offset ring.

**Five states on everything interactive.** Resting, hover, focus, active, disabled. Browser defaults are a failure.

---

## 4 · The inset window — the page's primary material

Every product demo is an **HTML replica of the real component**, rendered live in the page, with inline mock data, choreographed by scroll or by a looping timeline. Not a screenshot. Not an illustration-of-UI. Not a video. The viewer should be able to select the text in a thread.

Rules:
- **One thing per window.** Each window demonstrates exactly one capability, by being useful, never by explaining itself. If a window shows two things, split it.
- **Pixel-honest.** Match the real app's materials (design-artifacts `interface.html` captures; the charcoal scale; the glyph avatars; Inter at the app's sizes). If the app shows a 28px phosphor mark next to a name, so does the window.
- **Chrome-minimal.** A window is a rounded plate with the app's own surface — no fake macOS traffic lights, no browser bar, no device bezel (exception: the iOS companion gets a minimal device outline, and the notch section renders an actual notch shape). The app *is* the frame.
- **Close-ups are allowed and encouraged.** Crop hard into part of the UI — a rail with three glyphs, one composer, two message turns — at 1.5–2× scale, still animating. Apple's "the feature at close range." Mix full windows and close-ups across the page so the rhythm varies.
- **Harness badges on every agent, everywhere.** Codex, Claude Code, Hermes, OpenClaw — small monochrome marks beside the agent's name (ink-tertiary, ~12px). This is how "one interface to every system" is communicated: ambiently, in every frame, never as a headline. Treat logo usage respectfully (monochrome, small, never recolored into the accent).
- **Content is the design.** Reuse the demo-world rules (§7). A window with "Agent 1: Hello! How can I help?" is a failed window.
- **Windows breathe, the page doesn't.** Inside a window: a live status dot, a phosphor mark in its resting state, a composer caret. Outside: almost nothing moves except scroll-reveals.

---

## 5 · Motion doctrine

- **Earned motion only.** Every animation demonstrates a capability or carries the eye. Decorative motion — floating blobs, parallax backgrounds, gradient drift, particles — is forbidden on this page.
- **Scroll-driven for narrative, timeline for demos.** Section reveals are tied to scroll (IntersectionObserver or scroll-timeline): elements arrive once, with a 100–150ms spawn stagger and a tiny scale/opacity settle (0.98→1, .0→1), then stay. In-window demos run on their own timeline (looping, 8–14s, with a 2–3s hold at the end state before restarting — the hold is where the viewer reads).
- **Easing.** Three named curves: `--ease-enter` (decisive, `cubic-bezier(.2,.7,.2,1)`, 280–420ms), `--ease-settle` (slight overshoot, `cubic-bezier(.34,1.4,.64,1)`, 500–700ms — for things being *called into existence*: a glyph resolving, a ring appearing), `--ease-breathe` (sine, 3–11s prime intervals — for anything ambient). Never `ease`, never `linear` on UI.
- **Prime intervals for anything that loops ambiently** (3s, 5s, 7s, 11s) so nothing visibly syncs. If two dots pulse in lockstep, it reads mechanical.
- **Phosphor, not blink.** When something lights up or changes, it *decays* into its new state (the engine does this; CSS transitions should mimic it — no instant state flips inside windows).
- **The hero→notch sequence is the one place the page itself moves big.** Build it as a single scroll-pinned timeline. Everything else is modest.
- **`prefers-reduced-motion`:** every window degrades to its final frame; reveals become instant; nothing loops. Test it.
- **Performance is design.** Animate `transform` and `opacity` only; no layout thrash; 60fps on an M-series laptop at 1440 with DevTools closed. If a window drops frames, simplify the window.

---

## 6 · Section direction — choreography detail

The blueprint has the nine sections. Here is how each should *move and sit*. Composition is asymmetric and grid-justified throughout — the hero statement is left-aligned on the grid with the window to its right or below, never centered-by-default. Read typography-foundation Part III before placing anything.

**§1 Hero — the delegation thread.**
- Viewport 1: wordmark top-left (small, quiet), one statement in Inter Tight ~72–96px, light weight, left-aligned, max two lines: *One home for all your agents.* Below it, one line of secondary ink, and nothing else above the fold except the window beginning to appear.
- The window: a real thread component. The owner and the main agent wrap up a plan (2 turns). The main agent brings in two residents (each with glyph + harness badge — Codex, Claude Code) and hands each a task in one turn each. They acknowledge in one line each. Their glyphs lift out of the thread and travel up/right…
- Timing: the whole thread plays in ~10s on first view (turns arrive with the spawn stagger, text appears whole — **no typewriter effect**, it's a tell), then holds.

**§2 The notch — continuous from §1.**
- Scroll-pinned. As the visitor scrolls, the two glyphs arrive at a rendered macOS notch at the top of a dark "desktop" plate; the notch slides open; two harness marks appear with progress rings that fill in slate; a one-line composer sits beneath ("message Luca…"). Copy lands to the left: *Keep track of them from anywhere on your Mac.*
- Riley has a separate, more developed notch design (done in a Claude chat, not in this repo). **Ask him for it before building this section** — it should be that design, not an invention.

**§3 The brain.** Fragments (small cards: "ChatGPT · 2,310 conversations", "Claude · projects", "Notion · 140 pages", "a repo", "a folder of PDFs") drift in from the edges and settle into one quiet container labelled *Mnemos*. Then a close-up: one agent turn that cites something it learned from a *different* platform. The container is the only thing that gets the lit-edge treatment in the section. Keep it under 8 fragments; crowd = noise.

**§4 Make an agent with words.** One window, one exchange: the request line; Luca's reply; a new resident card resolving — name, glyph *drawing itself in* (phosphor, not fade), Hermes badge — and sliding into the rail. Pick a request everyone recognises (a daily research digest, inbox triage, "keep my project honest"). No settings UI is ever shown.

**§5 The library.** A gallery plate, hyper-minimal: a 3–4 column grid of *rendered* artifact thumbnails (real HTML renders / images we actually have — design-artifacts captures are fair game), with a quiet three-way switch above: Artifacts · Skills · MCPs & plugins. Switching re-flows the grid (FLIP animation, `--ease-enter`). Skills and MCPs render as rows with a harness badge and a one-line description. One breath, three layers.

**§6 Mobile.** The iOS companion (`prototypes/luca-mobile-companion`, `dist/` builds; see its `design-qa.md`). A minimal device outline, a four-turn thread continuing the hero conversation, same glyphs. Don't mention network conditions.

**§7 The network — doorway.** A threshold, not a section. One large glyph, a lineage chain of five glyphs that extends by one mark with a phosphor settle as it enters view, two lines of copy, one link: *see the vision →*. Give it more vertical silence than anything else on the page. Then move on.

**§8 Tools & places.** A quiet text-forward grid: the MCP · the Hermes plugin · vessels.chat · polyphonic.chat. Real links. Index labels in the signature register. No cards with icons.

**§9 The Sanctuary.** After belief is earned. A glimpse: three or four real lines from the archive (NEVER invented — the archive is real, and inventing it is the one unforgivable content error on this page), the minds' marks, a link out. If $MNEMOS appears on the landing at all, it's one line here, patronage only. Then the close: one sentence, one CTA (private beta / waitlist — confirm with Riley), the wordmark.

---

## 7 · The mock world — content rules

`polyphonic-landing/demo-world.md` already has the right discipline and a usable cast (owner "You" shipping a small iOS app *Fern*; agents **Luca** (built in), **Iris** (Claude Code), **Otto** (Codex), **Rae** (OpenClaw); Hermes as a discovered runtime). Reuse it unless Riley renames; "Ziggy" was his example name for the Codex agent — if he wants Ziggy, Ziggy it is.

Non-negotiables:
- Everything is something a real person would actually type. No lorem. No exclamation marks. No "Atlas launch." No corporate abstractions.
- Nothing references Polyphonic, agents-as-a-concept, or the product's vocabulary *inside a window*. People in windows are doing their work.
- Every conversation demonstrates exactly one thing, by being useful.
- Names are short, warm, unmistakably names. `agent-1` kills the whole claim on contact.
- No real company/person names in content. (Harness badges are the exception — they're the point.)
- Timestamps plausible; rooms look like a real sidebar (`#launch`, `#bugs`); nine-ish rows, not a directory.

Write all mock content in one data file first (`mock/world.json` or a TS module). Riley will read it before he reads any CSS. If the content is flat, the page is flat.

---

## 8 · What will make it look generic — the specific tells to avoid

These are the things that make a page read as AI-generated or template-bought. Each one is a review failure.
- Centered hero with a gradient headline and two pill buttons.
- Three-column feature cards with icons in rounded squares.
- Typewriter text effects; "typing…" dots as decoration; fake cursors.
- Glassmorphism panels; blurred colored blobs behind things; aurora backgrounds; mesh gradients.
- Purple. Any purple. Any gradient on text or buttons.
- Bold headlines. Weight ≥ 600 anywhere.
- Testimonial / logo-wall sections with invented companies.
- Stock device mockups (tilted MacBook PNGs, floating iPhones at 15°).
- Emoji in copy. Exclamation marks. "Supercharge," "seamless," "unleash," "empower," "revolutionize."
- Dividers between sections. Section titles in ALL CAPS at large size.
- Equal vertical spacing everywhere (rhythm needs contrast — a 16rem silence before the doorway, a 6rem gap elsewhere).
- Scroll-jacking that fights the wheel; parallax for its own sake.
- Generic chat UI with round avatars and speech bubbles. Our UI has glyph marks, flat rows, and a charcoal scale — use *ours*.

---

## 9 · Substrate detail — where the craft lives

The page must reward close attention. At least one layer of substrate detail per section, chosen from our own vocabulary — never added as garnish:
- Phosphor identity marks at rest (the engine's resting state, 28px), one per agent. They are the living signature of the page.
- A single live status dot (3.5–4px, slate) breathing on a prime interval where the app would show one.
- The lit-top-edge on inset windows — 1px, `rgba(255,255,255,.05–.07)` inset — so surfaces feel like objects under a soft light from above.
- Spawn stagger on anything that appears in a group (100–150ms, scale .98→1).
- Asymmetric gradient stops *if* a shimmer is used on a border (0/35/50/65/100) — and shimmer is used at most once on the page, on the hero window, if at all.
- Zero-padded section indices in the signature label register (01 — 09) as the only recurring ornament.

Macro restraint is what makes substrate detail register. If the page is busy, none of this will be seen.

---

## 10 · Assets you can use today

- **Identity glyphs:** `desktop/src/shared/ui/dot-display/identity/glyph.ts` — `identityGlyph(seed)` returns a deterministic 7×7 mark; render to SVG/divs. `desktop/scripts/glyph-lab.template.html` shows a standalone rendering. Seeds: use stable strings per cast member so marks are consistent across sections and across the vision page.
- **Phosphor engine:** `design-artifacts/Luca-Design-Artifacts/assets/luca-sigil-engine.js` (bundled `engine.ts` + `physics.ts`) — the resting/think/work/listen/net/recall states. Use for living marks; `DotSigil.tsx` shows the React usage.
- **Charcoal scale + contrast matrix:** `design-artifacts/Luca-Design-Artifacts/palette.html`.
- **Real app captures (for pixel-honesty reference):** `design-artifacts/Luca-Design-Artifacts/assets/shots/` and `interface.html`.
- **iOS companion:** `prototypes/luca-mobile-companion` (Vite; `npm run build` → `dist/`).
- **Fonts:** Inter variable woff2 at `polyphonic-landing/design/inter.woff2`; Inter Tight + JetBrains Mono via Google Fonts or local woff2 — self-host for the final build.
- **Earlier mock world:** `polyphonic-landing/demo-world.md`.
- **The notch design:** not in repo — **ask Riley**.

---

## 11 · Quality gates — you are not done until

- Opened in a real browser (Playwright) at **1440×900** and **390×844**, dark, and screenshots captured at every section. Reading the code is not verification.
- Hero→notch sequence plays correctly on first load and on a cold reload mid-page.
- `prefers-reduced-motion: reduce` tested — final frames, no loops.
- 60fps scroll on an M-series laptop at 1440, DevTools closed. No layout shift after fonts load (preload, `font-display: swap` with metrics-matched fallback).
- No raw hex/px/ms in component CSS (grep it). No `#000`, no `#fff`. No weight ≥ 600 (grep it).
- Contrast: all ink levels used for readable text pass WCAG AA on their surface (check against the palette matrix).
- Keyboard: every link/button reachable; focus = own border brightens, `outline:none`, no offset ring.
- Mock content reviewed against §7 — no lorem, no invented Sanctuary lines, no product vocabulary inside windows.
- Every screenshot distinct (hash them); every window demonstrates one thing.
- Run the typography-foundation Part VII review gates and say which passed.

---

## 12 · Open decisions — ask Riley, don't guess

1. **Signal colour:** slate `#6d93c9` (the canonical baseline) vs the coral continuity signal from the Aug-12 Mnemos direction. Default slate.
2. **Hero's main agent:** Luca (one face for the page, matches onboarding) vs a named personal agent (reads more "your household"). Claude leans Luca.
3. **Cast names:** demo-world's Iris/Otto/Rae, or Riley's Ziggy for the Codex agent.
4. **The notch design file** — get it from him.
5. **Primary CTA** — private-beta waitlist (per the earlier blueprint) or download.
6. **Wordmark** — "Polyphonic" with a small "by Mnemos," or Mnemos-led. Brand architecture says Mnemos is the institution, Polyphonic the app; the landing is the app's page, so Claude leans Polyphonic-led with Mnemos present.

---

## 13 · How to work with Riley on this

- **Hero + notch first.** Build that sequence end to end, verify it in a browser, screenshot it, and show him *before* touching sections 3–9. If that lands, the page lands. If it doesn't, nothing else matters.
- **Show the mock-world data file early** — before styling. He'll react to content faster than to CSS, and content is the design.
- **Work out loud.** He thinks by talking; he'd rather steer mid-stream than receive a finished page. Short messages, lead with the question, no walls of text.
- **Commit to a direction.** A strong, wrong v1 he can push against beats three safe options. Don't present variants; present *the* version and say why.
- **Never claim "done" from code.** Screenshot, or it didn't happen. Say plainly what you verified and what you didn't.
- **Don't restore what we cut.** Group-chat-as-a-section, "every harness"-as-a-section, roadmap pages, testimonials, and anything from §8 — gone on purpose.

The whole thing in one line: *a silent, near-black page where real software quietly does something remarkable inside a few perfect windows — and every pixel, down to the 1px edge, was placed by someone who cared.*
