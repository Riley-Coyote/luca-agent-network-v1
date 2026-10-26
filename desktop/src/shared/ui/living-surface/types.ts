/**
 * A living surface: what fills the first-message view behind the composer.
 * Every surface answers the same few things, so the view never needs to know
 * which one it is showing. Coordinates are the canvas's own unit square, with
 * the origin at the bottom left.
 */
export type SurfaceColor = readonly [number, number, number];

/** A box: its centre and half its size in the unit square, its corners' radius as a share of the width. */
export type SurfaceBox = {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  radius?: number;
};

/** A round body: its centre in the unit square, its radius as a share of the width. */
export type SurfaceBody = { x: number; y: number; radius: number };

export interface LivingSurface {
  /** The colour the surface sits on (sRGB 0..1). */
  configure(surface: SurfaceColor): void;
  /** Where each line of words is: the surface keeps quiet under them. */
  setWells(boxes: readonly SurfaceBox[]): void;
  /** The one you are about to talk to, as a body of the surface's own, or no one. */
  setBody(body: SurfaceBody | null): void;
  /** The composer, drawn as glass over the surface, and its own colour once it settles. */
  setGlass(box: SurfaceBox | null, fill: SurfaceColor): void;
  /** A keystroke at a point. */
  pulse(x: number, y: number): void;
  /** The pointer moving across it. */
  stir(x: number, y: number, dx: number, dy: number): void;
  /** The pointer pressing on it, and letting go. */
  press(x: number, y: number, down: boolean): void;
  /** The first message going in, from the composer's place and width. */
  release(x: number, y: number, width: number): void;
  /** Run unseen until it has had `seconds` of life, so it opens already alive; `paced`, a share at a time as the
   *  GPU keeps up, never all at once. Whether it has had its life, and shows it. */
  warm(seconds: number, paced?: boolean): boolean;
  /** Advance by dt seconds and draw, faded in by `fade` (0..1). */
  frame(dt: number, fade: number): void;
  /** Match the drawing buffer to the canvas's size. */
  resize(): void;
  dispose(): void;
}

export type LivingSurfaceKind = "turing";
