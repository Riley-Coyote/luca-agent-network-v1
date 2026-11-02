import * as React from "react";
import {
  type Box,
  DRAIN,
  GROW,
  isResting,
  LAUNCHER,
  LEAD_S,
  MAX_FRAME_S,
  markShown,
  panelClip,
  risen,
  type Shape,
  type SpringState,
  settle,
  shapeAt,
  stepSpring,
  wordsShown,
} from "../glass";

/** ThemeProvider marks `<html>` with this only while the frame's glass is
 *  really beneath the page (Liquid Glass, or the frosted fallback): never in
 *  a browser, the classic layout, the solid frame or Reduce Transparency. */
const FRAME_GLASS = "data-luca-frame-glass";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function useFrameGlass() {
  const [glass, setGlass] = React.useState(() =>
    document.documentElement.hasAttribute(FRAME_GLASS),
  );
  React.useEffect(() => {
    const root = document.documentElement;
    const read = () => setGlass(root.hasAttribute(FRAME_GLASS));
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: [FRAME_GLASS] });
    return () => watch.disconnect();
  }, []);
  return glass;
}

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(
    () => window.matchMedia(REDUCED_MOTION).matches,
  );
  React.useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION);
    const change = () => setReduced(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return reduced;
}

type Motion = {
  w: SpringState;
  h: SpringState;
  /** The bottom-right corner the launcher and the panel share. */
  corner: { right: number; bottom: number };
  /** The panel's box while it is on the page, for its clip and its rise. */
  panel: Box | null;
  opening: boolean;
  /** Seconds before each axis starts: the leading one moves first. */
  waitW: number;
  waitH: number;
  frame: number;
  last: number;
  placed: boolean;
};

const box = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
};

const still = (value: number): SpringState => ({
  value,
  velocity: 0,
  target: value,
});

/**
 * The mini chat as glass while the frame is drawn as glass:
 * - `drawn`: whether it is;
 * - `leaving`: the panel stays on the page, words gone, while its glass
 *   drains back into the launcher;
 * - the refs: the glass itself (the shape, its light, its shadow and the
 *   launcher's mark), the panel and the launcher.
 * Every frame the same shape is drawn twice: as the glass, and as the
 * panel's clip, so the words are only ever on the glass.
 */
