import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as React from "react";

import { usePolyphonicFloatingCard } from "./polyphonicOnboardingScene";

/**
 * The first launch is the card, and nothing else.
 *
 * The native window is already transparent-capable (`transparent: true` in
 * `tauri.conf.json`), and on a first run it is sized to the card exactly, so
 * the window IS the card. What the owner sees around the card is the desktop,
 * blurred by a native `NSVisualEffectView`, with the card's own surface laid
 * over it at 76% — one object of glass, not a plate on a slab.
 *
 * The order matters and is the whole reason this module exists:
 *
 *   1. the scene reaches `door` (or `opening`, or `card`);
 *   2. the vibrancy view is installed and AWAITED, with the card's corner
 *      radius so the frosted material is card-shaped;
 *   3. only then does `data-luca-floating-card` go on `<html>` and the
 *      document stop painting (`theme.css`).
 *
 * Reverse those and there is a frame of transparent webview over nothing.
 * If the install fails the attribute never goes on, and the card simply
 * stays opaque in a card-sized window — a worse first run, not a broken one.
 *
 * It also owns the two native halves of the same fact: the traffic lights,
 * which no floating card has, and the drag, which a window with no title bar
 * has to get from the card itself.
 */

/** Stamped on `<html>` once the window behind the card is really glass. */
export const FLOATING_CARD_ATTRIBUTE = "data-luca-floating-card";

/**
 * The same material the application's glass themes install, so the card and
 * the app it becomes are blurring the desktop the same way.
 */
const CARD_VIBRANCY_MATERIAL = "sidebar";
/** The card's own radius (`PolyphonicOnboardingFieldLayer`'s shell). */
const CARD_CORNER_RADIUS_PX = 15;

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
  // Not a second source of truth for floating — `floating` is still the only
  // one. This is the native handshake's answer: whether there is something
  // behind the window for the document to stop painting onto.
  const [glassInstalled, setGlassInstalled] = React.useState(false);

  React.useEffect(() => {
    if (!floating) {
      setGlassInstalled(false);
      return;
    }
    if (!isTauri()) {
      // A browser has no vibrancy view and needs none: nothing is behind the
      // page to protect, and the harness has to be able to see the glass.
      setGlassInstalled(true);
      return;
    }
    let cancelled = false;
    void invoke("set_window_vibrancy", {
      enabled: true,
      material: CARD_VIBRANCY_MATERIAL,
      // The card does not turn opaque when the owner clicks elsewhere.
      state: "active",
      cornerRadius: CARD_CORNER_RADIUS_PX,
    })
      .then(() => {
        if (!cancelled) setGlassInstalled(true);
      })
      .catch((error) => {
        // No layer, so no transparency: the card stays opaque rather than
        // showing a window with nothing behind it.
        console.warn("floating card vibrancy unavailable", error);
      });
    return () => {
      cancelled = true;
    };
  }, [floating]);

  // The card's own layer is never cleared here. When floating ends, the
  // theme's vibrancy effect re-runs (it takes `floatingCard` as a dependency)
  // and installs or clears the window's material for the theme the owner is
  // actually in — one hand on the window at a time.
  const painted = floating && glassInstalled;
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    if (painted) root.setAttribute(FLOATING_CARD_ATTRIBUTE, "");
    else root.removeAttribute(FLOATING_CARD_ATTRIBUTE);
    return () => {
      root.removeAttribute(FLOATING_CARD_ATTRIBUTE);
    };
  }, [painted]);

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
