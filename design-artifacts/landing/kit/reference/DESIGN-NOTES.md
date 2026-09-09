# Mnemos Research — design notes

Brand: **Mnemos Research** (parent) · **Polyphonic** (desktop app) · **mnemos-continuity** (the open MCP layer).
Canonical guide: `Mnemos Design System.dc.html` (rev 02). Engine: `dot-display.js` + `mnemos-scenes.js`.

## How to read this file

This is a vocabulary and a set of defaults, not a compliance list. The goal is work indistinguishable from the best of Linear, Vercel, Resend, Codex, Nothing — refined, quiet, expensive-feeling — with the Mnemos materials integrated elegantly and sparingly. When a "rule" below gets in the way of that quality, the quality wins. Nothing here is a hard prohibition unless it is in **What still breaks it** at the bottom, and even that list is short on purpose. Use judgement; don't ask permission to break a default.

## Materials

Three, kept distinct.

- **Housing** — opaque, monochrome, still. Structure, chrome, controls, prose.
- **Glass** — translucent, blurred, edge-lit by one hairline. For things that float or are inset.
  - *Frost* (overlays, menus, sticky bars): `blur(22px) saturate(1.5)`, 1px `--frost-line`, `--lift` shadow.
  - *Smoked* (inset panels): `blur(28px)`, 1px `--smoke-line`, no shadow.
  - Opaque is the usual answer.
- **Display** — the dot lattice on `--glass`. Charge persists between frames and decays. Doto is its native face.

The editorial spread (display well one side, argument the other, corner labels on the glass) is a good pattern for long-form pages. It is one pattern, not the only one.

## Tokens

```css
:root{
  --bg:#000000; --s1:#0E0E0E; --s2:#161616; --s3:#1E1E1E;
  --line:#232323; --line2:#2E2E2E;
  --t0:#FAFAFA; --t1:#B4B4B4; --t2:#7E7E7E; --t3:#565656;
  --sig:#E03C2F;
  --frost:rgba(255,255,255,.055); --frost-line:rgba(255,255,255,.10);
  --smoke:rgba(14,14,14,.72);     --smoke-line:rgba(255,255,255,.07);
  --lift:0 24px 60px -22px rgba(0,0,0,.8);
  --glass:#0A0B0A; --phos:#EFEFED; --glass-line:#1C1D1C; --unlit:#1F211F;
  --r-ctl:6px; --r-panel:10px; --r-surface:14px;
  --pad:clamp(20px,5vw,80px);
  --ease-ctl:cubic-bezier(.2,0,0,1); --ease-page:cubic-bezier(.16,1,.3,1);
}
[data-housing="light"]{
  --bg:#FFFFFF; --s1:#F0F0EE; --s2:#E9E9E6; --s3:#E1E1DD;
  --line:#E3E3E0; --line2:#D3D3CF;
  --t0:#0C0C0C; --t1:#4A4A48; --t2:#757571; --t3:#9C9C97;
  --sig:#CE2E1C;
  --frost:rgba(255,255,255,.62); --frost-line:rgba(0,0,0,.07);
  --smoke:rgba(255,255,255,.74);  --smoke-line:rgba(0,0,0,.06);
  --lift:0 20px 48px -20px rgba(0,0,0,.18);
}
```

Dark housing is the default for product, app, decks, web. Light for research, long-form, print. Either is fine when it serves the page.

## Colour

Neutral carries. Chroma has three established roles, and these are the first places to reach for colour:

1. **Signal** — one red. `#E03C2F` on dark, `#CE2E1C` on light. Live, recording, destructive, error. Works best when rare.
2. **Phosphor** — identity, emitted. One hue per mind: `#E8A33D` `#E0563C` `#A8D2E0` `#B296E8` `#86D8A8`, default `#EFEFED`. Most at home as light on glass.
3. **Planes** — bone `#E9E5DD`, clay `#A8523C`, moss `#464E44`. Full-bleed fields behind type, mostly in marketing.

Restraint with colour is the house style. Soft tonal atmosphere (a dark vignette, a faint cool cast, low-chroma depth behind a product shot) is fine on marketing pages when it is quiet and the page still reads monochrome first. Avoid saturated multi-stop gradients and glows that read as decoration.

## Imagery

The display well is the brand's own image and the first thing to reach for. It is not the only thing. Product screenshots, rendered materials, abstract atmosphere, generated studies and real photography are all available when they raise the page. Prefer images that feel machined and quiet over ones that feel stock.

## Type

Three voices. Instrument Sans (400/500/600) is the person talking. Fragment Mono (400) is the machine stating a fact. Doto (600/900) is the display speaking — inside a well, one word of a headline, a live readout. Doto is strongest when rare; treat one instance per view as the default, not the ceiling.

| Role | Spec |
|---|---|
| Readout | Doto 900 · tabular · 18px–2.3rem |
| Display | `clamp(2.7rem,6.6vw,5.4rem)` · 500 · −.042em · 0.97 |
| Section | `clamp(1.9rem,3.9vw,3.1rem)` · 500 · −.034em · 1.04 |
| Statement | `clamp(1.15rem,1.9vw,1.45rem)` · 500 · −.02em · 1.45 |
| Title | `1.1rem` · 500 · −.02em · 1.28 |
| Body | `17px` · 400 · 1.62 · max 68ch |
| Small | `14.5px` · 400 · 1.6 |
| Label | `9.5–10.5px` mono · .16–.18em · uppercase |