export function useQuickChatGlass({ open }: { open: boolean }) {
  const drawn = useFrameGlass();
  const reduced = useReducedMotion();
  const shell = React.useRef<HTMLDivElement>(null);
  const mark = React.useRef<SVGSVGElement>(null);
  const panel = React.useRef<HTMLElement>(null);
  const launcher = React.useRef<HTMLButtonElement>(null);
  const motion = React.useRef<Motion | null>(null);

  // Closing keeps the panel on the page until its glass is home. Settled in
  // the same render as `open`, so the panel is never unmounted in between.
  const [leaving, setLeaving] = React.useState(false);
  const [seenOpen, setSeenOpen] = React.useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    setLeaving(!open && drawn && !reduced);
  }
  if (leaving && (!drawn || reduced)) setLeaving(false);

  const draw = React.useCallback((done: boolean) => {
    const state = motion.current;
    const element = shell.current;
    if (!state || !element) return;
    const shape: Shape = shapeAt(state.corner, state.w.value, state.h.value);
    element.dataset.placed = "";
    // Home: closed and still, the launcher is its mark alone (quickchat.css).
    element.toggleAttribute("data-home", done && !state.opening);
    element.style.left = `${shape.x}px`;
    element.style.top = `${shape.y}px`;
    element.style.width = `${shape.w}px`;
    element.style.height = `${shape.h}px`;
    element.style.borderRadius = `${shape.r}px`;
    element.style.setProperty("--qc-glass-r", `${shape.r}px`);
    if (mark.current) {
      mark.current.style.opacity = String(markShown(shape.w, shape.h));
    }
    const words = panel.current;
    if (words && state.panel) {
      const atRest = done && state.opening;
      words.style.clipPath = atRest ? "" : panelClip(state.panel, shape);
      words.style.opacity = atRest
        ? ""
        : String(wordsShown(risen(shape.h, state.panel.h), state.opening));
    }
  }, []);

  const tick = React.useCallback(
    (now: number) => {
      const state = motion.current;
      if (!state) return;
      const seconds = Math.min(
        MAX_FRAME_S,
        Math.max(0, (now - state.last) / 1000),
      );
      state.last = now;
      const spec = state.opening ? GROW : DRAIN;
      if (state.waitW > 0) state.waitW -= seconds;
      else state.w = stepSpring(state.w, spec, seconds);
      if (state.waitH > 0) state.waitH -= seconds;
      else state.h = stepSpring(state.h, spec, seconds);
      const done =
        state.waitW <= 0 &&
        state.waitH <= 0 &&
        isResting(state.w) &&
        isResting(state.h);
      if (done) {
        state.w = settle(state.w);
        state.h = settle(state.h);
      }
      draw(done);
      if (!done) {
        state.frame = requestAnimationFrame(tick);
        return;
      }
      state.frame = 0;
      if (!state.opening) {
        state.panel = null;
        setLeaving(false);
      }
    },
    [draw],
  );

  /** Where the shape is going: the panel when it is open, the launcher's disc
   *  otherwise, from the corner they share. Placed at once the first time,
   *  under Reduce Motion, and whenever `immediate`; otherwise it moves there
   *  from wherever it is, the leading axis first. */
  const aim = React.useCallback(
    (immediate: boolean) => {
      const from = panel.current ?? launcher.current;
      if (!from) return;
      const target = box(from);
      const corner = {
        right: target.x + target.w,
        bottom: target.y + target.h,
      };
      const panelBox = panel.current ? box(panel.current) : null;
      const w = open && panelBox ? panelBox.w : LAUNCHER;
      const h = open && panelBox ? panelBox.h : LAUNCHER;
      const current = motion.current;
      const place = immediate || reduced || !current?.placed;
      const state: Motion = {
        w: place ? still(w) : { ...current.w, target: w },
        h: place ? still(h) : { ...current.h, target: h },
        corner,
        panel: panelBox,
        opening: open,
        waitW: place || open ? 0 : LEAD_S,
        waitH: place || !open ? 0 : LEAD_S,
        frame: current?.frame ?? 0,
        last: performance.now(),
        placed: true,
      };
      // A move already under way keeps its axes' head start.
      if (!place && current && current.opening === open) {
        state.waitW = current.waitW;
        state.waitH = current.waitH;
      }
      motion.current = state;
      if (place) {
        if (state.frame) cancelAnimationFrame(state.frame);
        state.frame = 0;
        draw(true);
        if (!open && current?.panel) setLeaving(false);
        return;
      }
      draw(false);
      if (!state.frame) state.frame = requestAnimationFrame(tick);
    },
    [draw, open, reduced, tick],
  );

  // The shape follows the mini chat opening and closing.
  React.useLayoutEffect(() => {
    if (!drawn) return;
    aim(false);
  }, [aim, drawn]);

  // The window or the panel resized: the shape follows at once when it is at
  // rest, and keeps moving to the new size when it isn't.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open and leaving mount and unmount the panel this watches
  React.useEffect(() => {
    if (!drawn) return;
    const follow = () => aim(!motion.current?.frame);
    const resizes = new ResizeObserver(follow);
    if (panel.current) resizes.observe(panel.current);
    window.addEventListener("resize", follow);
    return () => {
      resizes.disconnect();
      window.removeEventListener("resize", follow);
    };
  }, [aim, drawn, open, leaving]);

  // The glass gone (the frame no longer glass, the mini chat unmounted):
  // nothing is moving.
  React.useLayoutEffect(() => {
    if (!drawn) return;
    return () => {
      const state = motion.current;
      if (state?.frame) cancelAnimationFrame(state.frame);
      motion.current = null;
    };
  }, [drawn]);

  return { drawn, leaving, shell, mark, panel, launcher };
}
