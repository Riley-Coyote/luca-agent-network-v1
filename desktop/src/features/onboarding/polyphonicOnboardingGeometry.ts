import { isTauri } from "@tauri-apps/api/core";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import * as React from "react";

import {
  type PolyphonicSceneStage,
  releasePolyphonicScene,
  setPolyphonicLanding,
  setPolyphonicScene,
} from "./polyphonicOnboardingScene";

/**
 * One geometry for the door and the card, so nothing has to move between
 * them: the door is laid out as the card's skeleton — field where the pane
 * will be, copy where the form will be — and the card materialises around it.
 * Pixel values, clamped to the viewport at the use site.
 */
/**
 * The card, derived rather than chosen.
 *
 * The interaction column asks for a 30rem measure with 2.5rem of air each
 * side, so the right half reserves 35rem = 560px. The left half is the living
 * field's, and the field needs air on both sides of itself: 2.5rem again, the
 * same gutter as the column's, so the dendrite and the copy breathe alike —
 * a 400px dendrite in a 480px pane leaves exactly that. 480 + 560 = 1040, and
 * 1040 × 9/16 ≈ 584, so the card keeps the 16:9 the smaller one had.
 */
export const POLYPHONIC_CARD_WIDTH = 1040;
export const POLYPHONIC_CARD_HEIGHT = 584;
export const POLYPHONIC_PANE_WIDTH = 480;
/** What the interaction column reserves: 30rem of measure, 2.5rem either side. */
export const POLYPHONIC_COLUMN_RESERVE = "35rem";
/** The measure the column's content is set to, whatever the pane does. */
export const POLYPHONIC_COLUMN_MEASURE = "30rem";
/** The air between the dendrite and the pane's edges, per side. */
export const POLYPHONIC_FIELD_INSET = "2.5rem";
/** The pane gives way on narrow windows; the field scales with it. */
export const POLYPHONIC_PANE_TRACK = `min(${POLYPHONIC_PANE_WIDTH}px, 48%, max(12rem, calc(100vw - ${POLYPHONIC_COLUMN_RESERVE})))`;

/**
 * Where the application lands when the card becomes it.
 *
 * Not the whole screen. An owner on an ultrawide does not want their first
 * window to be a yard across, and an owner on a 13" Mac does not want one
 * wedged into the bezels: a standard desk-sized window, centred, and theirs to
 * resize from there.
 */
export const POLYPHONIC_APP_WINDOW_WIDTH = 1280;
export const POLYPHONIC_APP_WINDOW_HEIGHT = 800;
/** Room the standard size must fit inside the monitor's work area with. */
export const POLYPHONIC_APP_WINDOW_MARGIN = 48;

/**
 * The standard landing size, in logical pixels, for a work area.
 *
 * `screen.availWidth/availHeight` is the work area of the display the window
 * is on — menu bar and Dock already subtracted — and it costs no native
 * permission, so this is one small pure function the harness can assert and
 * every path that lands the application can share.
 */
export function resolvePolyphonicAppWindowSize(work?: {
  availWidth: number;
  availHeight: number;
}): { width: number; height: number } {
  const area =
    work ??
    (typeof window === "undefined"
      ? {
          availWidth: POLYPHONIC_APP_WINDOW_WIDTH,
          availHeight: POLYPHONIC_APP_WINDOW_HEIGHT,
        }
      : window.screen);
  const fit = (want: number, available: number, floor: number) =>
    Number.isFinite(available) && available > 0
      ? available < want + POLYPHONIC_APP_WINDOW_MARGIN
        ? Math.max(floor, Math.round(available - POLYPHONIC_APP_WINDOW_MARGIN))
        : want
      : want;
  return {
    width: fit(POLYPHONIC_APP_WINDOW_WIDTH, area.availWidth, 640),
    height: fit(POLYPHONIC_APP_WINDOW_HEIGHT, area.availHeight, 480),
  };
}

