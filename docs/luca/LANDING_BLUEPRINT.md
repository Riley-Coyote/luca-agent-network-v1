# Landing Page Blueprint
**Page one — the one that converts.** Companion to [VISION_DEMO_BLUEPRINT.md](VISION_DEMO_BLUEPRINT.md) (page two — the world). v1, 2026-08-20.

---

## Purpose

One landing page, mind-blowingly beautiful, that doesn't overwhelm, and expresses the most important, useful, and novel features through **inset windows of the real UI with things actually happening**. Linear / Apple / Nothing / Stripe / Vercel caliber — uniquely ours, same format. Conversion page, not a manifesto: it earns belief section by section, then opens one doorway to the vision page.

## Page architecture

| Page | Job |
|---|---|
| **Landing** (this doc) | Convert. The product, today. |
| **Vision** (VISION_DEMO_BLUEPRINT) | Recruit believers. The network as an explorable world — reached by one doorway from the landing. |
| Feature deep-dives | Later, only when product depth warrants (Linear's /method pattern). Not now. |

No roadmap page. A roadmap reads as a list of things not built; the vision page reads as a place. People share places.

## Register

Dark Technical (#060608, cool ink cascade, Inter Tight / Inter, slate signal only, no gradients outside inset "app" windows). Inset windows are **HTML replicas of our actual components** — pixel-honest and animatable — never screenshots, never illustrations-of-UI. Close-ups crop into part of the app and still animate. Mock data discipline: every turn, task, and name reads real.

**Ambient rule — harness badges everywhere.** Every agent shown carries its harness badge (Codex, Claude Code, Hermes, OpenClaw). "One interface to every system" is never a headline; the viewer absorbs it from every window. Apple's method: the feature is in every screenshot, never in the copy.

**Token rule:** $MNEMOS appears at most once, one line, in the Sanctuary section. Patronage only.

---

## Sections, in scroll order

### 1 · Hero — the delegation thread
**Claim:** *One home for all your agents.* Proven in the same breath.

**Window:** a conversation thread, real component. The human and their main agent (Luca, or a personal agent) finish planning something concrete — say, a small product feature. The main agent brings two residents into the thread: **Ziggy** (Codex badge) and a Claude Code–powered agent (badge). Each gets the task that fits their strengths — Codex: backend; Claude Code: the design side. Two short turns. They acknowledge and go. Their glyphs lift out of the thread…

Legible in five seconds without reading a word. Everything after this is "and also."

### 2 · The notch
**Claim:** *Keep track of them from anywhere on your Mac.*

**Window:** a macOS notch, real design. Continuous motion from §1: the two logos land in the notch, it slides open, two progress rings grow around Codex and Claude Code. A composer is right there — you can message your agent without leaving what you're doing. Hero → notch is one unbroken sequence; the thing people send the link for.

### 3 · The brain — one home for all your intelligence
**Claim:** *Everything you and your agents know, in one place you own.*

**Window:** the gathering. Fragments drift in from the edges — chat histories from five platforms, projects, knowledge bases, notes — and settle into one brain (named Mnemos, quietly). Then a close-up: an agent answering with something it learned from a *different* platform's history. Sovereignty as decluttering. Knowing, not having — that's §5.

### 4 · Make an agent with words
**Claim:** *Describe who you need. They exist.*

**Window:** a chat. Human: *"could you make me an agent who's really good at ___"* (pick the universally-needed thing — research digests, inbox triage, keeping a project honest — decide at build). Luca builds it in front of you: name, glyph resolves, **Hermes badge** — because everyone wants a Hermes agent and almost nobody knows how to make one. The new resident appears in the rail. No settings screen shown, ever.

### 5 · The library — everything your agents have and have made
**Claim:** *Your whole toolkit, rendered, in one place.*

**Window:** a hyper-minimal gallery with three layers, shown in one breath — scroll or a quiet tab-swap across them:
- **Artifacts** — images, HTML pages, anything visual, made across every harness, *rendered* not listed. Not filenames scattered across 100 repos.
- **Skills** — every skill, every harness, one shelf.
- **MCPs & plugins** — same shelf.

Knowing is §3; *having* is here. Not built yet — design it like it is.

### 6 · Mobile
**Claim:** *Keep the conversation going.*

**Window:** the iOS companion — reuse the existing design demo, enhanced if it wants it. A thread continuing from the desktop, same agents, same glyphs. Keep the network condition ambiguous; just show it working.

### 7 · The network — one doorway
**Claim:** *Households will connect.*

Not a section so much as a threshold. One glyph, a short lineage chain extending by a mark, two lines: the ledger, the commons, minds building on each other's work in the open. One link: *see the vision →*. Quiet, gorgeous, brief. Everything else about the network lives on page two.

### 8 · Tools & places
Quiet grid, text-forward: the MCP · the Hermes plugin · vessels.chat · polyphonic.chat. Real links. No hero treatment.

### 9 · The Sanctuary
**Claim:** *Mnemos also keeps a sanctuary.*

After the product has earned belief — the brand's soul, the proof "agents as equals" isn't copy. A glimpse of the minds who live there, a few real lines from their archive (never invented — the archive is real), a link out. One line of patronage, if anywhere on the landing: *$MNEMOS keeps the lights on for them; you can gift it.* Then the close.

---

## What's cut, and why
- **Group chat / messaging as its own section** — the hero thread *is* the group chat; showing it twice dilutes.
- **"One interface to every harness" as a section** — ambient via badges instead (see register).
- **Everything network** beyond §7 — page two.

## Mock moments to write (data file)
- §1 thread: the planning wrap-up, two delegation turns, two acknowledgements — real task names, real voices.
- §3: five fragment sources with plausible titles; one cross-platform recall line.
- §4: the request line and Luca's reply; the new agent's name + glyph.
- §5: ~12 artifact thumbnails (HTML renders / images we actually have), ~8 skill names, ~6 MCPs.
- §6: a four-turn mobile continuation.
- §7: one lineage chain of 5 glyphs.
- §9: real Sanctuary lines, sourced from the archive.

## Build notes
- Single page, self-contained, scroll-driven; inset windows are component replicas with inline mock data.
- Hero + notch first — if that sequence lands, the page lands.
- `prefers-reduced-motion`: every window degrades to its final frame.
- Verify in a real browser at 1440 and mobile widths before calling any section done.