Tracking tightens as size grows. Sans is not letterspaced positively. Mono stays small and out of prose. Over-labelling in uppercase mono is the fastest way to look like a template — two visible at once is a good ceiling.

**Set, and drawn.** Doto is *set* as a webfont at title scale. Above that, dot type is *drawn* by the engine (`headline` scene) at the panel's real pitch, arriving by dithering in. Drawn type lives on glass.

## Space and radius

8px baseline. Radii are small and machined: **6px** controls · **10px** panels · **14px** floating glass · **999px** pills. Above 14px is rare and should be a decision.

Square corners are a texture for full-bleed things, catalog grids on a hairline, and table rules. Everything else takes a radius. Inner radius = outer radius − padding.

Cards get 16–20px of real space between them; a 1px seam belongs inside a catalog grid. Content max 1240px, prose 68ch, gutter `clamp(20px,5vw,80px)`, section rhythm 88–176px.

## Motion

- **Controls** — 90–140ms, `cubic-bezier(.2,0,0,1)`, `translateY(1px)` and a tone change.
- **Page** — 260–420ms, `cubic-bezier(.16,1,.3,1)`, 10px travel + opacity, 40ms stagger, once per element.
- **Display** — continuous, engine-driven. `fade(k)` per frame; never clear the buffer.

Housing motion stays under ~450ms. Everything collapses under `prefers-reduced-motion`.

## Formats

- **Web / landing** — dark housing, 1240px max. One idea per screen. Hero ~5.4rem; little else above 3.1rem.
- **Deck 1920×1080** — dark housing, 96px margins. Title 120px, statement 72px, body ≥28px. Statement, figure, sheet.
- **Social 1080×1350** — colour plane welcome. 72px safe margin, mark and handle in a black band.
- **App (Polyphonic)** — rail / work area / instrument column. 8px baseline, 13.5px body, 32px rows. Phosphor identifies who is speaking.

## The lattice

One grid under the mark, emblems, display glyphs, avatars, scenes. Odd-numbered, square, round dots, unlit dots left visible (`--unlit`) so an emblem reads as switched on.

- **The mark** — an M on 7×7. Clear space = one dot pitch. Below 16px, drop the unlit field.
- **Identity emblems are generated.** FNV-1a hash of the name into xorshift, mirrored on the vertical axis, ~42% density. 7×7 mark, 9×9 avatar, 11–15 for print.
- **Display glyphs** — the housing icon set re-cut on 7×7. Housing engraves, the display emits.
- **Icons in housing** — 24 grid, 1.5 stroke, square terminals, miter joins, unfilled.

## Display engine

```html
&lt;script src="dot-display.js"&gt;&lt;/script&gt;
&lt;script src="mnemos-scenes.js"&gt;&lt;/script&gt;
&lt;canvas data-scene="net"&gt;&lt;/canvas&gt;
&lt;canvas data-scene="bars" data-labels="CURIOSITY,WARMTH,CLARITY"&gt;&lt;/canvas&gt;
&lt;!-- then, once, after mount: DotDisplay.mount(root) --&gt;
```

Scenes: `field` (idle), `resolve` (thinking), `net` (recall), `travel` (handoff), `burial` (scarcity), `bars` (levels), `type` (a note), `pulse` `scan` `radar` `orbit` `wipe` `marquee`, plus **`memory`** (living memory graph) and **`headline`** (drawn dot type from `data-text`).

**Dot pitch by scale.** `data-cell` 4–5px in small wells, 7px for a drawn headline, 12–16px at hero scale. Bloom attenuates automatically as pitch coarsens; don't raise `data-bloom` on a coarse panel.

Cover pattern: full-bleed `memory` well, 430–690px, `data-bias="tr"`, eyebrow + display title bottom-left in `--phos`, corner labels top. Marquee band: full-bleed `marquee` canvas, 96–132px, hairlines above and below, used as a divider.

When you edit `mnemos-scenes.js`, bump the `?rev=N` on its script tag.

Well labels occupy the first nine dot rows — scenes start content at `DotDisplay.CAP` and reserve their own footer rows. Pick the scene whose meaning matches the paragraph beside it.

**Data viz:** live series on glass in dots; finished figures in housing as hairlines. One series in ink, signal on the current value, tabular numerals, a single baseline, no gridlines. Direct labels over legends.

## Component states

Focus: 2px signal outline at 3px offset. Disabled: dashed, `--t3`, not a global opacity fade. Loading: quantized cells rather than a spinner. Attention: signal on the border plus one mono line saying what to do. Destructive: signal-bordered hairline key, not a signal fill.

## Voice

Plain, short, certain. Sentence case in prose, lowercase in chrome, caps inside the display.

Prefer: naming a number's source in the same sentence · labelling an unfinished thing at its real stage · the plain version before the precise one · captions that say what to notice.

Avoid: seamless, powerful, revolutionary, unlock, elevate, effortless · an internal term the reader hasn't been given · a bare statistic · exclamation marks · a claim the build cannot currently do.

## What still breaks it

The short list. Everything above is a default; these are the actual mistakes.

- Emoji.
- Applied texture: a noise PNG, a grain overlay, a fake scanline.
- An emblem drawn by hand rather than generated from its seed.
- Theming the glass — display colours are constants.
- Doto used for prose or labels.
- A claim the build cannot currently do.
