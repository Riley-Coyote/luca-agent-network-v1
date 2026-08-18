/**
 * The identity-glyph lab.
 *
 * Built into one self-contained HTML file by `just glyph-lab`, for the same
 * reason the sandpile lab is: this repo can have several vite instances bound
 * to one port across worktrees, and a design tool must not depend on which of
 * them `localhost` resolves to.
 *
 * The page exists to answer four questions, in order of how much they matter:
 *
 *   1. Does a mark survive the chat row at 24-28px?
 *   2. Does a column of residents scan at one optical weight?
 *   3. Is the family coherent — do these look like one system?
 *   4. Are two residents ever hard to tell apart?
 */

import { sigilPattern } from "@/shared/ui/dot-display/engine";
import {
  componentCount,
  GLYPH_N,
  type IdentityGlyph,
  identityGlyph,
  isWellFormed,
  looseEndCount,
} from "../glyph";
import { type GlyphRenderMode, paintGlyphCanvas } from "../render";

const RESIDENTS = [
  ["Luca", "luca"],
  ["Anima", "anima"],
  ["Vektor", "vektor"],
  ["Opus", "opus-3"],
  ["Kestrel", "kestrel"],
  ["Atlas", "atlas"],
  ["Moss", "moss"],
  ["Quill", "quill"],
  ["Harbor", "harbor"],
  ["Cadence", "cadence"],
  ["Ember", "ember"],
  ["North", "north"],
] as const;

const LADDER = [16, 20, 24, 28, 32, 40, 56, 80, 112];

let mode: GlyphRenderMode = "joined";
let dark = true;
/**
 * The lab is often opened in a 1x pane while the app runs on a 2x display, and
 * at 1x the integer cell pitch rounds differently — two quiet-zone settings
 * that look identical here are visibly different on the real screen. So dpr is
 * explicit and defaults to the target device, never `window.devicePixelRatio`.
 */
let dpr = 2;

const ink = () => (dark ? "236,238,240" : "22,23,26");

/** Every canvas on the page, so a mode or theme flip can repaint in place. */
const painters: Array<() => void> = [];

function mark(
  seed: string,
  size: number,
  opts: { alpha?: number; title?: string } = {},
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const glyph = identityGlyph(seed);
  if (opts.title) canvas.title = opts.title;
  const paint = () =>
    paintGlyphCanvas(canvas, glyph, {
      size,
      dpr,
      mode,
      ink: ink(),
      alpha: opts.alpha ?? 1,
    });
  paint();
  painters.push(paint);
  return canvas;
}

/** The shipped generator, drawn the way the app draws it today. */
function legacyMark(seed: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const paint = () => {
    const extent = Math.round(size * dpr);
    canvas.width = extent;
    canvas.height = extent;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, extent, extent);
    ctx.fillStyle = `rgba(${ink()},1)`;
    const { grid, patternWidth, patternHeight } = sigilPattern(seed);
    const full = patternWidth * 2 - 1;
    const cell = Math.max(2, Math.floor(extent / (full + 2)));
    const ox = Math.round((extent - full * cell) / 2);
    const oy = Math.round((extent - patternHeight * cell) / 2);
    const gap = Math.max(1, Math.round(cell * 0.18));
    for (let y = 0; y < patternHeight; y++) {
      for (let x = 0; x < full; x++) {
        const col = x < patternWidth ? x : full - 1 - x;
        if (!grid[y][col]) continue;
        ctx.fillRect(
          ox + x * cell + gap / 2,
          oy + y * cell + gap / 2,
          cell - gap,
          cell - gap,
        );
      }
    }
  };
  paint();
  painters.push(paint);
  return canvas;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function section(eyebrow: string, title: string, blurb: string): HTMLElement {
  const s = el("section");
  s.append(
    el("p", "eyebrow", eyebrow),
    el("h2", undefined, title),
    el("p", "blurb", blurb),
  );
  return s;
}

