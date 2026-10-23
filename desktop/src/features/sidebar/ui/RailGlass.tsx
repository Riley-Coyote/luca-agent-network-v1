import * as React from "react";

import "./railGlass.css";

/**
 * THE RAIL'S GLASS SELECTION.
 *
 * One piece of clear glass under the selected row of a part of the rail; the
 * row's words stay above it. It is the only glass in the rail, and it is our
 * glass, drawn in the page (railGlass.css): a browser cannot draw Apple's.
 *
 * Its states and motions, the spec it is checked against:
 * - Rest: a capsule the row's size, still, on whole device pixels.
 * - A new row in the same part: it travels like a drop pulled by its leading
 *   edge. The edge facing the new row leaves on a quicker spring, the far edge
 *   follows on a slower one, so it stretches along the way, lands, and the
 *   far edge catches up; it thins a little while it is long, to keep its
 *   volume, and its rim catches the light while it moves (wet).
 * - The selection leaving this part (to the other part of the rail, or to a
 *   page with no row): it drains into its row's centre. Arriving in this
 *   part: it pours out of the new row's centre. Never a fade.
 * - The same row moving (a section opening above it, a resize): it follows at
 *   once. It is the same selection, so nothing travels.
 * - Scrolling: it lives inside the list, so it scrolls with the rows.
 * - Reduce Motion: it is simply where the selection is, at once.
 *
 * Springs are the house's, stepped 240 times a second on one clock, a frame
 * never longer than 1/30 s (the liquid-glass and black-fluid skills).
 */

type Motion = { response: number; damping: number };

/** The leading edge of a travel: quick, landing with a small settle. */
const LEAD: Motion = { response: 0.32, damping: 0.8 };
/** The trailing edge: a little slower, so the glass stretches along the way. */
const TRAIL: Motion = { response: 0.38, damping: 0.84 };
/** Poured out of a row (the house `pour`). */
const POUR: Motion = { response: 0.4, damping: 0.8 };
/** Drained into a row (the house `drain`). */
const DRAIN: Motion = { response: 0.32, damping: 0.94 };

const STEPS_PER_SECOND = 240;
const MAX_FRAME = 1 / 30;
/** The longest it stretches, in rows, however far it goes: past this the
 *  far edge is drawn along, as surface tension holds a drop together. At
 *  three rows a long move read as goo, not as a heavy piece of glass. */
const MAX_STRETCH = 1.8;
/** How much the glass thins as it stretches: width × (rest / length)^THIN. */
const THIN = 0.15;
/** Wet: the light catches from 30 px/s, fully by 350, in 0.07 s; dries in 0.5. */
const WET_FROM = 30;
const WET_OVER = 320;
const WET_CATCH = 0.07;
const WET_DRY = 0.5;

const ROW_SELECTOR =
  ':is([data-sidebar="menu-button"], [data-sidebar="menu-sub-button"])[data-active="true"]';

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

  snap(value: number) {
    this.x = value;
    this.to = value;
    this.v = 0;
  }

  get resting() {
    return Math.abs(this.x - this.to) < 0.02 && Math.abs(this.v) < 0.3;
  }
}

type Box = { top: number; bottom: number; left: number; right: number };

