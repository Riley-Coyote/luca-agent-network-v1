import * as React from "react";

import { waterPalette } from "./inkPaints";
import { type InkColor, InkWaterEngine } from "./inkWaterEngine";

export type InkWaterHandle = {
  /** Let a bead of ink go at a point on screen (client px). */
  drop: (clientX: number, clientY: number, color: InkColor) => void;
  /** Open what was written behind a rect on screen as it sinks away. */
  release: (rect: DOMRect) => void;
  /** Keep the ink thin around a rect on screen (where words sit). */
  quiet: (rect: DOMRect | null) => void;
};

/** Seconds the water runs unseen before it opens, so it arrives alive. */
const WARM_SECONDS = 4.5;
const FADE_IN_MS = 1400;

/** The colour the water sits on: the first painted ancestor's background. */
function surfaceBehind(element: HTMLElement): InkColor {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const match = getComputedStyle(node).backgroundColor.match(
      /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/,
    );
    if (match && (match[4] === undefined || Number(match[4]) > 0.5)) {
      return [
        Number(match[1]) / 255,
        Number(match[2]) / 255,
        Number(match[3]) / 255,
      ];
    }
    node = node.parentElement;
  }
  return [0.063, 0.063, 0.063];
}

/**
 * Still, dark water with the app's own ink moving through it. Fills its
 * positioned parent and takes no pointer events; the pointer still stirs it.
 * With reduced motion it shows one settled moment and never moves.
 */
export const InkWater = React.forwardRef<
  InkWaterHandle,
  { className?: string; onUnavailable?: () => void }
>(function InkWater({ className, onUnavailable }, ref) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const engineRef = React.useRef<InkWaterEngine | null>(null);
  const unavailableRef = React.useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  const toUnit = React.useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [
      (clientX - rect.left) / rect.width,
      1 - (clientY - rect.top) / rect.height,
      rect.width,
      rect.height,
    ] as const;
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      drop(clientX, clientY, color) {
        const at = toUnit(clientX, clientY);
        if (at) engineRef.current?.drop(at[0], at[1], color);
      },
      release(rect) {
        const at = toUnit(rect.left + rect.width / 2, rect.bottom);
        if (at)
          engineRef.current?.release(at[0], at[1], (rect.width / at[2]) * 0.8);
      },
      quiet(rect) {
        if (!rect) {
          engineRef.current?.setQuiet(0.5, 0.5, 0, 0);
          return;
        }
        const at = toUnit(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        if (at) {
          engineRef.current?.setQuiet(
            at[0],
            at[1],
            (rect.width / at[2]) * 0.62,
            (rect.height / at[3]) * 1.1,
          );
        }
      },
    }),
    [toUnit],
  );

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // A fresh canvas for every mount: a disposed engine gives its context up
    // for good, so a canvas is never handed to a second engine.
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    canvasRef.current = canvas;
    const engine = InkWaterEngine.create(canvas);
    if (!engine) {
      canvas.remove();
      canvasRef.current = null;
      unavailableRef.current?.();
      return;
    }
    engineRef.current = engine;
    engine.configure(surfaceBehind(host), waterPalette());
    engine.warm(WARM_SECONDS);

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = performance.now();
    const born = last;
    let pointer: readonly [number, number] | null = null;
    // Draw at once, so the canvas is never blank: the bare surface to fade in
    // from, or, when this page can't animate yet, the water already settled.
    const held = document.hidden || motion.matches;
    engine.frame(0, held ? 1 : 0);

    const frame = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const t = held ? 1 : Math.min(1, (now - born) / FADE_IN_MS);
      // The size is checked where it is cheapest, on the frame itself: no
      // resize observer to be caught mid-layout when the conversation starts.
      engine.resize();
      engine.frame(dt, 1 - (1 - t) ** 3);
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const settle = () => {
      // One quiet moment, already settled, and no motion after it.
      stop();
      engine.resize();
      engine.frame(0, 1);
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
    const onVisibility = () => (document.hidden ? stop() : start());
    const onMotion = () => (motion.matches ? settle() : start());
    const onPointer = (event: PointerEvent) => {
      if (motion.matches) return;
      const at = toUnit(event.clientX, event.clientY);
      if (!at || at[0] < 0 || at[0] > 1 || at[1] < 0 || at[1] > 1) {
        pointer = null;
        return;
      }
      if (pointer)
        engine.stir(at[0], at[1], at[0] - pointer[0], at[1] - pointer[1]);
      pointer = [at[0], at[1]];
    };
    // While still (reduced motion), the window's own resize redraws it.
    const onResize = () => {
      if (motion.matches) settle();
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    window.addEventListener("pointermove", onPointer, { passive: true });
    start();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      window.removeEventListener("pointermove", onPointer);
      engineRef.current = null;
      engine.dispose();
      canvas.remove();
      canvasRef.current = null;
    };
  }, [toUnit]);

  return <div className={className} ref={hostRef} />;
});
