/**
 * Ghost's eyes, as Prompt Ghost draws them (GhostEyes, by way of its lab's
 * eyes.js), at any size: on a drop of radius 15 at scale 1, on a body of
 * radius R at R / 15, so they keep their proportions however big the body is.
 * At rest they're lidded a third; a blink brings the lid down on a curve and
 * shut they're a short soft line. Crisp, with no glow around them.
 */
export const GHOST_EYE = {
  width: 5.4,
  height: 8.6,
  gap: 13.5,
  reachX: 4.4,
  reachY: 1.9,
  restingLid: 0.33,
} as const;

export const GHOST_EYE_INK = "rgb(238, 242, 248)";

export type GhostEyeState = {
  /** Where they look, -1 .. 1 across and down. */
  gazeX: number;
  gazeY: number;
  /** The upper lid: 0 open, 1 shut. */
  lid: number;
};

/** How far a blink has brought the lid down, `since` seconds after it began. */
export function blinkAmount(since: number) {
  if (since < 0) return 0;
  if (since < 0.075) {
    const p = since / 0.075;
    return p * p;
  }
  if (since < 0.105) return 1;
  if (since < 0.235) {
    const p = (since - 0.105) / 0.13;
    return (1 - p) * (1 - p);
  }
  return 0;
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawEye(
  c: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  side: -1 | 1,
  state: GhostEyeState,
  k: number,
) {
  const { gazeX: gx, gazeY: gy } = state;
  const far = (gx > 0 && side < 0) || (gx < 0 && side > 0) ? 1 : 0;
  let w = GHOST_EYE.width * k * (1 - 0.13 * Math.abs(gx));
  const h = GHOST_EYE.height * k * (1 - 0.08 * Math.abs(gx) * far);
  const cx = x0 + (side * GHOST_EYE.gap * k) / 2 + gx * GHOST_EYE.reachX * k;
  const cy = y0 + gy * GHOST_EYE.reachY * k;
  if (1 - state.lid < 0.12) {
    w += 1.6 * k;
    roundRect(c, cx - w / 2, cy + h * 0.22 - 0.7 * k, w, 1.4 * k, 0.7 * k);
    c.fill();
    return;
  }
  c.save();
  c.beginPath();
  c.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  c.fill();
  // The lid comes down on a curve: cut away above it.
  c.globalCompositeOperation = "destination-out";
  const edge = cy - h / 2 + h * state.lid * 0.95;
  c.beginPath();
  c.ellipse(cx, edge - h * 0.9, w * 1.3, h * 0.9, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Both eyes, centred at (x, y) on a body of radius `radius`, onto a canvas of their own. */
export function drawGhostEyes(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  state: GhostEyeState,
) {
  const k = radius / 15;
  c.fillStyle = GHOST_EYE_INK;
  drawEye(c, x, y, -1, state, k);
  drawEye(c, x, y, 1, state, k);
}
