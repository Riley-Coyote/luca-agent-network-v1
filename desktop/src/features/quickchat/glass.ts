/**
 * THE MINI CHAT ON THE FLOOR'S GLASS (Riley, 2026-10-27: "i would like for it
 * to be glass, so it feels like its cohesive with the apps material and looks
 * like the same material as the icon rail/floor material").
 *
 * Under the glass frame (shell-glass.css, `:root[data-luca-frame-glass]`) the
 * mini chat is the floor's glass carried over the page (quickchat.css): the
 * tone Apple's regular glass gives what lies beneath it, with the frame's own
 * veil in front, over the conversation that is really there. Showing the
 * floor itself through a hole in the page was tried first and failed in the
 * real window: the floor looks through the window, so the mini chat showed
 * the windows behind the app (Riley, 2026-10-27: "it shows content behind it
 * that isnt there"). Glass can't be faded, so the mini chat changes form
 * instead: the launcher's disc spreads into a line along the window's foot,
 * rises into the panel, and drains back home the same way, on the
 * liquid-glass skill's springs (references/motion.md).
 *
 * Pure geometry and springs; useQuickChatGlass.ts runs them on the page.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type Shape = Box & { r: number };

/** SwiftUI's spring: a response in seconds and a damping fraction. */
export type SpringSpec = { response: number; damping: number };
export type SpringState = { value: number; velocity: number; target: number };

/** Opening grows without a bounce (the one window's own spring); closing
 *  drains home a little quicker, never past (motion.md, "drain"). */
export const GROW: SpringSpec = { response: 0.42, damping: 0.86 };
export const DRAIN: SpringSpec = { response: 0.32, damping: 0.94 };

/** How long the leading axis moves alone: width first on the way out (the
 *  disc becomes the line, then the window rises from it), height first on
 *  the way home (the window sinks to the line, then the line draws in). */
export const LEAD_S = 0.06;

/** The launcher: a disc this wide, sharing the panel's bottom-right corner
 *  (quickchat.css: both sit 20 from the window's corner). */
export const LAUNCHER = 46;
/** The panel's corners: the window's own (SHELL_SPEC.md, "Corners"), so the
 *  mini chat reads as a small window of the same glass. */
export const PANEL_RADIUS = 16;
/** How far past the launcher the shorter side grows before the corners are
 *  the panel's: until then the shape is a disc, then a capsule (the line). */
const ROUNDING_SPAN = 40;

/** Every spring steps 240 times a second, whatever the frame rate (motion.md,
 *  "The clock"); a slow frame never makes a jump. */
const SUBSTEP_S = 1 / 240;
export const MAX_FRAME_S = 1 / 30;

export function stepSpring(
  spring: SpringState,
  spec: SpringSpec,
  seconds: number,
): SpringState {
  const stiffness = ((2 * Math.PI) / spec.response) ** 2;
  const friction = (4 * Math.PI * spec.damping) / spec.response;
  const count = Math.max(1, Math.ceil(seconds / SUBSTEP_S));
  const h = seconds / count;
  let { value, velocity } = spring;
  for (let step = 0; step < count; step += 1) {
    velocity +=
      (-stiffness * (value - spring.target) - friction * velocity) * h;
    value += velocity * h;
  }
  return { value, velocity, target: spring.target };
}

export const isResting = (spring: SpringState) =>
  Math.abs(spring.value - spring.target) < 0.02 &&
  Math.abs(spring.velocity) < 0.3;

/** At rest exactly on its target: a shape left a hair short puts every word
 *  between pixels. */
export const settle = (spring: SpringState): SpringState => ({
  value: spring.target,
  velocity: 0,
  target: spring.target,
});

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** The shape at this width and height, its bottom-right corner held: a disc
 *  at the launcher's size, a capsule while only the width has grown, and the
 *  panel's corners once both sides have. */
export function shapeAt(
  corner: { right: number; bottom: number },
  w: number,
  h: number,
  radius = PANEL_RADIUS,
): Shape {
  const width = Math.max(0, w);
  const height = Math.max(0, h);
  const grown = clamp01((Math.min(width, height) - LAUNCHER) / ROUNDING_SPAN);
  const round = LAUNCHER / 2 + (radius - LAUNCHER / 2) * grown;
  return {
    x: corner.right - width,
    y: corner.bottom - height,
    w: width,
    h: height,
    r: Math.max(0, Math.min(round, width / 2, height / 2)),
  };
}

/** How far the panel's height has risen out of the launcher: 0 at the disc
 *  or the line, 1 at the panel. */
export const risen = (h: number, panelHeight: number) =>
  panelHeight <= LAUNCHER
    ? 1
    : clamp01((h - LAUNCHER) / (panelHeight - LAUNCHER));

/**
 * How much of the panel's words show, from how far it has risen. Laid out
 * whole at their full size from the start and cut to the glass as it rises,
 * they come in once the window is mostly there; going home, they go first
 * (the liquid-glass skill's pour and gather).
 */
export const wordsShown = (rise: number, opening: boolean) =>
  opening ? smoothstep(0.5, 0.85, rise) : smoothstep(0.82, 0.98, rise);

/** The launcher's mark leaves as the disc starts to spread, and is back once
 *  the shape has drained home. */
export const markShown = (w: number, h: number) =>
  1 - smoothstep(0, 18, Math.max(w, h) - LAUNCHER);

const n = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

/** The panel cut to the shape while it grows or drains, as an inset in the
 *  panel's own box. */
export function panelClip(panel: Box, shape: Shape) {
  const top = Math.max(0, shape.y - panel.y);
  const left = Math.max(0, shape.x - panel.x);
  const right = Math.max(0, panel.x + panel.w - (shape.x + shape.w));
  const bottom = Math.max(0, panel.y + panel.h - (shape.y + shape.h));
  return `inset(${n(top)}px ${n(right)}px ${n(bottom)}px ${n(left)}px round ${n(shape.r)}px)`;
}
