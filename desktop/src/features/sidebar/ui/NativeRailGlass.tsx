import * as React from "react";

import {
  NATIVE_GLASS_SETTINGS_EVENT,
  readNativeGlassChoice,
} from "@/features/sidebar/ui/NativeGlassSettings";

/**
 * THE RAIL IN APPLE'S REAL GLASS (native test builds).
 *
 * When the app carries native glass (desktop/src-tauri/native/glass), it
 * announces itself as `window.__POLYPHONIC_NATIVE_GLASS__` and a
 * `polyphonic-native-glass` event. The conversation card and the rail's
 * selection are then Apple's glass, drawn natively beneath this page, and the
 * page draws neither: it marks the root `data-luca-native-glass`
 * (railGlass.css leaves the floor, the card and the web pill empty there) and
 * reports where things are whenever something moves: the card's place and
 * corners, the floor's colour, the chosen row, and the part of the rail it
 * shows in. The native side moves the glass; every word stays here, above it.
 *
 * Without the announcement nothing happens, so shipped builds and browsers
 * are untouched. With Reduce Transparency the page keeps drawing its own
 * floor and card, and the glass stands down. The plan:
 * docs/luca/native-rail-glass/PLAN.md.
 */

type Box = { x: number; y: number; w: number; h: number };

type GlassWindow = Window & {
  __POLYPHONIC_NATIVE_GLASS__?: number;
  webkit?: {
    messageHandlers?: {
      polyphonicGlass?: { postMessage: (message: unknown) => void };
    };
  };
};

const ROW_SELECTOR =
  ':is([data-sidebar="menu-button"], [data-sidebar="menu-sub-button"])[data-active="true"]';

const glassWindow = () => window as GlassWindow;
const announced = () => Boolean(glassWindow().__POLYPHONIC_NATIVE_GLASS__);
const bridge = () => glassWindow().webkit?.messageHandlers?.polyphonicGlass;
const REDUCED_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";

const box = (rect: DOMRect): Box => ({
  x: rect.x,
  y: rect.y,
  w: rect.width,
  h: rect.height,
});

/** `rgb(r, g, b)` as `#rrggbb`; black when the floor is see-through. */
function hexColour(css: string): string {
  const [r = 0, g = 0, b = 0, a = 1] = (css.match(/[\d.]+/g) ?? []).map(Number);
  if (a === 0) return "#000000";
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** A row keeps its id across renders, so the same row moving is followed, not poured again. */
function rowId(row: HTMLElement): string {
  return (
    row.dataset.channelId ??
    row.getAttribute("href") ??
    row.textContent?.trim() ??
    ""
  );
}

/** The conversation card beside the rail: the leftmost card on the page. */
function mainCard(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestX = Number.POSITIVE_INFINITY;
  for (const card of document.querySelectorAll<HTMLElement>(
    "[data-luca-card]",
  )) {
    const rect = card.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.x < bestX) {
      best = card;
      bestX = rect.x;
    }
  }
  return best;
}

export function NativeRailGlass() {
  const [present, setPresent] = React.useState(announced);
  const [opaque, setOpaque] = React.useState(
    () => window.matchMedia(REDUCED_TRANSPARENCY).matches,
  );
  const on = present && !opaque;

  React.useEffect(() => {
    if (present) return;
    const enable = () => setPresent(true);
    window.addEventListener("polyphonic-native-glass", enable);
    if (announced()) enable();
    return () => window.removeEventListener("polyphonic-native-glass", enable);
  }, [present]);

  React.useEffect(() => {
    const query = window.matchMedia(REDUCED_TRANSPARENCY);
    const changed = () => setOpaque(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);

  React.useEffect(() => {
    if (!on) return;
    const sidebar = document.querySelector<HTMLElement>(
      '[data-testid="app-sidebar"]',
    );
    // The floor's colour, read before the page stops painting it.
    const floorSource =
      sidebar?.querySelector<HTMLElement>('[data-sidebar="sidebar"]') ??
      document.body;
    const floor = hexColour(getComputedStyle(floorSource).backgroundColor);
    const root = document.documentElement;
    root.setAttribute("data-luca-native-glass", "");
    const settle = () =>
      bridge()?.postMessage({ type: "settings", ...readNativeGlassChoice() });
    settle();
    window.addEventListener(NATIVE_GLASS_SETTINGS_EVENT, settle);

    let last = "";
    const report = () => {
      const glass = bridge();
      if (!glass) return;
      const card = mainCard();
      const row = sidebar?.querySelector<HTMLElement>(ROW_SELECTOR) ?? null;
      const rowRect = row?.getBoundingClientRect();
      const clip = row?.closest('[data-sidebar="content"]') ?? sidebar;
      const message = {
        type: "frame",
        floor,
        card: card
          ? {
              ...box(card.getBoundingClientRect()),
              r:
                Number.parseFloat(getComputedStyle(card).borderTopLeftRadius) ||
                0,
            }
          : null,
        row:
          row && rowRect && rowRect.height > 0
            ? { id: rowId(row), ...box(rowRect) }
            : null,
        clip: clip ? box(clip.getBoundingClientRect()) : null,
      };
      const text = JSON.stringify(message);
      if (text === last) return;
      last = text;
      // When the page saw it, on the wall clock: how far the glass trails.
      glass.postMessage({
        ...message,
        t: performance.timeOrigin + performance.now(),
      });
    };

    // A choice or a resize is read on the next frame, once React has
    // finished; a scroll at once, since scroll events already come a frame
    // at a time and the glass should not trail the row.
    let pending = 0;
    const later = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        report();
      });
    };
    const mutations = new MutationObserver(later);
    if (sidebar) {
      mutations.observe(sidebar, {
        attributeFilter: ["data-active"],
        attributes: true,
        childList: true,
        subtree: true,
      });
    }
    const resizes = new ResizeObserver(later);
    resizes.observe(root);
    if (sidebar) resizes.observe(sidebar);
    const card = mainCard();
    if (card) resizes.observe(card);
    const scrolled = (event: Event) => {
      if (sidebar?.contains(event.target as Node)) report();
    };
    document.addEventListener("scroll", scrolled, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", later);
    report();

    return () => {
      mutations.disconnect();
      resizes.disconnect();
      document.removeEventListener("scroll", scrolled, { capture: true });
      window.removeEventListener("resize", later);
      if (pending) cancelAnimationFrame(pending);
      window.removeEventListener(NATIVE_GLASS_SETTINGS_EVENT, settle);
      root.removeAttribute("data-luca-native-glass");
      // The page paints its own floor and card again; the glass stands down.
      bridge()?.postMessage({ type: "off" });
    };
  }, [on]);

  return null;
}
