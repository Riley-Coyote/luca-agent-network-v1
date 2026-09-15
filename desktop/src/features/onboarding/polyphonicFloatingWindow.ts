import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as React from "react";

import { usePolyphonicFloatingCard } from "./polyphonicOnboardingScene";

/**
 * The first launch is the card, and nothing else.
 *
 * The native window is already transparent-capable (`transparent: true` in
 * `tauri.conf.json`), so the dark slab a stranger saw around the card was
 * ours: html, body and the onboarding wrappers painting a canvas the card did
 * not need. While the scene is floating this module publishes one fact —
 * `data-luca-floating-card` on `<html>` — and every rule that stops painting
 * keys on it (`theme.css`). The window server draws the shadow from the only
 * opaque region left, which is the card.
 *
 * It also owns the two native halves of the same fact: the traffic lights,
 * which no floating card has, and the drag, which a window with no title bar
 * has to get from the card itself.
 */

/** Stamped on `<html>` for as long as the card is the only thing on screen. */
export const FLOATING_CARD_ATTRIBUTE = "data-luca-floating-card";

/**
 * Anything the pointer could be doing instead of moving the window. The card's
 * left panel holds no controls today; this is what keeps that true if one ever
 * lands there.
 */
const DRAG_INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function setMainWindowTrafficLightsHidden(hidden: boolean) {
  if (!isTauri()) return;
  try {
    void invoke("set_main_window_traffic_lights_hidden", { hidden }).catch(
      () => {
        // A window that will not give up its stoplights is not a reason to
        // hold up the door or the becoming.
      },
    );
  } catch {
    // Same: the browser build and the e2e harness have no window to ask.
  }
}

/**
 * Reflect the floating card onto the document and the native window. Mount
 * once, next to the field layer — it is the same one object.
 */
export function usePolyphonicFloatingWindow(): boolean {
  const floating = usePolyphonicFloatingCard();

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    if (floating) root.setAttribute(FLOATING_CARD_ATTRIBUTE, "");
    else root.removeAttribute(FLOATING_CARD_ATTRIBUTE);
    return () => {
      root.removeAttribute(FLOATING_CARD_ATTRIBUTE);
    };
  }, [floating]);

  // Only a *change* reaches the window. The first observation says nothing:
  // on a first run the reveal plugin has already hidden the lights before the
  // card was on screen, and a returning owner's were never hidden — asking
  // either way would show a cluster the door is not supposed to have.
  const previousFloating = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    const was = previousFloating.current;
    previousFloating.current = floating;
    if (was === null || was === floating) return;
    setMainWindowTrafficLightsHidden(floating);
  }, [floating]);

  return floating;
}

/**
 * The card's left panel is the window's handle: the living field and the
 * wordmark, no controls, so there is nothing there to mistake a drag for. A
 * double-click on it does nothing — it is a panel, not a title bar.
 */
export function usePolyphonicCardDrag(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  React.useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || !isTauri()) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0 || event.detail > 1) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(DRAG_INTERACTIVE_SELECTOR)
      ) {
        return;
      }
      try {
        void getCurrentWindow()
          .startDragging()
          .catch(() => {
            // The card stays where it is; nothing else depends on this.
          });
      } catch {
        // No window to drag (browser build, e2e harness).
      }
    }

    function swallowDoubleClick(event: MouseEvent) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("dblclick", swallowDoubleClick, true);
    return () => {
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("dblclick", swallowDoubleClick, true);
    };
  }, [enabled, ref]);
}
