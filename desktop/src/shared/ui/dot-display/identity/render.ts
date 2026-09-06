/**
 * Drawing an identity glyph so it survives 96px down to 16px.
 *
 * ## The scale problem, and why there is no LOD ladder
 *
 * A dot matrix rendered as separate dots stops working somewhere around 28px:
 * a 7-cell lattice in a 28px box leaves roughly 3px per cell, so a "dot" is two
 * pixels with a one-pixel gap, and the mark reads as grit rather than as a
 * shape. The usual fix is a level-of-detail ladder — different artwork per size
 * — but then the mark a resident has in the rail is not the mark they have on
 * their detail page, which defeats an identity system.
 *
 * So there is one geometry at every size, and the *join* is what adapts.
 * Adjacent lit cells abut exactly and the outline is rounded only where a cell
 * faces empty space, which turns the lattice into a continuous stroked glyph
 * with rounded terminals — a pixel-font drawn at a heavy weight. At 96px you
 * read a constructed lattice mark; at 16px you read a small clean glyph. Same
 * silhouette, no switch, nothing to keep in sync.
 *
 * `dots` mode is kept for comparison and for the places where the phosphor
 * character is the point. It is not the avatar default.
 *
 * ## Identity is joined, activity is dotted
 *
 * The doctrine is that a resident's mark is replaced by their state and returns
 * when the state ends. Rendering identity as a continuous glyph and the live
 * scenes as a dot field makes that legible at a glance: joined means *who*,
 * dotted means *what they are doing*.
 */

import { type IdentityGlyph, glyphLit } from "./glyph";

export type GlyphRenderMode = "joined" | "dots" | "stroke";

/**
 * The polished pen: stroke width as a share of a cell, by box size. Heavier
 * where the mark is small so it keeps its weight beside 14-16px type; lighter
 * where it is large so the constructed figure shows instead of a fat tube.
 */
export function strokeRatio(size: number): number {
  if (size <= 16) return 0.86;
  if (size >= 40) return 0.68;
  return 0.86 + ((size - 16) / (40 - 16)) * (0.68 - 0.86);
}

/**
 * The glyph as one stroke through its cell centres — the polished rendering.
 * Same cells, same identity; only the pen changes. Every lit cell has at
 * least one 4-neighbour (the sampler guarantees one connected piece), so a
 * polyline through neighbouring centres covers every cell and round caps
 * finish the terminals. Returned in the glyph's own `0 0 edge edge` box.
 */
export function glyphToStrokePath(glyph: IdentityGlyph): string {
  const parts: string[] = [];
  for (let y = 0; y < glyph.edge; y++) {
    for (let x = 0; x < glyph.edge; x++) {
      if (!glyphLit(glyph, x, y)) continue;
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (glyphLit(glyph, x + 1, y)) parts.push(`M${cx} ${cy}L${cx + 1} ${cy}`);
      if (glyphLit(glyph, x, y + 1)) parts.push(`M${cx} ${cy}L${cx} ${cy + 1}`);
    }
  }
  return parts.join("");
}

export interface GlyphRenderOptions {
  /** CSS px of the square box the mark is drawn into. */
  size: number;
  /** Device pixel ratio. The lattice is snapped to whole device pixels. */
  dpr?: number;
  /** Ink as an `r,g,b` triplet. Alpha is applied separately. */
  ink?: string;
  /** Base ink alpha before small-size compensation. */
  alpha?: number;
  mode?: GlyphRenderMode;
  /**
   * Quiet-zone allowance, in cells, summed across both sides.
   *
   * 1 is the default: the mark then occupies 7/8 of its box, which reads as a
   * mark that owns its slot rather than an icon sitting inside a frame. At 2
   * the glyph drops to 66-75% depending on how the integer pitch rounds, and
   * beside a 15px author name it reads as a wisp.
   */
  quiet?: number;
}

/**
 * Rounded-corner share of a cell, on the corners that face empty space.
 *
 * Optically sized rather than fixed. A small mark needs the extra rounding —
 * it smooths a four-device-pixel stroke into something the eye reads as a
 * shape. A large one does not, and at 0.44 a 112px mark reads as inflated
 * tubing instead of a constructed figure. The silhouette is identical either
 * way; only the finish changes, which is the same trade a type family makes
 * between its caption and display cuts.
 */
