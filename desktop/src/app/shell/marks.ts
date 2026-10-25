/**
 * THE SHELL'S MARKS: where you are, in the places and on the rail
 * (docs/luca/rail-system/SHELL_SPEC.md, "Where you are"). The study's engine
 * (desktop/src/testing/shellStudy/marks.ts), ported with its numbers
 * unchanged. The marks are solid (a plate of the page's ink, or a piece of
 * the card) and squircle-cornered; their materials are shell-marks.css's.
 *
 * They slide on the house's springs, stepped 240 times a second, a frame never
 * longer than 1/30 s:
 * - To a new place: the edge facing it leads on a quicker spring and the far
 *   edge follows, so the mark stretches on the way and catches up when it
 *   lands.
 * - Gone (a place with no mark, the rail closing): it closes to a point at its
 *   middle, and back, it swells from one.
 * - The same mark moved (a resize, a section opening above it): it follows at
 *   once.
 * - Reduce Motion: every mark is simply where it belongs.
 * - At rest, on whole device pixels.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export type Motion = { response: number; damping: number };

/** The leading edge, quick with a small settle, and the trailing one. */
export const LEAD: Motion = { response: 0.32, damping: 0.8 };
export const TRAIL: Motion = { response: 0.38, damping: 0.84 };
/** Closing away, and swelling back. */
export const CLOSE: Motion = { response: 0.42, damping: 0.95 };
export const SWELL: Motion = { response: 0.3, damping: 0.86 };

export const STEP = 1 / 240;
export const MAX_FRAME = 1 / 30;
/** Wet: the light catches from 30 px/s, fully by 350, in 0.07 s; dries in 0.5. */
const WET_FROM = 30;
const WET_OVER = 320;
const WET_CATCH = 0.07;
const WET_DRY = 0.5;

export type MarkEnvironment = {
  /** Whether Reduce Motion is on; read at every change. */
  reduceMotion: () => boolean;
  /** Device pixels per point, for settling on whole pixels. */
  scale: () => number;
};

const browserEnvironment: MarkEnvironment = {
  reduceMotion: () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  scale: () =>
    (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1,
};

export class Spring {
  x: number;
  v = 0;
  to: number;
  motion: Motion = LEAD;

  constructor(value: number) {
    this.x = value;
    this.to = value;
  }

  step(dt: number) {
    const { response, damping } = this.motion;
    const k = ((2 * Math.PI) / response) ** 2;
    const c = (4 * Math.PI * damping) / response;
    this.v += (-k * (this.x - this.to) - c * this.v) * dt;
    this.x += this.v * dt;
  }

  get resting() {
    return Math.abs(this.x - this.to) < 0.05 && Math.abs(this.v) < 0.5;
  }

  snap(value = this.to) {
    this.x = value;
    this.to = value;
    this.v = 0;
  }
}

class Piece {
  readonly el: HTMLElement;
  readonly edges: [Spring, Spring, Spring, Spring];
  wet = 0;
  going = false;
  private readonly env: MarkEnvironment;

  constructor(
    layer: HTMLElement,
    className: string,
    rect: Rect,
    env: MarkEnvironment,
  ) {
    this.env = env;
    this.el = layer.ownerDocument.createElement("div");
    this.el.className = className;
    this.el.setAttribute("aria-hidden", "true");
    layer.append(this.el);
    this.edges = [
      new Spring(rect.x),
      new Spring(rect.y),
      new Spring(rect.x + rect.w),
      new Spring(rect.y + rect.h),
    ];
  }

  get goal(): Rect {
    const [l, t, r, b] = this.edges;
    return { x: l.to, y: t.to, w: r.to - l.to, h: b.to - t.to };
  }

  get rect(): Rect {
    const [l, t, r, b] = this.edges;
    return { x: l.x, y: t.x, w: r.x - l.x, h: b.x - t.x };
  }

  get settled() {
    return this.edges.every((edge) => edge.resting);
  }

  get resting() {
    return this.settled && this.wet === 0;
  }

  /** Toward `rect`; `motions` are the left, top, right and bottom edges'. */
  aim(rect: Rect, motions: [Motion, Motion, Motion, Motion]) {
    const goals = [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h];
    for (const [index, edge] of this.edges.entries()) {
      edge.to = goals[index];
      edge.motion = motions[index];
    }
  }

  place(rect: Rect) {
    const goals = [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h];
    for (const [index, edge] of this.edges.entries()) edge.snap(goals[index]);
  }

  step(dt: number) {
    for (const edge of this.edges) edge.step(dt);
    const speed =
      (Math.abs(this.edges[0].v) +
        Math.abs(this.edges[1].v) +
        Math.abs(this.edges[2].v) +
        Math.abs(this.edges[3].v)) /
      2;
    const flowing = Math.min(Math.max((speed - WET_FROM) / WET_OVER, 0), 1);
    const tau = flowing > this.wet ? WET_CATCH : WET_DRY;
    this.wet += (flowing - this.wet) * (1 - Math.exp(-dt / tau));
    if (this.wet < 0.002 && flowing === 0) this.wet = 0;
  }

  draw() {
    let { x, y, w, h } = this.rect;
    if (this.settled) {
      // At rest, on whole device pixels: a fractional edge smears.
      const scale = this.env.scale();
      const snap = (value: number) => Math.round(value * scale) / scale;
      x = snap(x);
      y = snap(y);
      w = snap(w);
      h = snap(h);
    }
    const shown = w >= 1 && h >= 1;
    this.el.style.visibility = shown ? "visible" : "hidden";
    if (!shown) return;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    this.el.style.setProperty("--mark-h", `${h}px`);
    this.el.style.setProperty("--wet", this.wet.toFixed(3));
  }
}

/** Where a mark goes when it goes, and comes from: a point at its middle. */
export function sunk(rect: Rect): Rect {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, w: 0, h: 0 };
}