/**
 * Put the window on the desk at the standard size, centred on its monitor.
 *
 * Deliberately not `maximize()`: the first thing the application does should
 * not be to swallow the screen. Best effort throughout — a window manager
 * that refuses is not a reason to hold up the handoff, and the owner is free
 * to resize the moment they have it.
 */
export async function landPolyphonicAppWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { width, height } = resolvePolyphonicAppWindowSize();
    const appWindow = getCurrentWindow();
    await appWindow.setSize(new LogicalSize(width, height));
    await appWindow.center();
  } catch {
    // A window that will not be placed is still a usable window.
  }
}

/**
 * How much of the window the card leaves around itself.
 *
 * A card inside the application keeps a margin so it reads as an object on a
 * canvas. A card that IS the window has no canvas and no margin: the gutter
 * goes to zero under `data-luca-floating-card` (theme.css), and then
 * `100vw` — which the pane track also measures against — is the card, so the
 * interaction column lands on exactly the 35rem it asks for.
 */
const CARD_GUTTER = "var(--polyphonic-card-gutter, 2rem)";

const CARD_WIDTH_EXPRESSION = `min(${POLYPHONIC_CARD_WIDTH}px, calc(100vw - ${CARD_GUTTER}))`;
const CARD_HEIGHT_EXPRESSION = `min(${POLYPHONIC_CARD_HEIGHT}px, calc(100dvh - ${CARD_GUTTER}))`;

export const polyphonicCardFrameStyle: React.CSSProperties = {
  width: CARD_WIDTH_EXPRESSION,
  height: CARD_HEIGHT_EXPRESSION,
  gridTemplateColumns: `${POLYPHONIC_PANE_TRACK} minmax(0, 1fr)`,
};

/**
 * The dendrite's own box inside the pane: a centred square, inset from the
 * pane's edges, so the field has air on both sides of itself instead of
 * running edge to edge. This — not the pane — is what publishes the field's
 * anchor, on the door and in the card alike, so the two still agree to the
 * pixel and the field never has to move between them.
 */
export const polyphonicFieldBoxStyle: React.CSSProperties = {
  // A square, so it is inset by the same amount on whichever axis is
  // tightest: the pane's width, or the card's height, which the pane's is.
  width: `min(calc(100% - ${POLYPHONIC_FIELD_INSET} * 2), calc(${CARD_HEIGHT_EXPRESSION} - ${POLYPHONIC_FIELD_INSET} * 2))`,
  aspectRatio: "1",
};

/**
 * Publish an element's centre as the field's anchor for as long as it is
 * mounted, following resizes. `stage` names who is publishing; on unmount the
 * scene is released only if nobody else has taken it over (a passage in
 * flight leaves it at "opening" until the card claims it).
 *
 * "app" is the exception: the sidebar's own Luca mark publishes where the
 * glyph should *land* when the card becomes the application. It never moves
 * the field on its own — it only tells the layer where the journey ends.
 */
export function usePublishFieldAnchor(
  ref: React.RefObject<HTMLElement | null>,
  stage: Exclude<PolyphonicSceneStage, "off" | "opening">,
  enabled = true,
) {
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const landing = stage === "app";
    const publish = () => {
      const rect = element.getBoundingClientRect();
      // A mark in a collapsed rail is measurable but parked off-canvas, and a
      // mark in a rail that is not there at all measures zero. Neither is
      // somewhere the glyph could land, so neither is published — the layer
      // uses its own fallback instead of flying the mark off the screen.
      if (landing) {
        const onScreen =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.top < window.innerHeight;
        if (!onScreen) {
          setPolyphonicLanding(null);
          return;
        }
      }
      const anchor = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
      };
      if (landing) setPolyphonicLanding(anchor);
      else setPolyphonicScene({ stage, anchor });
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      if (landing) setPolyphonicLanding(null);
      else releasePolyphonicScene(stage);
    };
  }, [enabled, ref, stage]);
}
