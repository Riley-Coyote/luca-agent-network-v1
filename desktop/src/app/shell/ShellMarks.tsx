import * as React from "react";

import { MarkEngine, type MarkGroup, type Rect } from "@/app/shell/marks";

/**
 * WHERE YOU ARE (docs/luca/rail-system/SHELL_SPEC.md, "Where you are"): two
 * solid marks under the frame, each on its own layer beneath the words it
 * marks, moved by the marks' engine (marks.ts).
 *
 * - The places' mark, on the current place's tile (`data-current`).
 * - The rail's mark, on the home row of what is open (`data-active`), in the
 *   rail card's own coordinates: it scrolls with the rows and the card clips
 *   it. The open session under it is lit, not marked (shell-rail.css). While
 *   the rail's card is closed there is no mark; opening, it swells back once
 *   the card has slid open.
 *
 * The material is a data choice, one attribute on the layer
 * (`data-mark-material`): the plate on the Black frame, a piece of the card
 * on a glass frame (shell-marks.css). The marks are decorative; where you are
 * is said by `aria-current` on the place and the row.
 */

export type MarkMaterial = "plate" | "card";

/** The rail's card opens over 460 ms (shell-frame.css); its mark returns
 *  when it has. */
const RAIL_SLIDE_MS = 460;

const ACTIVE_HOME_ROW =
  '[data-sidebar="menu-button"][data-home][data-active="true"]';

const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** `element`'s box in `layer`'s coordinates, or nothing to mark. */
function boxIn(layer: HTMLElement, element: Element | null): Rect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const origin = layer.getBoundingClientRect();
  return {
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    w: rect.width,
    h: rect.height,
  };
}

/** One engine and one group on the layer, for as long as it is mounted. */
function useMarkGroup(
  layerRef: React.RefObject<HTMLDivElement | null>,
  className: string,
  sync: (group: MarkGroup, layer: HTMLDivElement) => void,
) {
  const groupRef = React.useRef<MarkGroup | null>(null);
  const syncRef = React.useRef(sync);
  syncRef.current = sync;
  const run = React.useCallback(() => {
    const layer = layerRef.current;
    const group = groupRef.current;
    if (layer && group) syncRef.current(group, layer);
  }, [layerRef]);
  React.useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const engine = new MarkEngine(layer);
    groupRef.current = engine.group(className);
    run();
    return () => {
      engine.stop();
      groupRef.current = null;
    };
  }, [className, layerRef, run]);
  return run;
}

/** The places' mark, on the current place's tile. */
export function ShellPlacesMarks({
  current,
  material = "plate",
}: {
  /** The current place, or none: a page with no place closes the mark. */
  current: string | null;
  material?: MarkMaterial;
}) {
  const layerRef = React.useRef<HTMLDivElement>(null);
  const sync = useMarkGroup(
    layerRef,
    "luca-mark luca-mark--place",
    (group, layer) => {
      const tile = current
        ? layer.parentElement?.querySelector<HTMLElement>(
            '.luca-place[data-current="true"]',
          )
        : null;
      group.show(tile?.dataset.testid ?? null, boxIn(layer, tile ?? null));
    },
  );

  React.useLayoutEffect(() => {
    sync();
  });

  React.useEffect(() => {
    const host = layerRef.current?.parentElement;
    if (!host) return;
    const resizes = new ResizeObserver(() => sync());
    resizes.observe(host);
    window.addEventListener("resize", sync);
    void document.fonts?.ready.then(() => sync());
    return () => {
      resizes.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  return (
    <div
      aria-hidden="true"
      className="luca-marks"
      data-mark-material={material}
      data-testid="shell-places-marks"
      ref={layerRef}
    />
  );
}

/** The rail's mark, on the home row of what is open. */
export function ShellRailMarks({
  material = "plate",
}: {
  material?: MarkMaterial;
}) {
  const layerRef = React.useRef<HTMLDivElement>(null);
  // Whether the rail's card is open (or peeking) and done sliding.
  const shownRef = React.useRef(false);
  const sync = useMarkGroup(
    layerRef,
    "luca-mark luca-mark--row",
    (group, layer) => {
      const row = shownRef.current
        ? layer.parentElement?.querySelector(ACTIVE_HOME_ROW)
        : null;
      group.show(
        row?.getAttribute("data-home") ?? null,
        boxIn(layer, row ?? null),
      );
    },
  );

  React.useEffect(() => {
    const layer = layerRef.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    // The rail's card: open, closed or peeking, on its frame's wrapper.
    const wrapper = layer.closest<HTMLElement>("[data-frame]");
    const open = () =>
      !wrapper ||
      wrapper.dataset.state === "expanded" ||
      wrapper.dataset.peek === "true";
    let timer = 0;
    const follow = () => {
      window.clearTimeout(timer);
      if (!open()) {
        shownRef.current = false;
        sync();
        return;
      }
      if (shownRef.current) return;
      if (reduceMotion()) {
        shownRef.current = true;
        sync();
        return;
      }
      timer = window.setTimeout(() => {
        shownRef.current = true;
        sync();
      }, RAIL_SLIDE_MS);
    };
    // Open at first, the mark is simply there.
    shownRef.current = open();
    sync();

    // The narrow window's sheet opens under the pointer that pressed the
    // lip's toggle; until it moves, the row it rests on is not lit as if
    // hovered, so it never reads as a second mark (shell-marks.css).
    const sheet = layer.closest<HTMLElement>('[data-mobile="true"]');
    const pointerMoved = () => sheet?.removeAttribute("data-pointer-still");
    if (sheet) {
      sheet.setAttribute("data-pointer-still", "");
      window.addEventListener("pointermove", pointerMoved, { once: true });
    }

    const states = new MutationObserver(follow);
    if (wrapper) {
      states.observe(wrapper, {
        attributeFilter: ["data-state", "data-peek"],
        attributes: true,
      });
    }
    // A selection is an attribute changing; a section opening above the row
    // is the list changing. Both are read once React has written them.
    const rows = new MutationObserver(() => sync());
    rows.observe(host, {
      attributeFilter: ["data-active"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    const resizes = new ResizeObserver(() => sync());
    resizes.observe(host);
    window.addEventListener("resize", sync);
    void document.fonts?.ready.then(() => sync());
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", pointerMoved);
      states.disconnect();
      rows.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  return (
    <div
      aria-hidden="true"
      className="luca-marks"
      data-mark-material={material}
      data-testid="shell-rail-marks"
      ref={layerRef}
    />
  );
}
