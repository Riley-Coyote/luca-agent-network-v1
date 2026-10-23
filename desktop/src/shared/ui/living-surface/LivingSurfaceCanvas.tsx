import * as React from "react";

import { createLivingSurface } from "./createLivingSurface";
import type {
  LivingSurface,
  LivingSurfaceKind,
  SurfaceBox,
  SurfaceColor,
} from "./types";

/** What the page tells a living surface, in client pixels. */
export type LivingSurfaceHandle = {
  /** A keystroke at a point on screen. */
  pulse: (clientX: number, clientY: number) => void;
  /** The first message going in, from the composer's rect. */
  release: (rect: DOMRect) => void;
  /** Where the words are, line by line. */
  wells: (rects: readonly DOMRect[]) => void;
  /** The one you are about to talk to: a round body in this rect, or no one. */
  body: (rect: DOMRect | null) => void;
  /** The composer as glass, its corner radius in pixels, and its own colour. */
  glass: (rect: DOMRect | null, radius: number, fill: SurfaceColor) => void;
};

/** The colour the surface sits on: the first painted ancestor's background. */
function surfaceBehind(element: HTMLElement): SurfaceColor {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (color) return color;
    node = node.parentElement;
  }
  return [0.063, 0.063, 0.063];
}

/** An opaque rgb() or rgba() as sRGB 0..1, or null when it's see-through. */
export function parseColor(value: string): SurfaceColor | null {
  const match = value.match(
    /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/,
  );
  if (!match || (match[4] !== undefined && Number(match[4]) <= 0.5))
    return null;
  return [
    Number(match[1]) / 255,
    Number(match[2]) / 255,
    Number(match[3]) / 255,
  ];
}

/**
 * A living surface on a canvas that fills its positioned parent and takes no
 * pointer events; the pointer still stirs it, and presses on it where nothing
 * else on the page wants the press. `beforeFrame` runs on every frame just
 * before it draws, so whatever it measures is never a frame behind. With
 * reduced motion it shows one settled moment and never moves.
 */
export const LivingSurfaceCanvas = React.forwardRef<
  LivingSurfaceHandle,
  {
    kind: LivingSurfaceKind;
    className?: string;
    /** How long the surface runs unseen before it opens; with reduced motion, how long it settles. */
    warmSeconds?: number;
    settledSeconds?: number;
    beforeFrame?: () => void;
    /** Whether a press at this target belongs to the surface. */
    pressable?: (target: EventTarget | null) => boolean;
    onUnavailable?: () => void;
  }
>(function LivingSurfaceCanvas(
  {
    kind,
    className,
    warmSeconds = 0,
    settledSeconds = 9,
    beforeFrame,
    pressable,
    onUnavailable,
  },
  ref,
) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = React.useRef<LivingSurface | null>(null);
  const latest = React.useRef({ beforeFrame, pressable, onUnavailable });
  latest.current = { beforeFrame, pressable, onUnavailable };

  const toUnit = React.useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (clientX - rect.left) / rect.width,
      y: 1 - (clientY - rect.top) / rect.height,
      width: rect.width,
      height: rect.height,
    };
  }, []);

  const toBox = React.useCallback(
    (rect: DOMRect, radius = 0): SurfaceBox | null => {
      const at = toUnit(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!at) return null;
      return {
        x: at.x,
        y: at.y,
        halfWidth: rect.width / 2 / at.width,
        halfHeight: rect.height / 2 / at.height,
        radius: radius / at.width,
      };
    },
    [toUnit],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      pulse(clientX, clientY) {
        const at = toUnit(clientX, clientY);
        if (at) surfaceRef.current?.pulse(at.x, at.y);
      },
      release(rect) {
        const at = toUnit(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        if (at) surfaceRef.current?.release(at.x, at.y, rect.width / at.width);
      },
      wells(rects) {
        const surface = surfaceRef.current;
        if (!surface) return;
        surface.setWells(
          rects.flatMap((rect) => {
            const box = toBox(rect);
            return box ? [box] : [];
          }),
        );
      },
      body(rect) {
        const surface = surfaceRef.current;
        if (!surface) return;
        if (!rect) {
          surface.setBody(null);
          return;
        }
        const at = toUnit(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        if (at)
          surface.setBody({
            x: at.x,
            y: at.y,
            radius: rect.width / 2 / at.width,
          });
      },
      glass(rect, radius, fill) {
        surfaceRef.current?.setGlass(rect ? toBox(rect, radius) : null, fill);
      },
    }),
    [toBox, toUnit],
  );

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // A fresh canvas for every mount: a disposed surface gives its context up
    // for good, so a canvas is never handed to a second one.
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    canvasRef.current = canvas;
    const surface = createLivingSurface(kind, canvas);
    if (!surface) {
      canvas.remove();
      canvasRef.current = null;
      latest.current.onUnavailable?.();
      return;
    }
    surfaceRef.current = surface;
    surface.configure(surfaceBehind(host));

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = performance.now();
    let pointer: { x: number; y: number } | null = null;
    const settle = () => {
      // One quiet moment, already settled, and no motion after it.
      cancelAnimationFrame(raf);
      raf = 0;
      surface.resize();
      latest.current.beforeFrame?.();
      surface.warm(settledSeconds);
      surface.frame(0, 1);
    };
    const frame = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      // The size is checked where it is cheapest, on the frame itself: no
      // resize observer to be caught mid-layout when the conversation starts.
      surface.resize();
      latest.current.beforeFrame?.();
      surface.frame(dt, 1);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (motion.matches) {
        settle();
        return;
      }
      if (!raf && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    surface.resize();
    latest.current.beforeFrame?.();
    if (warmSeconds > 0) surface.warm(warmSeconds);
    // Draw at once, so the canvas is never blank.
    surface.frame(0, 1);

    const onVisibility = () => (document.hidden ? stop() : start());
    const onMotion = () => (motion.matches ? settle() : start());
    const onPointerMove = (event: PointerEvent) => {
      if (motion.matches) return;
      const at = toUnit(event.clientX, event.clientY);
      if (!at || at.x < 0 || at.x > 1 || at.y < 0 || at.y > 1) {
        pointer = null;
        return;
      }
      if (pointer) surface.stir(at.x, at.y, at.x - pointer.x, at.y - pointer.y);
      pointer = { x: at.x, y: at.y };
    };
    const onPointerDown = (event: PointerEvent) => {
      if (motion.matches || event.button !== 0) return;
      if (!latest.current.pressable?.(event.target)) return;
      const at = toUnit(event.clientX, event.clientY);
      if (at && at.x >= 0 && at.x <= 1 && at.y >= 0 && at.y <= 1) {
        surface.press(at.x, at.y, true);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const at = toUnit(event.clientX, event.clientY);
      if (at) surface.press(at.x, at.y, false);
    };
    // While still (reduced motion), the window's own resize redraws it.
    const onResize = () => {
      if (motion.matches) settle();
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    start();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      surfaceRef.current = null;
      surface.dispose();
      canvas.remove();
      canvasRef.current = null;
    };
  }, [kind, settledSeconds, toUnit, warmSeconds]);

  return <div className={className} ref={hostRef} />;
});