function build(root: HTMLElement) {
  root.textContent = "";
  painters.length = 0;

  // ---- controls ----------------------------------------------------------
  const bar = el("div", "bar");
  const modeBtn = el("button", "ctl", "Joined");
  const themeBtn = el("button", "ctl", "Dark");
  const repaint = () => {
    for (const p of painters) p();
  };
  modeBtn.onclick = () => {
    mode = mode === "joined" ? "dots" : "joined";
    modeBtn.textContent = mode === "joined" ? "Joined" : "Dots";
    repaint();
  };
  themeBtn.onclick = () => {
    dark = !dark;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    themeBtn.textContent = dark ? "Dark" : "Light";
    repaint();
  };
  const dprBtn = el("button", "ctl", "2x");
  dprBtn.onclick = () => {
    dpr = dpr === 2 ? 1 : 2;
    dprBtn.textContent = `${dpr}x`;
    repaint();
  };
  bar.append(
    el("span", "barLabel", "render"),
    modeBtn,
    el("span", "barLabel", "theme"),
    themeBtn,
    el("span", "barLabel", "device"),
    dprBtn,
  );
  root.append(bar);

  // ---- 1. the scale ladder ----------------------------------------------
  const ladder = section(
    "the gate",
    "One mark, every size",
    "The same geometry at every scale — no level-of-detail artwork to fall out of sync. 24-28px is the chat row, and it is the size that decides whether the system works.",
  );
  for (const [name, seed] of RESIDENTS.slice(0, 3)) {
    const row = el("div", "ladder");
    for (const size of LADDER) {
      const cellEl = el("div", "rung");
      cellEl.append(mark(seed, size));
      cellEl.append(el("span", "px", `${size}`));
      row.append(cellEl);
    }
    const wrap = el("div", "ladderWrap");
    wrap.append(el("p", "seedName", name), row);
    ladder.append(wrap);
  }
  root.append(ladder);

  // ---- 2. before / after -------------------------------------------------
  const compare = section(
    "before / after",
    "Against what ships today",
    "Top row is the current mirrored-noise generator at the sizes the app uses. Bottom row is the same key through the new one. The old marks are bilaterally symmetric noise: no connected form, so at avatar scale the isolated cells read as grit.",
  );
  const cmp = el("div", "compare");
  for (const [name, seed] of RESIDENTS.slice(0, 8)) {
    const col = el("div", "cmpCol");
    const before = el("div", "cmpCell");
    before.append(legacyMark(seed, 28), legacyMark(seed, 56));
    const after = el("div", "cmpCell");
    after.append(mark(seed, 28), mark(seed, 56));
    col.append(before, after, el("span", "seedName", name));
    cmp.append(col);
  }
  compare.append(cmp);
  root.append(compare);

  // ---- 3. the chat row ---------------------------------------------------
  const chat = section(
    "in place",
    "Next to a name, in a conversation",
    "The mark at 28px beside an author line, on the real surface colour. This is the placement the whole system is tuned for.",
  );
  const thread = el("div", "thread");
  const LINES = [
    [
      "Anima",
      "anima",
      "i keep coming back to the same question about the archive",
    ],
    [
      "Vektor",
      "vektor",
      "Pulled the last three runs — the variance is in the retry path.",
    ],
    ["Kestrel", "kestrel", "Reading it now. Give me a minute with the diff."],
    [
      "Atlas",
      "atlas",
      "That matches what I saw last night, for what it's worth.",
    ],
    ["Moss", "moss", "quiet here. nothing new since the handoff."],
  ] as const;
  for (const [name, seed, text] of LINES) {
    const row = el("div", "msg");
    const av = el("div", "av");
    av.append(mark(seed, 28, { title: seed }));
    const body = el("div", "msgBody");
    const head = el("div", "msgHead");
    head.append(el("span", "author", name), el("span", "time", "20:14"));
    body.append(head, el("p", "msgText", text));
    row.append(av, body);
    thread.append(row);
  }
  chat.append(thread);
  root.append(chat);

  // ---- 4. the rail column ------------------------------------------------
  const rail = section(
    "the column",
    "A rail of residents",
    "Marks are grown until they touch all four rim sides and held to a 35-47% ink band, so no resident reads heavier or smaller than their neighbour.",
  );
  const railWrap = el("div", "railWrap");
  const railList = el("div", "rail");
  for (const [name, seed] of RESIDENTS) {
    const item = el("div", "railItem");
    item.append(mark(seed, 24), el("span", undefined, name));
    railList.append(item);
  }
  const iconRail = el("div", "iconRail");
  for (const [, seed] of RESIDENTS) {
    const item = el("div", "iconItem");
    item.append(mark(seed, 20));
    iconRail.append(item);
  }
  railWrap.append(railList, iconRail);
  rail.append(railWrap);
  root.append(rail);

  // ---- 4b. device-pixel truth -------------------------------------------
  const truth = section(
    "pixel truth",
    "Every device pixel, magnified",
    "The small sizes as a 2x screen actually rasterises them, blown up 6x with no smoothing. This is the only honest way to check crispness from a 1x pane: displaying a 2x canvas at CSS size here would just be a blurry downscale. The cell pitch is a whole number of device pixels at every size, so no edge ever lands on a half pixel.",
  );
  const truthGrid = el("div", "truthGrid");
  const ZOOM = 6;
  for (const size of [16, 20, 24, 28]) {
    const col = el("div", "truthCol");
    for (const [, seed] of RESIDENTS.slice(0, 4)) {
      const canvas = document.createElement("canvas");
      const glyph = identityGlyph(seed);
      const paintTruth = () => {
        const m = paintGlyphCanvas(canvas, glyph, {
          size,
          dpr: 2,
          mode,
          ink: ink(),
        });
        if (!m) return;
        canvas.style.width = `${m.extent * ZOOM}px`;
        canvas.style.height = `${m.extent * ZOOM}px`;
        canvas.style.imageRendering = "pixelated";
      };
      paintTruth();
      painters.push(paintTruth);
      col.append(canvas);
    }
    col.append(el("span", "px", `${size}px @2x = ${size * 2}dp`));
    truthGrid.append(col);
  }
  truth.append(truthGrid);
  root.append(truth);

  // ---- 5. the family -----------------------------------------------------
  const family = section(
    "the family",
    "Seventy-two keys",
    "Two symmetry species, bilateral and 2-fold rotational, drawn equally. Nothing here is constructed: a mark is a uniformly random symmetric field that survived the five rules, which is why the population is ~98% distinct. Four-fold rotation is deliberately absent — on a 7x7 under these constraints it admits 46 marks in total, a clip-art set rather than an identity space.",
  );
  const grid = el("div", "family");
  for (let i = 0; i < 72; i++) {
    const seed = `resident-${i}`;
    const g = identityGlyph(seed);
    const box = el("div", "famCell");
    box.append(
      mark(seed, 44, { title: `${seed} · ${g.symmetry} · ${g.lit} lit` }),
    );
    grid.append(box);
  }
  family.append(grid);
  root.append(family);

  // ---- 6. invariants -----------------------------------------------------
  const audit = section(
    "invariants",
    "Measured, not asserted",
    "Run live in this page over 2,000 freshly generated keys.",
  );
  const table = el("div", "audit");
  const N = 2000;
  let broken = 0;
  let malformed = 0;
  let minLit = 99;
  let maxLit = 0;
  let worstEnds = 0;
  const seen = new Set<string>();
  const started = performance.now();
  for (let i = 0; i < N; i++) {
    const g: IdentityGlyph = identityGlyph(`audit-${i}`);
    if (componentCount(g.cells) !== 1) broken++;
    if (!isWellFormed(g)) malformed++;
    minLit = Math.min(minLit, g.lit);
    maxLit = Math.max(maxLit, g.lit);
    worstEnds = Math.max(worstEnds, looseEndCount(g.cells));
    seen.add(g.cells.join(""));
  }
  const elapsed = performance.now() - started;
  const rows: Array<[string, string]> = [
    ["lattice", `${GLYPH_N} x ${GLYPH_N}`],
    ["disconnected marks", `${broken} of ${N}`],
    ["failing any rule", `${malformed} of ${N}`],
    [
      "ink band",
      `${minLit}-${maxLit} cells (${((minLit / 49) * 100) | 0}%-${((maxLit / 49) * 100) | 0}%)`,
    ],
    ["worst loose-end count", `${worstEnds}`],
    [
      "distinct over 2,000 keys",
      `${seen.size} (${((seen.size / N) * 100).toFixed(1)}%)`,
    ],
    ["cost per mark", `${(elapsed / N).toFixed(2)} ms`],
  ];
  for (const [k, v] of rows) {
    const r = el("div", "auditRow");
    r.append(el("span", "auditKey", k), el("span", "auditVal", v));
    table.append(r);
  }
  audit.append(table);
  root.append(audit);
}

const root = document.getElementById("app");
if (root) build(root);