function sameRect(a: Rect, b: Rect) {
  return (
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.w - b.w) < 0.01 &&
    Math.abs(a.h - b.h) < 0.01
  );
}

/** The edges for a slide from `from` to `to`: whichever edge faces the way it
 *  goes leads, the other trails. */
export function slideMotions(
  from: Rect,
  to: Rect,
): [Motion, Motion, Motion, Motion] {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  return [
    dx < 0 ? LEAD : TRAIL,
    dy < 0 ? LEAD : TRAIL,
    dx > 0 ? LEAD : TRAIL,
    dy > 0 ? LEAD : TRAIL,
  ];
}

/** One kind of mark: the chosen place's, the rail's. */
export class MarkGroup {
  private current: Piece | null = null;
  private chosen: string | null = null;
  private appeared = false;
  private readonly pieces = new Set<Piece>();
  private readonly engine: MarkEngine;
  private readonly className: string;

  constructor(engine: MarkEngine, className: string) {
    this.engine = engine;
    this.className = className;
  }

  /** Where the mark is now, or nowhere. */
  show(id: string | null, rect: Rect | null) {
    // The layer has shown its first page once it is first asked, with a mark
    // or without one: from then on every mark that comes swells in.
    const appeared = this.appeared;
    this.appeared = true;
    if (!id || !rect || rect.w < 1 || rect.h < 1) {
      this.leave();
      return;
    }
    const reduce = this.engine.env.reduceMotion();
    const current = this.current;
    if (current) {
      // Asked again for where it is already going (the page drew again
      // mid-slide): the slide goes on as it was, its leading edge leading.
      if (id === this.chosen && sameRect(current.goal, rect)) return;
      if (id === this.chosen && current.settled) current.place(rect);
      else if (reduce) current.place(rect);
      else if (id === this.chosen)
        current.aim(rect, [TRAIL, TRAIL, TRAIL, TRAIL]);
      else current.aim(rect, slideMotions(current.rect, rect));
      this.chosen = id;
      this.engine.wake();
      return;
    }
    this.chosen = id;
    // A mark on the page's first showing is simply there; every mark after
    // it swells from where marks go, the first one included.
    const swell = appeared && !reduce;
    const piece = this.add(swell ? sunk(rect) : rect);
    if (swell) piece.aim(rect, [SWELL, SWELL, SWELL, SWELL]);
    this.current = piece;
    this.engine.wake();
  }

  /** Every piece gone at once: the look changed. */
  clear() {
    for (const piece of this.pieces) piece.el.remove();
    this.pieces.clear();
    this.current = null;
    this.chosen = null;
    this.appeared = false;
  }

  step(dt: number) {
    for (const piece of this.pieces) piece.step(dt);
  }

  get moving() {
    for (const piece of this.pieces) if (!piece.resting) return true;
    return false;
  }

  /** The pieces on the layer: the one where you are, and any still closing. */
  get count() {
    return this.pieces.size;
  }

  draw() {
    for (const piece of this.pieces) {
      if (piece.going && piece.settled) {
        piece.el.remove();
        this.pieces.delete(piece);
        continue;
      }
      if (piece.resting) {
        for (const edge of piece.edges) edge.snap();
      }
      piece.draw();
    }
  }

  private add(rect: Rect) {
    const piece = new Piece(
      this.engine.layer,
      this.className,
      rect,
      this.engine.env,
    );
    this.pieces.add(piece);
    piece.draw();
    return piece;
  }

  /** Gone by its shape, never a fade: it closes into a point. */
  private leave() {
    this.chosen = null;
    const current = this.current;
    this.current = null;
    if (!current) return;
    if (this.engine.env.reduceMotion()) {
      current.el.remove();
      this.pieces.delete(current);
      return;
    }
    current.going = true;
    current.aim(sunk(current.goal), [CLOSE, CLOSE, CLOSE, CLOSE]);
    this.engine.wake();
  }
}

/** One clock for every mark on one layer. */
export class MarkEngine {
  readonly groups: MarkGroup[] = [];
  readonly env: MarkEnvironment;
  readonly layer: HTMLElement;
  private frame: number | null = null;
  private last = 0;

  constructor(layer: HTMLElement, env: Partial<MarkEnvironment> = {}) {
    this.layer = layer;
    this.env = { ...browserEnvironment, ...env };
  }

  group(className: string) {
    const group = new MarkGroup(this, className);
    this.groups.push(group);
    return group;
  }

  wake() {
    if (this.frame !== null) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const group of this.groups) group.clear();
  }

  /** `seconds` of motion, in steps of 1/240 s, then drawn. Whether anything
   *  is still moving. */
  advance(seconds: number) {
    let left = Math.min(Math.max(seconds, 0), MAX_FRAME);
    while (left > 1e-6) {
      const dt = Math.min(STEP, left);
      left -= dt;
      for (const group of this.groups) group.step(dt);
    }
    for (const group of this.groups) group.draw();
    return this.groups.some((group) => group.moving);
  }

  private tick = (now: number) => {
    // A frame's time can come before the moment the clock was woken: then no
    // time has passed yet, and the next frame steps.
    const moving = this.advance((now - this.last) / 1000);
    this.last = Math.max(now, this.last);
    this.frame = moving ? requestAnimationFrame(this.tick) : null;
  };
}