const CORNER_SMALL = 0.44;
const CORNER_LARGE = 0.3;
const CORNER_SMALL_AT = 20;
const CORNER_LARGE_AT = 64;

function cornerRatio(size: number): number {
  const t = Math.max(
    0,
    Math.min(1, (size - CORNER_SMALL_AT) / (CORNER_LARGE_AT - CORNER_SMALL_AT)),
  );
  return CORNER_SMALL + (CORNER_LARGE - CORNER_SMALL) * t;
}

/**
 * Neighbouring cells are drawn as separate rounded rects that abut. Extending
 * each by half a device pixel into a lit neighbour makes them overlap instead,
 * so a single `fill()` cannot leave an antialiasing seam down the middle of a
 * stroke.
 */
const OVERLAP = 0.5;

/**
 * Thin strokes read lighter than they measure. Below ~28px the mark gets a
 * small alpha lift so a 16px glyph carries the same weight as a 40px one.
 */
function opticalAlpha(base: number, size: number): number {
  const lift = Math.max(0, Math.min(1, (28 - size) / 12));
  return Math.min(1, base * (1 + 0.14 * lift));
}

export interface GlyphMetrics {
  /** Device px per lattice cell. Always an integer, so every edge is crisp. */
  cell: number;
  /** Device px offset of the lattice inside the canvas. */
  originX: number;
  originY: number;
  /** Device px the whole canvas occupies. */
  extent: number;
}

export function glyphMetrics(
  glyph: IdentityGlyph,
  {
    size,
    dpr = 1,
    quiet = 1,
  }: Pick<GlyphRenderOptions, "size" | "dpr" | "quiet">,
): GlyphMetrics {
  const extent = Math.round(size * dpr);
  // Largest pitch the box can hold at all, versus the pitch that also leaves
  // the quiet zone. The 2px floor keeps a cell from collapsing to a hairline,
  // but it must never win against what actually fits: a 13px box at dpr 1 wants
  // a 2px pitch, which is a 14px lattice, and the mark would be drawn a pixel
  // wider than its own canvas and silently lose its right and bottom edges.
  const fits = Math.floor(extent / glyph.edge);
  const withQuiet = Math.floor(extent / (glyph.edge + quiet));
  const cell = Math.max(1, Math.min(fits, Math.max(2, withQuiet)));
  const span = cell * glyph.edge;
  const origin = Math.floor((extent - span) / 2);
  return { cell, originX: origin, originY: origin, extent };
}

/**
 * Paint one mark. The canvas is cleared first, so this is safe to call on every
 * theme change or resize.
 */
