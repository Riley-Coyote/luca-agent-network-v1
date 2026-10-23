/**
 * The marks the page draws itself: where you are, in the places, the rail and
 * the tabs. In the glass frame they are pieces of the card's own black (Apple's
 * glass can't sit on Apple's glass); in a browser's black frame they are our
 * web glass, standing in for the Apple glass the native lab draws.
 *
 * They move as the native glass does (PolyphonicGlass.swift), on the house's
 * springs, stepped 240 times a second, a frame never longer than 1/30 s:
 * - Slide (places, tabs): the edge facing the new place leads on a quicker
 *   spring and the far edge follows, so it stretches on the way and catches
 *   up when it lands. Gone, it closes to a point; back, it swells from one.
 * - Pour (the rail): a new selection wells out from under the card's edge at
 *   its row, then flows to the row, its near end quick and its far end
 *   spreading slower; the old one drains back under the card at its own
 *   height. The card is drawn above the marks, so they leave and return under
 *   it.
 * - The same mark moved (a resize, the rail opening): it follows at once.
 * - Reduce Motion: every mark is simply where it belongs.
 */

export type Rect = { x: number; y: number; w: number; h: number };

type Motion = { response: number; damping: number };

/** Sliding: the leading edge, quick with a small settle, and the trailing one. */
const LEAD: Motion = { response: 0.32, damping: 0.8 };
const TRAIL: Motion = { response: 0.38, damping: 0.84 };
/** Pouring out of the card: its near end leaves fast, its far end spreads. */
const SPILL_NEAR: Motion = { response: 0.36, damping: 0.86 };
const SPILL_FAR: Motion = { response: 0.5, damping: 0.84 };
/** Draining home, and closing away. */
const DRAIN: Motion = { response: 0.42, damping: 0.95 };
const SWELL: Motion = { response: 0.3, damping: 0.86 };

const STEP = 1 / 240;
const MAX_FRAME = 1 / 30;
/** The bead a selection is born as under the card, and wells out to. */
const BEAD = 22;
const WELL = 18;
const WELL_SIZE = 26;
const WELL_TIME = 120;
/** Wet: the light catches from 30 px/s, fully by 350, in 0.07 s; dries in 0.5. */
const WET_FROM = 30;
const WET_OVER = 320;
const WET_CATCH = 0.07;
const WET_DRY = 0.5;

const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

class Spring {
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
  readonly el: HTMLDivElement;
  readonly edges: [Spring, Spring, Spring, Spring];
  wet = 0;
  going = false;

