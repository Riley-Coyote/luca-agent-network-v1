import * as React from "react";

import type { BookMemory } from "../book";
import { cellOfMemory, drawingWords, type HerbariumCell } from "./drawingShape";

/** The copied herbarium (`public/mnemos-mind/shared/herbarium/`), loaded
 *  from the app's own files as it is, never bundled or changed. */
const FIGURE = "/mnemos-mind/shared/herbarium/figure.js";

type Family = {
  nodes: number[];
  pairs: never[];
  gen: Map<number, number>;
  depth: number;
};
type Figure = unknown;
type Herbarium = {
  composeFamily: (
    model: { cells: HerbariumCell[]; index: Map<string, number> },
    family: Family,
    box: { w: number; h: number },
    options: { kMax: number; pad: number },
  ) => Figure;
  drawFamily: (
    ctx: CanvasRenderingContext2D,
    fig: Figure,
    options: {
      ink: number[];
      paper: string;
      signal: string;
      t: number;
      progress: number;
      hover: number;
    },
  ) => void;
};

let herbarium: Promise<Herbarium> | null = null;
const loadHerbarium = () => {
  herbarium ??= import(/* @vite-ignore */ FIGURE).then(
    (m) => m as Herbarium,
    (error: unknown) => {
      herbarium = null;
      throw error;
    },
  );
  return herbarium;
};

/** How long the plate takes to engrave itself, as the notebook's does. */
const ENGRAVE_MS = 800;

const rgbOf = (css: string) =>
  (css.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);

function paperOf(el: Element): string {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const v = getComputedStyle(at).backgroundColor;
    const alpha = v.match(/[\d.]+/g)?.[3];
    if (
      v &&
      v !== "transparent" &&
      (alpha === undefined || Number(alpha) >= 0.99)
    )
      return v;
  }
  return "rgb(0 0 0)";
}

/**
 * One memory as the notebook draws it up close (WP-50, Decided 8): the
 * herbarium's specimen, its size how strongly it's kept, a spine for each
 * link, a ring for each doubling of the times it came back. Drawn in the
 * page's ink (`currentColor`), at the size its box is given, with the words
 * for what it shows as its text alternative. It takes one memory and
 * nothing else.
 */
export function MemoryDrawing({ memory }: { memory: BookMemory }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const cell = React.useMemo(() => cellOfMemory(memory), [memory]);
  const words = React.useMemo(() => drawingWords(memory), [memory]);
  React.useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let current = true;
    let raf = 0;
    let start = -1;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (h: Herbarium) => {
      const w = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      if (!w || !height) return;
      const dpr = Math.min(devicePixelRatio || 1, 3);
      el.width = w * dpr;
      el.height = height * dpr;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const fig = h.composeFamily(
        { cells: [cell], index: new Map([[cell.id, 0]]) },
        { nodes: [0], pairs: [], gen: new Map([[0, 0]]), depth: 1 },
        { w, h: height },
        { kMax: Math.min(w, height) * 0.43, pad: 4 },
      );
      const style = getComputedStyle(el);
      const ink = rgbOf(style.color);
      const paper = paperOf(el);
      const signal = style.getPropertyValue("--mn-signal").trim();
      const frame = (now: number) => {
        if (!current) return;
        if (start < 0) start = now;
        const progress = calm ? 1 : Math.min(1, (now - start) / ENGRAVE_MS);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, height);
        h.drawFamily(ctx, fig, {
          ink,
          paper,
          signal: signal ? `hsl(${signal})` : "#6d93c9",
          t: 0,
          progress,
          hover: 0,
        });
        raf = progress < 1 ? requestAnimationFrame(frame) : 0;
      };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };
    let loaded: Herbarium | null = null;
    loadHerbarium().then(
      (h) => {
        if (!current) return;
        loaded = h;
        draw(h);
      },
      () => {
        // Not drawn; its words still say what it is.
      },
    );
    const observer = new ResizeObserver(() => {
      if (loaded) draw(loaded);
    });
    observer.observe(el);
    return () => {
      current = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [cell]);
  return (
    <canvas
      aria-label={words}
      className="luca-mnemos-drawing"
      data-testid="mnemos-memory-drawing"
      ref={canvas}
      role="img"
    />
  );
}