export function renderIdentityGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: IdentityGlyph,
  options: GlyphRenderOptions,
): void {
  const {
    size,
    dpr = 1,
    ink = "236,238,240",
    alpha = 1,
    mode = "joined",
    quiet = 1,
  } = options;

  const { cell, originX, originY, extent } = glyphMetrics(glyph, {
    size,
    dpr,
    quiet,
  });

  ctx.clearRect(0, 0, extent, extent);
  ctx.fillStyle = `rgba(${ink},${opticalAlpha(alpha, size)})`;

  if (mode === "stroke") {
    // Sub-pixel geometry on purpose: the lattice origin is snapped so the
    // figure sits square, but the stroke itself is drawn at fractional device
    // pixels — on a retina screen that is what reads as a drawn line rather
    // than a placed one.
    ctx.lineWidth = cell * strokeRatio(size);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    for (let y = 0; y < glyph.edge; y++) {
      for (let x = 0; x < glyph.edge; x++) {
        if (!glyphLit(glyph, x, y)) continue;
        const cx = originX + (x + 0.5) * cell;
        const cy = originY + (y + 0.5) * cell;
        if (glyphLit(glyph, x + 1, y)) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + cell, cy);
        }
        if (glyphLit(glyph, x, y + 1)) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy + cell);
        }
      }
    }
    ctx.stroke();
    return;
  }

  if (mode === "dots") {
    // Separate dots with a hairline gap — the phosphor reading. Legible while
    // a cell is comfortably more than three device pixels; below that the gaps
    // eat the mark, which is exactly why it is not the avatar default.
    const gap = Math.max(1, Math.round(cell * 0.18));
    const d = cell - gap;
    const r = d / 2;
    ctx.beginPath();
    for (let y = 0; y < glyph.edge; y++) {
      for (let x = 0; x < glyph.edge; x++) {
        if (!glyphLit(glyph, x, y)) continue;
        const px = originX + x * cell + gap / 2;
        const py = originY + y * cell + gap / 2;
        ctx.moveTo(px + d, py + r);
        ctx.arc(px + r, py + r, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    return;
  }

  const radius = cell * cornerRatio(size);
  ctx.beginPath();
  for (let y = 0; y < glyph.edge; y++) {
    for (let x = 0; x < glyph.edge; x++) {
      if (!glyphLit(glyph, x, y)) continue;

      const n = glyphLit(glyph, x, y - 1);
      const s = glyphLit(glyph, x, y + 1);
      const w = glyphLit(glyph, x - 1, y);
      const e = glyphLit(glyph, x + 1, y);

      // Grow into lit neighbours so abutting cells overlap rather than merely
      // touch; a shared edge would otherwise antialias into a visible seam.
      const left = originX + x * cell - (w ? OVERLAP : 0);
      const top = originY + y * cell - (n ? OVERLAP : 0);
      const right = originX + (x + 1) * cell + (e ? OVERLAP : 0);
      const bottom = originY + (y + 1) * cell + (s ? OVERLAP : 0);

      // A corner is rounded only where both of its edges face empty space, so
      // terminals and outer corners round while joints stay square and the
      // stroke runs through unbroken.
      const tl = !n && !w ? radius : 0;
      const tr = !n && !e ? radius : 0;
      const br = !s && !e ? radius : 0;
      const bl = !s && !w ? radius : 0;

      ctx.roundRect(left, top, right - left, bottom - top, [tl, tr, br, bl]);
    }
  }
  ctx.fill();
}

/**
 * Size a canvas for a mark and paint it. Returns the metrics so callers can
 * assert on them in tests.
 */
export function paintGlyphCanvas(
  canvas: HTMLCanvasElement,
  glyph: IdentityGlyph,
  options: GlyphRenderOptions,
): GlyphMetrics | null {
  const dpr = options.dpr ?? (globalThis.devicePixelRatio || 1);
  const metrics = glyphMetrics(glyph, {
    size: options.size,
    dpr,
    quiet: options.quiet,
  });
  canvas.width = metrics.extent;
  canvas.height = metrics.extent;
  canvas.style.width = `${options.size}px`;
  canvas.style.height = `${options.size}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  renderIdentityGlyph(ctx, glyph, { ...options, dpr });
  return metrics;
}

/**
 * The same mark as an SVG path, for anywhere a canvas will not do — a
 * notification icon, an export, an email. Uses the joined geometry, in a
 * `0 0 edge edge` viewBox so the caller picks the size.
 */
export function glyphToSvgPath(
  glyph: IdentityGlyph,
  corner = CORNER_LARGE,
): string {
  const parts: string[] = [];
  for (let y = 0; y < glyph.edge; y++) {
    for (let x = 0; x < glyph.edge; x++) {
      if (!glyphLit(glyph, x, y)) continue;
      const n = glyphLit(glyph, x, y - 1);
      const s = glyphLit(glyph, x, y + 1);
      const w = glyphLit(glyph, x - 1, y);
      const e = glyphLit(glyph, x + 1, y);
      const tl = !n && !w ? corner : 0;
      const tr = !n && !e ? corner : 0;
      const br = !s && !e ? corner : 0;
      const bl = !s && !w ? corner : 0;
      const x0 = x;
      const y0 = y;
      const x1 = x + 1;
      const y1 = y + 1;
      parts.push(
        `M${x0 + tl} ${y0}` +
          `H${x1 - tr}` +
          (tr ? `A${tr} ${tr} 0 0 1 ${x1} ${y0 + tr}` : "") +
          `V${y1 - br}` +
          (br ? `A${br} ${br} 0 0 1 ${x1 - br} ${y1}` : "") +
          `H${x0 + bl}` +
          (bl ? `A${bl} ${bl} 0 0 1 ${x0} ${y1 - bl}` : "") +
          `V${y0 + tl}` +
          (tl ? `A${tl} ${tl} 0 0 1 ${x0 + tl} ${y0}` : "") +
          "Z",
      );
    }
  }
  return parts.join(" ");
}