  constructor(layer: HTMLElement, className: string, rect: Rect) {
    this.el = document.createElement("div");
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

  get resting() {
    return this.edges.every((edge) => edge.resting) && this.wet === 0;
  }

  /** Toward `rect`; `motions` are the left, top, right and bottom edges'. */
  aim(rect: Rect, motions: [Motion, Motion, Motion, Motion]) {
    const goals = [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h];
    this.edges.forEach((edge, index) => {
      edge.to = goals[index];
      edge.motion = motions[index];
    });
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

  settle() {
    for (const edge of this.edges) edge.snap();
  }

  draw() {
    let { x, y, w, h } = this.rect;
    if (this.edges.every((edge) => edge.resting)) {
      // At rest, on whole device pixels: a fractional edge smears.
      const scale = window.devicePixelRatio || 1;
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
    this.el.style.setProperty("--wet", this.wet.toFixed(3));
  }
}

const point = (rect: Rect): Rect => ({
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
  w: 0,
  h: 0,
});

/** The edges for a slide from `from` to `to`: whichever edge faces the way it
 *  goes leads, the other trails. */
function slideMotions(from: Rect, to: Rect): [Motion, Motion, Motion, Motion] {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  return [
    dx < 0 ? LEAD : TRAIL,
    dy < 0 ? LEAD : TRAIL,
    dx > 0 ? LEAD : TRAIL,
    dy > 0 ? LEAD : TRAIL,
  ];
}

/** One kind of mark: a place's disc, the tab's capsule, the rail's capsule. */
export class MarkGroup {
  private current: Piece | null = null;
  private chosen: string | null = null;
  private appeared = false;
  private readonly pieces = new Set<Piece>();
  private welling: number | null = null;

  constructor(
    private readonly engine: MarkEngine,
    private readonly className: string,
    private readonly mode: "slide" | "pour",
  ) {}

  /**
   * Where the mark is now. `card` is the card's rect, for a pour: the
   * selection comes out from under its left edge and goes back under it.
   */
  show(id: string | null, rect: Rect | null, card?: Rect | null) {
    this.engine.remember(this, rect);
    if (!id || !rect || rect.w < 1 || rect.h < 1) {
      this.leave(card);
      return;
    }
    const current = this.current;
    if (current) {
      if (id === this.chosen) {
        // The same mark, moved: at once at rest, retargeted while it travels.
        if (this.welling !== null) return;
        if (current.edges.every((edge) => edge.resting)) current.place(rect);
        else current.aim(rect, [TRAIL, TRAIL, TRAIL, TRAIL]);
        this.engine.wake();
        return;
      }
      this.chosen = id;
      if (this.mode === "slide" || !card || reduceMotion()) {
        if (reduceMotion()) current.place(rect);
        else current.aim(rect, slideMotions(current.rect, rect));
        this.engine.wake();
        return;
      }
      this.home(current, card);
      this.pour(rect, card);
      return;
    }
    this.chosen = id;
    if (this.mode === "pour" && this.appeared && card && !reduceMotion()) {
      this.pour(rect, card);
      return;
    }
    const piece = this.add(
      this.appeared && !reduceMotion() ? point(rect) : rect,
    );
    if (this.appeared && !reduceMotion()) {
      piece.aim(rect, [SWELL, SWELL, SWELL, SWELL]);
    }
    this.current = piece;
    this.appeared = true;
    this.engine.wake();
  }

  /** Every piece gone at once: the direction changed, or the native glass
   *  took over. */
  clear() {
    for (const piece of this.pieces) piece.el.remove();
    this.pieces.clear();
    this.current = null;
    this.chosen = null;
    this.appeared = false;
    if (this.welling !== null) window.clearTimeout(this.welling);
    this.welling = null;
  }

  /** Steps every piece; true while any still moves. */
  step(dt: number) {
    let moving = false;
    for (const piece of this.pieces) {
      piece.step(dt);
      if (!piece.resting) moving = true;
    }
    return moving;
  }

  draw() {
    for (const piece of this.pieces) {
      if (piece.going && piece.edges.every((edge) => edge.resting)) {
        piece.el.remove();
        this.pieces.delete(piece);
        continue;
      }
      if (piece.resting) piece.settle();
      piece.draw();
    }
  }

  get busy() {
    return this.welling !== null;
  }

  private add(rect: Rect) {
    const piece = new Piece(this.engine.layer, this.className, rect);
    this.pieces.add(piece);
    piece.draw();
    return piece;
  }

  private leave(card?: Rect | null) {
    this.chosen = null;
    const current = this.current;
    this.current = null;
    if (this.welling !== null) {
      window.clearTimeout(this.welling);
      this.welling = null;
    }
    if (!current) return;
    if (reduceMotion()) {
      current.el.remove();
      this.pieces.delete(current);
      return;
    }
    if (this.mode === "pour" && card) {
      this.home(current, card);
      return;
    }
    current.going = true;
    current.aim(point(current.goal), [DRAIN, DRAIN, DRAIN, DRAIN]);
    this.engine.wake();
  }

  /** Back under the card at its own height: its near end runs in first. */
  private home(piece: Piece, card: Rect) {
    piece.going = true;
    const mid = piece.rect.y + piece.rect.h / 2;
    piece.aim({ x: card.x + 6, y: mid - BEAD / 2, w: BEAD, h: BEAD }, [
      SPILL_FAR,
      DRAIN,
      SPILL_NEAR,
      DRAIN,
    ]);
    this.engine.wake();
  }

  /** Out from under the card's edge at the row: it wells, then flows. */
  private pour(rect: Rect, card: Rect) {
    const mid = rect.y + rect.h / 2;
    const piece = this.add({
      x: card.x + 6,
      y: mid - BEAD / 2,
      w: BEAD,
      h: BEAD,
    });
    this.current = piece;
    this.appeared = true;
    piece.aim(
      {
        x: card.x - WELL,
        y: mid - WELL_SIZE / 2,
        w: WELL_SIZE + WELL,
        h: WELL_SIZE,
      },
      [SWELL, SWELL, SWELL, SWELL],
    );
    if (this.welling !== null) window.clearTimeout(this.welling);
    this.welling = window.setTimeout(() => {
      this.welling = null;
      if (this.current !== piece) return;
      // Wherever the row is by now.
      const goal = this.engine.target(this) ?? rect;
      piece.aim(goal, [SPILL_FAR, SPILL_NEAR, SPILL_NEAR, SPILL_NEAR]);
      this.engine.wake();
    }, WELL_TIME);
    this.engine.wake();
  }
}

/** One clock for every mark. */
export class MarkEngine {
  readonly groups: MarkGroup[] = [];
  private frame: number | null = null;
  private last = 0;
  private readonly targets = new Map<MarkGroup, Rect | null>();

  constructor(readonly layer: HTMLElement) {}

  group(className: string, mode: "slide" | "pour") {
    const group = new MarkGroup(this, className, mode);
    this.groups.push(group);
    return group;
  }

  /** The latest place a group was asked to be, for a pour that ends later. */
  remember(group: MarkGroup, rect: Rect | null) {
    this.targets.set(group, rect);
  }

  target(group: MarkGroup) {
    return this.targets.get(group) ?? null;
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

  private tick = (now: number) => {
    const elapsed = Math.min((now - this.last) / 1000, MAX_FRAME);
    this.last = now;
    let moving = false;
    let left = elapsed;
    while (left > 1e-6) {
      const dt = Math.min(STEP, left);
      left -= dt;
      for (const group of this.groups) if (group.step(dt)) moving = true;
    }
    for (const group of this.groups) {
      group.draw();
      if (group.busy) moving = true;
    }
    this.frame = moving ? requestAnimationFrame(this.tick) : null;
  };
}
