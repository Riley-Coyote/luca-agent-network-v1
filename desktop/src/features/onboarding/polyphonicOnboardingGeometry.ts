import * as React from "react";

import {
  type PolyphonicSceneStage,
  releasePolyphonicScene,
  setPolyphonicScene,
} from "./polyphonicOnboardingScene";

/**
 * One geometry for the door and the card, so nothing has to move between
 * them: the door is laid out as the card's skeleton — field where the pane
 * will be, copy where the form will be — and the card materialises around it.
 * Pixel values, clamped to the viewport at the use site.
 */
export const POLYPHONIC_CARD_WIDTH = 960;
export const POLYPHONIC_CARD_HEIGHT = 544;
export const POLYPHONIC_PANE_WIDTH = 416;
/** The pane gives way on narrow windows; the field scales with it. */
export const POLYPHONIC_PANE_TRACK = `min(${POLYPHONIC_PANE_WIDTH}px, 44%, max(12rem, calc(100vw - 38rem)))`;

export const polyphonicCardFrameStyle: React.CSSProperties = {
  width: `min(${POLYPHONIC_CARD_WIDTH}px, calc(100vw - 2rem))`,
  height: `min(${POLYPHONIC_CARD_HEIGHT}px, calc(100dvh - 2rem))`,
  gridTemplateColumns: `${POLYPHONIC_PANE_TRACK} minmax(0, 1fr)`,
};

/**
 * Publish an element's centre as the field's anchor for as long as it is
 * mounted, following resizes. `stage` names who is publishing; on unmount the
 * scene is released only if nobody else has taken it over (a passage in
 * flight leaves it at "opening" until the card claims it).
 */
export function usePublishFieldAnchor(
  ref: React.RefObject<HTMLElement | null>,
  stage: Exclude<PolyphonicSceneStage, "off" | "opening">,
  enabled = true,
) {
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const publish = () => {
      const rect = element.getBoundingClientRect();
      setPolyphonicScene({
        stage,
        anchor: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
        },
      });
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      releasePolyphonicScene(stage);
    };
  }, [enabled, ref, stage]);
}
