# The dot-matrix status system — working notes

Session log for the Luca visual-design work. Written to survive context loss.

## Where things are

| What | Path |
|---|---|
| Engine (production) | `desktop/src/shared/ui/dot-display/engine.ts` |
| React wrapper | `desktop/src/shared/ui/dot-display/DotSigil.tsx` |
| Experimental scenes | `desktop/src/shared/ui/dot-display/scenes-lab.ts` |
| Scene gallery | `desktop/public/_dot-gallery.html` → `http://localhost:5199/_dot-gallery.html` |
| Exploration lab | `desktop/public/_dot-lab.html` → `http://localhost:5199/_dot-lab.html` |
| Dev server | `cd desktop && VITE_PORT=5199 pnpm dev` |
| Source prototypes | `~/Downloads/Mnemos Chat (standalone).html`, `cascade-by-magnitude.html`, `small-system-v2.html` |

The Mnemos prototype is a Claude-Design bundle: the real document is a JSON-escaped
HTML string in the outer file, and its JS lives gzipped+base64 in a
`<script type="__bundler/manifest">` block (asset `347f58d8-…` is the renderer).

## Commits this session

| Commit | What |
|---|---|
| `527b7361` | Onboarding readability after the Buzz-branding strip |
| `82685a4f` | Dev bundle identity + `scripts/rebuild-luca-dev-app.sh` |
| `bea0212f` | Dev-instance reset guard; G1 run log |
| `8fc218df` | G1 handoff for Codex |
| `e3214746` | **Unified the shell palette on one source of truth** |
| `3272a661` | Sidebar collapses to a 48px icon rail; card hairline + `--radius` |
| `3f88995b` | Top chrome 40px → 32px (traffic lights recentred to y=10) |
| `657e4189` | **Fixed the invisible active item** (double-wrapped `hsl()`) |
| `b20afd78` | **The persistent-phosphor dot-matrix engine** |
| `57ffb97f` | The scene lab + experimental scene table |

## The status system doctrine

From the design guide, and it governs everything:

> In the rail and on a message row, the sigil is replaced by its state and returns when
> the state ends. That is the whole status system: no dots on corners, no "typing…",
> no badges.

- The **identity sigil is static by design** — *"a mark that twinkles is a mark you
  cannot recognise."* Only an optional uniform `breath` lifts it.
- Density is held 40–60% so no key yields an empty or clogged emblem; every row carries
  at least one dot so a mark never breaks into stripes.
- **28px is the avatar scale the system is tuned for** — "where it has to work".
- The lamp (`#e03c2f`) was the one sanctioned colour. **That rule is currently suspended
  for exploration.**

## The six house laws

These are the actual difference between the beautiful scenes and the weak ones:

1. **Never clear the charge buffer** — persistence is the medium. (`work`/`fill` violated
   this: `buf.fill(0)` deletes the phosphor every frame.)
2. **No flat values** — every write carries a gradient, falloff or noise.
3. **Fill the field** — `fault` lit one row of fourteen; ~90% empty reads as broken.
4. **Two decay timescales** — a fast front over a slow afterglow is what makes depth.
5. **Never loop** — aperiodic drivers (power law, irrational-ratio sines).
6. **Prefer continuous maths sampled onto the lattice** over discrete bookkeeping. This
   is the single reason `pulse` reads as the most refined production scene.

## Scene scoring (Riley + Claude, from the lab)

**Beautiful, keep:**
- `interference` — three sources, real wave interference. Best on the page. Metaphor is
  exact: each participant is a source; talking means waves interfere.
- `pileThink` — sandpile bloom; reads as a real object.
- `pileRecall` — orbiting pour builds an elegant annulus.
- `chladni` — nodal lines; literally the spec's "noise resolving into order".
- Production `listen`, `think`, `pulse`, `sigil`.

**Real improvements:** `recallV2` (gradient wedge + per-memory decay envelope),
`workV2` (advancing soft front with a textured wake).

**Not there yet:**
- `flow` — **broken**, nearly empty at 96/300px; particle count wrong for the field size.
- `dla` — underdeveloped; scattered clumps rather than a dendrite.
- `sleepV2` — **regression**; the "slow swell" is too high-frequency and reads as a
  regular grid of blobs. Original twinkle was better.
- `netV2`, `faultV2` — better than their originals, not top tier.

Riley's overall reaction: "i love all of these so much."

## Two open findings

1. **Colour-by-magnitude costs legibility.** Low magnitudes map to dark indigo, which
   vanishes on a near-black floor, so most of a mark disappears and only the hot core
   survives. Correct for "colour = magnitude", wrong for "this is an identity mark". If
   colour stays, the ramp needs an **ink floor**: cold events remain visible greyscale and
   colour only enters above some magnitude.
2. **The 28px column is the real gate and several winners may not survive it.** At rail
   scale the lattice is only ~14 cells across. `pileThink` and `interference` are stunning
   at 96px; they must be judged small before being wired in.

## Measured facts (don't re-derive)

- 92 live panels → **120fps, one shared rAF loop**. Perf is not a constraint.
- Identity is deterministic: same seed → pixel-identical mark across mounts; distinct
  seeds → distinct marks.
- Lattice is an integer multiple of the device cell pitch (crispness verified).
- Active nav item after the fix: fill `rgb(230,232,234)` vs glyph `rgba(8,9,10,0.72)` —
  **16.22:1**.
- Reduced-motion path is implemented (loop never starts, settled frame renders) but
  **not empirically verified** — the browser tool cannot emulate that media query.

## Next steps

1. Judge the winners at **28px** specifically.
2. Fix `flow`, `dla`, `sleepV2`.
3. Decide the colour law (ink floor vs monochrome vs scale-based).
4. Move winners into the production scene table and swap `AgentIdentitySpecimen`'s
   internals to the engine — that upgrades sidebar DMs, message rows and headers at once.
5. Then the rail geometry work (see `.claude/plans/sunny-giggling-breeze.md`):
   `scrollbar-gutter: stable` burns 10 of 48px and is never cancelled in icon mode;
   nested `p-2`/`px-[3px]` leaves ~15px for a forced 32px button; section actions render
   at negative x; `SidebarGroupLabel` uses `opacity-0` so it still occupies space and
   stays focusable; icon-mode `overflow-hidden` makes overflowed residents unreachable.

**Coordination:** Codex is working the G1 runtime track in this repo. Stage only our own
files; never commit their in-flight work.
