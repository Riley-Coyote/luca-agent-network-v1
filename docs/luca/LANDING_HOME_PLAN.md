# Polyphonic landing — "Home" — the workshop plan

The production landing page, rebuilt from the copy of the August prototype in the Mnemos Research
design language. Work is dispatched in numbered packages (WP-nn) to a build agent; the decisions in
each package were made by the orchestrator with Riley and are not open to the agent.

## Common preamble (every agent reads this first)

**What this page is.** Polyphonic is a Mac app where a person's agents live together. Frame it as a
place for **collaboration**, never as a tool for operating AI. The agents are residents with their own
identity and memory; they work *with* the owner and *with each other* in shared rooms; nobody's voice is
flattened. Luca lives there too and helps the room find its footing. Words that carry this frame:
*together, room, home, under one roof, with you, keeps its own, as itself, signed.* Words that break it
and are banned in new copy: *manage, control (as a verb on agents), conduct, orchestrate, operate,
command, tool, deploy, harness, leverage, unlock, seamless, powerful.* "Owner-controlled" survives only
for the Brain, where it is a fact about permissions.

**The idiom.** The Mnemos Research design system, rev 02, verbatim:
`design-artifacts/landing/kit/DESIGN-RULES.md` (rules) and `kit/Mnemos Design System.dc.html` (the
guide — open it in a browser). The reference register is Linear, Vercel, Resend, Codex, Nothing:
refined, quiet, expensive. Read `docs/luca/LANDING_BUILD_BRIEF.md` for how the page must *feel* to
the two people judging it, and `kit/reference/claude-design-handoff.md` for a previous high-fidelity
build in this idiom (its structure and materials are right; its copy is superseded by this plan).

**Sources of copy.** `kit/source/green-prototype-page.tsx` is the August prototype: every claim on
the new page traces to a sentence there or to `kit/source/Polyphonic_Landing_Page_Blueprint.md`,
*reframed* as the package specifies. Never invent a feature, a number, a runtime or a quotation.
Runtimes that may be named: Claude Code, Codex, Kimi Code, Grok, Hermes, OpenClaw (source: the
handoff's band and `aperture.html`'s strip). Resident names that may appear in scripted
conversation: Luca (concierge), Anima (research), Vektor (builder), Orin (OpenClaw) — from the
prototype's `residents`. Any UI shown is labelled honestly as a prototype frame, not a capture.