export function RailGlass() {
  const pillRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const pill = pillRef.current;
    const host = pill?.parentElement;
    if (!pill || !host) return;

    const top = new Spring(0);
    const bottom = new Spring(0);
    const left = new Spring(0);
    const right = new Spring(0);
    const edges = [top, bottom, left, right];
    let row: Element | null = null;
    let restHeight = 0;
    /** Which way a travel is going, for the far edge to be drawn along. */
    let heading: "up" | "down" | null = null;
    let shown = false;
    let wet = 0;
    let frame = 0;
    let last = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const boxOf = (element: Element): Box => {
      const at = host.getBoundingClientRect();
      const r = element.getBoundingClientRect();
      return {
        top: r.top - at.top,
        bottom: r.bottom - at.top,
        left: r.left - at.left,
        right: r.right - at.left,
      };
    };

    const aim = (box: Box, how: "travel" | "pour" | "snap") => {
      heading = null;
      if (how === "snap" || reduceMotion.matches) {
        top.snap(box.top);
        bottom.snap(box.bottom);
        left.snap(box.left);
        right.snap(box.right);
        return;
      }
      if (how === "pour") {
        const cy = (box.top + box.bottom) / 2;
        const cx = (box.left + box.right) / 2;
        top.snap(cy);
        bottom.snap(cy);
        left.snap(cx);
        right.snap(cx);
        for (const edge of edges) edge.motion = POUR;
      } else {
        const down = box.top > top.to;
        heading = down ? "down" : "up";
        top.motion = down ? TRAIL : LEAD;
        bottom.motion = down ? LEAD : TRAIL;
        left.motion = TRAIL;
        right.motion = TRAIL;
      }
      top.to = box.top;
      bottom.to = box.bottom;
      left.to = box.left;
      right.to = box.right;
    };

    const drain = () => {
      heading = null;
      if (reduceMotion.matches) {
        shown = false;
        return;
      }
      const cy = (top.x + bottom.x) / 2;
      const cx = (left.x + right.x) / 2;
      for (const edge of edges) edge.motion = DRAIN;
      top.to = cy;
      bottom.to = cy;
      left.to = cx;
      right.to = cx;
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const settled = edges.every((edge) => edge.resting) && wet < 0.002;
      // At rest, on whole device pixels: a fractional edge smears the hairline.
      const at = (value: number) =>
        settled ? Math.round(value * dpr) / dpr : value;
      const height = Math.max(0, bottom.x - top.x);
      const width = Math.max(0, right.x - left.x);
      const thin =
        restHeight > 0 && height > restHeight
          ? (restHeight / height) ** THIN
          : 1;
      const drawnWidth = width * thin;
      const x = left.x + (width - drawnWidth) / 2;
      const visible = shown && height > 0.5 && drawnWidth > 0.5;
      pill.style.visibility = visible ? "visible" : "hidden";
      pill.style.transform = `translate3d(${at(x)}px, ${at(top.x)}px, 0)`;
      pill.style.width = `${at(drawnWidth)}px`;
      pill.style.height = `${at(height)}px`;
      pill.style.setProperty("--rail-glass-wet", wet.toFixed(3));
    };

    const tick = (now: number) => {
      const dt = Math.min(MAX_FRAME, (now - last) / 1000);
      last = now;
      const steps = Math.max(1, Math.ceil(dt * STEPS_PER_SECOND));
      const longest = restHeight * MAX_STRETCH;
      for (let i = 0; i < steps; i += 1) {
        for (const edge of edges) edge.step(dt / steps);
        if (heading && bottom.x - top.x > longest) {
          const near = heading === "down" ? bottom : top;
          const far = heading === "down" ? top : bottom;
          far.x = heading === "down" ? near.x - longest : near.x + longest;
          far.v = near.v;
        }
      }
      const speed = Math.max(Math.abs(top.v), Math.abs(bottom.v));
      const wetTo = Math.min(1, Math.max(0, (speed - WET_FROM) / WET_OVER));
      const tau = wetTo > wet ? WET_CATCH : WET_DRY;
      wet += (wetTo - wet) * (1 - Math.exp(-dt / tau));
      // A drained piece is gone once it has closed.
      if (!row && Math.abs(bottom.x - top.x) < 0.5) shown = false;
      const moving = !edges.every((edge) => edge.resting) || wet >= 0.002;
      if (!moving) wet = 0;
      draw();
      frame = moving ? requestAnimationFrame(tick) : 0;
    };

    const run = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };

    const measure = (first: boolean) => {
      const next = host.querySelector(ROW_SELECTOR);
      const visible = next && next.getBoundingClientRect().height > 0;
      if (!next || !visible) {
        if (row) {
          row = null;
          drain();
          run();
        }
        return;
      }
      const box = boxOf(next);
      restHeight = box.bottom - box.top;
      if (first || reduceMotion.matches) {
        aim(box, "snap");
      } else if (!row) {
        aim(box, "pour");
      } else if (next === row) {
        aim(box, "snap");
      } else {
        aim(box, "travel");
      }
      row = next;
      shown = true;
      draw();
      run();
    };

    measure(true);

    // A selection is an attribute changing; a moved row is a resize of the
    // list. Both are read on the next frame, once React has finished.
    let pending = 0;
    const later = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        measure(false);
      });
    };
    const mutations = new MutationObserver(later);
    mutations.observe(host, {
      attributeFilter: ["data-active"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    const resizes = new ResizeObserver(later);
    resizes.observe(host);
    window.addEventListener("resize", later);

    return () => {
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", later);
      if (frame) cancelAnimationFrame(frame);
      if (pending) cancelAnimationFrame(pending);
    };
  }, []);

  return <div aria-hidden="true" className="luca-rail-glass" ref={pillRef} />;
}