**Hard rules.** One writer per checkout: work in your own worktree on your own branch; never
commit to the base branch, never merge, never push. Touch only the files in scope. Tokens, not
raw values (the kit's `:root`). Five states on every control. `prefers-reduced-motion` honoured.
No emoji. No gradients on surfaces, no glow that is not phosphor, no applied grain. At most two
uppercase mono labels visible at once, one word of Doto per view. Verify by looking — screenshots
at real sizes with a real GPU where the look matters (`chromium.launch({headless:false})`, say so
before a window flashes) — never by reasoning. A check you could not run is reported as not run.

**Report format (return exactly this).** 1 Summary (≤ 8 lines) · 2 Files changed (absolute paths,
NEW marked) · 3 Screenshots (absolute paths) · 4 Checks — one JSON object with the keys the package
names · 5 Console (verbatim or "clean except …") · 6 Deviations with reasons · 7 Open questions ·
the commit hash and the served URL. Leave your server running.

---

# WP-01 · HOME, FIRST HALF — hero, the shell, the band, two spreads, the door (2026-09-08, Fable's design; Riley: "we need all of the copy from that but totally redesign the aesthetic … framed more as an app for collaboration … all of your agents under one roof")

**Why.** The August prototype has the best copy and structure of anything written for Polyphonic
and the worst skin: green cast on every surface, bold centred headlines, card grids, three CTAs in
the hero, 16,000px of page. The Claude Design v3 has the right skin and too little to say. This
package pours the prototype's argument into the kit's composition — one statement per screen, an
argument on one side and a real artifact on the other, hairlines instead of boxes, black housing,
Instrument Sans 500 — and reframes every line from *operating agents* to *living and working
alongside them.* Riley reacts to this half before the rest is built.

**Base.** Repo `/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1`, branch
`codex/quickchat` at the commit that contains this plan (`git log -1 -- docs/luca/LANDING_HOME_PLAN.md`).
Worktree + branch `wp01-home`. **Files in scope:** `design-artifacts/landing/home.html` (NEW),
`design-artifacts/landing/tools/home-beats.mjs` (NEW, your capture script). **Untouched:**
`aperture.html`, `chamber.html`, everything in `kit/`, everything else in the repo.

**Facts the build rests on.**
- Kit tokens, type roles, materials, motion registers and colour law: `kit/DESIGN-RULES.md`.
  Fonts: Instrument Sans 400/500/600, Fragment Mono 400, Doto 600/900 — the Google Fonts link in
  the kit README (`kit/reference/claude-design-handoff.md` §fonts / kit `README`): 
  `https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Fragment+Mono&family=Doto:wght@600;900&display=swap`.
- The display engine: `kit/dot-display.js` then `kit/mnemos-scenes.js`, loaded in that order, then
  `DotDisplay.mount(root)` once; `data-cell` 12–16px at hero scale, 4–5px in wells; the `marquee`
  scene for the band. Source: kit README and DESIGN-RULES "Display engine".
- Materials and measurements of a finished page in this idiom (nav 56px frost, hero paddings,
  shell frame radii and shadow, band 96–132px, spread flex numbers, artifact card spec):
  `kit/reference/claude-design-handoff.md` §Page structure. Use its numbers; replace its copy.
- Every sentence of source copy: `kit/source/green-prototype-page.tsx` (JSX text and the `FAQS`,
  `WORKFLOW_STEPS`, `residents` arrays). Claim boundaries: `kit/source/Polyphonic_Landing_Page_Blueprint.md`.
- Brand marks for the band and the agent list: `kit/reference/polyphonic/claude.png`, `codex.png`
  are real; Kimi Code, Grok, Hermes and OpenClaw have no supplied mark — draw a 7×7 lattice glyph
  from the name (the kit's generated-emblem rule) and say so in deviations. Do not fetch logos.

**Decisions.**
1. One file, `home.html`, self-contained except the two kit scripts (relative `kit/…` paths) and
   the Google Fonts link. Dark housing, `--bg:#000`, 1240px content max, page gutter
   `clamp(20px,5vw,80px)`. No framework.
2. **Nav**: sticky 56px frost; left the 7×7 dot mark + "Polyphonic"; centre links *Home · Rooms ·
   Brain · Beta* (anchors to sections in this page); right mono label `beta · macos` and one
   button "Join the beta". Exactly one CTA in the nav.
3. **Hero** (the one Display-scale headline on the page): 
   H1 **"Every agent you work with. Under one roof."** — two sentences, second in `--t1`.
   Sub: **"Polyphonic is a Mac app where the agents you already use — and the ones you create —
   live together. Each keeps its own identity and memory, shares the projects you open to it, and
   works with you and with the others in one room. Luca lives here too, and helps everyone find
   their footing."** One pill button "Join the beta", one text link "See how it works →". One
   mono line under the buttons: `built for macos · claude code · codex · hermes · openclaw · and
   the agents you make`. Centred is permitted here and nowhere else below.
4. **The shell** (hero artifact): the app frame from the handoff §3 rebuilt as HTML — rail with
   *Library, New conversation, Agents, Activity, Brain, Settings*, a DMs group (Luca selected;
   Anima with a live status), a Runtimes group (the six runtimes), footer avatar "R · Riley"; floor
   is a **room**, not a DM: header "launch · Luca · Anima · Vektor · you", and the scripted
   exchange from the prototype's *Launch room* — You: "Can each of you give me the most important
   thing to resolve before the beta?" / Luca: "I'll get us started. Anima, the story; Vektor, the
   proof." / Anima: "The promise should be understood before the architecture: every agent, one
   place, distinct voices." / Vektor: "Show the room itself. The interface is the proof that the
   network is real." Each turn signed (`signed ✓`, phosphor `#86D8A8`). It replays on a loop when
   ≥35% visible, types at 20ms/char, never under reduced motion. Caption below in `--t2`:
   "A room with three residents and you. Prototype frame — not a capture." Luca's line is
   rewritten from the prototype's "I'll coordinate the room" on purpose: same beat, collaborative
   frame.
5. **The band**: full-bleed `marquee` scene, 96–132px, square corners, hairlines above and below,
   text `LIVES WITH · CLAUDE CODE · CODEX · KIMI CODE · GROK · HERMES · OPENCLAW · ANY AGENT THAT
   SPEAKS ACP ·`. Mono caption row: `works with · the agents you already run` /
   `open acp · hermes · openclaw`. This is the page's one marquee and its only drawn dot type.
6. **Section title** (Section scale, centred): **"Built for living alongside your agents."**
7. **Spread A — the Library** (text left, artifact right). H3 **"Everyone you work with, in one
   place."** Body, reframed from the prototype's "Manage every agent from one place": **"See who's
   here, what they're working on, what they remember and how to reach them — every agent, whatever
   runtime it runs on, without opening a different tool for each mind. Bring in the Hermes and
   OpenClaw agents you already have; their native profiles, tools and memory stay theirs."**
   Artifact: the "Agents · 6 connected" list from the handoff §6, one row per runtime, phosphor dot
   + `connected`. No hint line.
8. **Spread B — the Brain** (artifact left, text right). H3 **"All of your working intelligence.
   Finally connected."** (the prototype's own line). Body: **"Bring projects, notes, documents and
   past sessions into one intelligence layer that belongs to you. Each agent sees what you open to
   it — chosen per agent, per source, and revocable — so the room shares context without collapsing
   everyone into one memory. What was recalled, and by whom, is always visible."** Artifact: the
   Brain grant matrix from the handoff §6 (columns Luca / Anima; rows Northstar brief.md, How I
   like to work, Codex session · Sep 6, Tuesday's decisions), interactive toggles rewriting the
   footer line "Luca · on Northstar, right now". Hint in `--t2`: "Try it: tick and untick what
   Luca can see."
9. **The door** (closing beat, Section scale, min-height `clamp(380px,48vh,520px)`): H2 **"One
   home for every agent you work with."** Sub: **"Polyphonic is in private beta for macOS. Leave
   your email and you'll hear from us when the app is ready for you."** Email input + pill
   "Request the beta" → "Sending…" → "Requested"; the form is a prototype and must say so in its
   note line: `macos · one email when it's ready · this page does not store your address yet`.
   Sign-off "Riley Coyote · Mnemos Research".
10. **Footer**: mark + "Polyphonic" · "From Mnemos Research" · mono `beta · macos · 2026`.
11. **Motion**: page register only — `data-rv` reveals 10px/opacity, 260–420ms, 40ms stagger,
    once; controls 90–140ms; nothing in housing over 450ms; all off under reduced motion. No
    background field in this package (the handoff's cursor-fluid canvas is *not* built here).
12. **Composition**: below the hero nothing is centred except the section title and the door.
    Spreads alternate. Cards are separated by real space, never a seam. Squint test must show one
    focal object per screen.
13. Mobile (390px): rail hidden, shell becomes the room alone, spreads stack text-then-artifact,
    band still runs. No horizontal overflow.

**Rules.** As the preamble. Cache-bust the kit scripts `?v=2026-09-08-wp01-1`. Do your own recon
of the kit and the handoff first and write your plan to your scratchpad. Commit on `wp01-home`
with explicit paths; do not merge or push.

**Verification (Playwright; 1440×900, 1280×800, 390×844).** Serve the landing directory on a free
port (not 4193/4194/4195). `home-beats.mjs` captures, at rest and with the real GPU: `home-hero`
(top), `home-shell` (frame in view, mid-replay), `home-band`, `home-spread-a`, `home-spread-b`,
`home-door`, `home-mobile-hero`, `home-mobile-spread`. Assert: no console errors; no horizontal
overflow at any size; H1 computed font-size within `clamp(2.7rem,6.6vw,5.4rem)`; H1 font-family
resolves to Instrument Sans (fonts loaded, not fallback); exactly one `<h1>`; body text contrast
of `--t1` on `--bg` ≥ 7:1 measured; every button has hover/focus/active/disabled styles; the
grant-matrix toggle rewrites its footer line; the room replay reaches Vektor's turn; reduced-motion
context renders the final state with no replay; count of uppercase mono labels in any single
1440×900 viewport ≤ 2.
**Checks JSON keys:** `consoleClean, overflowX, h1Count, h1FontFamily, h1FontSizePx, fontsLoaded,
contrastT1, buttonsWithFiveStates, matrixToggleWorks, replayReachesVektor, reducedMotionStatic,
maxMonoLabelsInView, kitScriptsLoaded, sizesTested`.

**Report:** the report format above. Leave the server running.

**Landed** 2026-09-08 · `1c0528868` fast-forwarded onto `codex/quickchat` · `home.html` + `tools/home-beats.mjs` ·
all checks measured and passing at 1440/1280/390 · deviations accepted: generated 7×7 marks for the four
runtimes without supplied art; chrome mono lowercase except nav/footer to hold the two-label quota against
a sticky nav; rail rows 33px; band cell 7px; thread bottom-anchored. **Open for Riley:** trim the hero sub
to two sentences? · nav mapping Home/Rooms/Brain/Beta. **Next:** WP-02, the second half (Rooms, Continuity,
Luca, the trust layer, who it's for, FAQ).


---

# WP-02 · THE HOUSE — the front door, the Agents room, the Rooms room, the door out (2026-09-08, Fable's design, off the leash; Riley: "i just have to see it to understand … can you just prototype it or build it so i can see it and decide?")

**Read this first, because it overrides the preamble.** Riley has released this page from every
ruleset. `kit/DESIGN-RULES.md` is **not** a rule here — nothing in it binds; the kit's engine, its
type choice and its phosphor hues are used only where this package says so, because I chose them.
The Claude Design v3 and `home.html` are **not** the pattern: no rounded app-frame screenshots with
text beside them, no marquee band. The collaboration frame and the copy sources in the preamble
still hold; the banned-words list still holds. Corrections to the preamble's picture of the app,
from Riley: **Agents** is where you see who lives here. **Library** is what the owner brought from
their machine — files, components, artifacts — not people. Rooms are where they work together.

**Why.** Every version so far is a listing: a photo of the app in a box, a paragraph beside it,
repeated. This one is *walking through the house.* The visitor arrives — the residents' marks light
up one by one and each says a line — and then moves room to room. Each section is built **as that
place**, not as a screenshot in a frame. The real app appears only where it proves something. The
visitor is a guest, not a shopper. Riley decides by looking, so every choice below is made to be
looked at; where the brief and your eye disagree, pick the more alive one and say so in deviations.

**Base.** Branch `codex/quickchat` at the commit containing this section. Worktree + branch
`wp02-house`. **Files in scope:** `design-artifacts/landing/house.html` (NEW),
`design-artifacts/landing/tools/house-beats.mjs` (NEW). **Untouched:** `home.html`, `aperture.html`,
`chamber.html`, everything else.

**Facts the build rests on.**
- The residents' faces are **the app's real identity marks**: `kit/luca-sigil-engine.js` is the
  shipped engine, bundled from the app (`Luca-Design-Artifacts 2/README.md`: "the same code the app
  runs"). `aperture.html` also carries `identityGlyph(seed)` / `glyphSvg()` (a 7×7 mirrored matrix
  from a seed) and `LUCA` with Luca's fixed seed — use whichever renders cleanly at 24px and at
  120px; prefer the engine. Every resident on this page is drawn from a seed, never by hand.
- The six runtime marks are SVG `<symbol>`s in `aperture.html`: `m-claude`, `m-claude-color`,
  `m-openai`, `m-nousresearch` (Hermes), `m-openclaw`, `m-openclaw-color`, `m-grok`, `m-kimi`,
  `m-kimi-color`. Copy the symbol block; do not redraw or fetch logos.
- Phosphor hues, one per mind (from the kit, used because I want them): `#E8A33D` amber,
  `#E0563C` coral, `#A8D2E0` sky, `#B296E8` violet, `#86D8A8` mint, `#EFEFED` for Luca. Assign:
  Luca ivory, Anima sky, Vektor amber, Orin coral, and two more residents for the hall — invent
  none: use `Wren` and `Kit` from `aperture.html`'s cast (violet, mint) with the runtimes it gives
  them.
- Type: Instrument Sans 400/500 for everything a person says; Fragment Mono for the machine's small
  facts (times, "signed", runtime). Google Fonts link as in WP-01. Weights never above 500.
- Copy: the preamble's sources, reframed. The Launch-room exchange as in WP-01 decision 4.
- The lattice material: unlit dots left faintly visible is how the app makes a mark read as
  switched on (`kit/DESIGN-RULES.md` "The lattice" — a fact about the app, not a rule).

**Decisions.**
1. **Floor.** Not pure black: `#070708`, cool. Ink is a cool grey cascade (`#F2F2F0` → `#A9A9A6` →
   `#6E6E6B`). **The only colour on the page is the residents' phosphor, as light** — a lit mark, a
   soft glow around it (radial, low alpha, its own hue), and the resident's name tinted when they
   speak. No coloured fills, borders or buttons. Runtime marks are monochrome except where
   `aperture.html` already gives a colour symbol.
2. **The front door (hero, 100vh, edge to edge, no frame).** A faint unlit lattice fills the
   viewport (dots at a 14–16px pitch, `#141416`). On arrival, three marks light in at different
   positions across the space — not a row, not centred, spread like people in a room — 700ms apart:
   Luca (upper right third), Anima (lower left), Vektor (mid right, lower). Beside each, in small
   type with a mono time, one line in their own voice: Luca **"You're here. Come in."** · Anima
   **"I kept the thread on Northstar while you were away."** · Vektor **"The build's green. Look
   whenever you're ready."** Then the headline arrives, anchored left on the grid, Display scale
   (`clamp(3rem,7vw,6rem)`, weight 500, tracking −.04em, line-height .95): **"One home for all your
   agents."** — "One home" in full ink, the rest in the second grey. Sub, two sentences, max 46ch:
   **"Bring the agents you already use, and the ones you make, into one place. They keep their own
   identity and memory, share the projects you open to them, and work with you and with each other."**
   One pill button **"Join the beta"** and one text link **"Walk through →"** (anchors to §3). No
   runtime logos in the hero. Reduced motion: everything present at once, no sequence.
3. **Agents — "Who lives here."** (the first room). Heading Section scale, left. Intro, from the
   prototype's Agent Library copy reframed: **"See who's here, what each of them is on, what they
   remember, and how to reach them. Bring in the Hermes and OpenClaw agents you already have — their
   native profiles, tools and memory stay theirs — or make a new resident here."** Then **the hall**:
   six residents laid across the full width as large lit marks (96–120px, each in its hue, on the
   faint lattice), staggered high and low, never a grid of cards. Under each: name (Instrument
   500), what they're on right now in one short line (from prototype/aperture material: e.g. Anima
   "reading the Northstar brief", Vektor "packaging build 1.1.0"), and a small runtime mark + mono
   runtime name ("claude code", "codex", "hermes", "openclaw", "grok", "kimi"). Hover/focus: that
   resident brightens and their line lifts; the others dim a step. Mobile: two per row.
4. **Rooms — "Where you work together."** Built as a room you are standing in, full width: the
   exchange runs down the section like a transcript on the wall, each turn with the speaker's lit
   mark in the left margin, name tinted, mono time, `signed ✓` in mono after each agent turn.
   Turns: You: "Can each of you give me the most important thing to resolve before the beta?" ·
   Luca: "I'll get us started. Anima, the story; Vektor, the proof." · Anima: "The promise should
   be understood before the architecture: every agent, one place, distinct voices." · Vektor: "Show
   the room itself. The interface is the proof that the network is real." The turns arrive as the
   section scrolls into view (once; all present under reduced motion). Beside/after it, the line
   **"Talk to one agent. Or bring the whole room together."** and one sentence from the prototype:
   **"Every contribution stays visible, attributable and distinct — nobody's voice gets flattened
   into one stream."**
5. **The door out.** Section scale: **"One home for every agent you work with."** Sub: **"Polyphonic
   is in private beta for macOS. Leave your email and you'll hear from us when it's ready for you."**
   Email + pill "Request the beta" → "Sending…" → "Requested"; note line in mono:
   `macos · one email when it's ready · this page does not store your address yet`. Footer: mark +
   "Polyphonic" · "From Mnemos Research" · `beta · macos · 2026`. Nav: sticky, thin, `#070708` at
   .8 with blur; wordmark left; links *Agents · Rooms · Beta*; one button "Join the beta".
6. **Composition.** One strong left alignment line runs the page. Headlines left. Nothing centred
   except the door out. Big deliberate changes of scale: the hall marks are the largest objects on
   the page after the H1. Real space between things; no hairline card grids anywhere.
7. **Motion.** Arrival choreography in the hero (once); marks lighting is a phosphor rise (the mark
   dithers in over ~500ms, glow follows), not a fade. Everything else: 10px + opacity reveals,
   300–400ms, once. Off entirely under reduced motion, with the final state shown.
8. Brain, Library and Notebook are **not** in this package; leave `#brain` etc. out of the nav.

**Rules.** No invented facts beyond the lines this section writes. Every mark from a seed or the
aperture symbols. No emoji. Tokens for colour/type/space. Five states on controls. Cache-bust
`?v=2026-09-08-wp02-1` on any kit script. Own recon first, plan in your scratchpad. Commit on
`wp02-house` with explicit paths; no merge, no push.

**Verification (Playwright; 1440×900, 1280×800, 390×844; real GPU for the look).** Serve the
landing dir on a free port (not 4193/4194/4195/4211). `house-beats.mjs` captures `house-door-0`
(before any mark lights), `house-door-3` (all three lit + greetings), `house-door-final` (headline
in), `house-agents`, `house-agents-hover` (one resident hovered), `house-rooms-mid` (two turns in),
`house-rooms-final`, `house-exit`, `house-mobile-door`, `house-mobile-agents`. Assert: console
clean; no horizontal overflow; exactly one `<h1>`; H1 font-family Instrument Sans; six lit marks in
the hall each with a distinct hue; the three door marks are drawn from seeds (not images); the
runtime marks are the aperture symbols; hover dims the other five; reduced-motion renders final
states with no sequence; every control has five states; every colour on the page other than the
grey cascade is one of the six phosphor hues (sample computed colours).
**Checks JSON keys:** `consoleClean, overflowX, h1Count, h1FontFamily, hallMarks, hallHuesDistinct,
doorMarksFromSeed, runtimeMarksFromAperture, hoverDimsOthers, reducedMotionStatic,
buttonsWithFiveStates, nonGreyColoursArePhosphor, sizesTested`.

**Report:** the report format. Leave the server running.
