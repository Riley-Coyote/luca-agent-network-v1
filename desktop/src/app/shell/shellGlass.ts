import * as React from "react";

import "./shell-glass.css";

/**
 * THE FRAME'S GLASS (docs/luca/rail-system/SHELL_SPEC.md, "The frame setting"
 * and both "Glass" sections).
 *
 * The Frame setting is Black (Paper in light) or Glass. What Glass draws
 * depends on the machine:
 * - Apple's Liquid Glass, when the native glass has announced itself
 *   (`window.__POLYPHONIC_NATIVE_GLASS__`, PolyphonicGlass.swift, macOS 26 and
 *   later): the page is clear and tells the native side where things are;
 * - Apple's older frosted glass on any other Mac, through the vibrancy path
 *   the app already ships (`set_window_vibrancy`);
 * - nothing in a browser, which can't see the desktop: the frame is solid.
 * Reduce Transparency draws the solid frame everywhere.
 *
 * Every value is the shell study's (desktop/src/testing/shellStudy/), cited
 * where it is used, for Claude to tune by eye in the test app (WP-07b).
 */

export const FRAME_STORAGE_KEY = "polyphonic-frame";

/** The setting: the solid frame, or glass. */
export type Frame = "solid" | "glass";

/** What the frame is drawn as on this machine, now. */
export type FrameDrawn = "solid" | "liquid" | "frosted";

export const isFrame = (value: unknown): value is Frame =>
  value === "solid" || value === "glass";

type FrameStorage = Pick<Storage, "getItem" | "setItem">;

const defaultStorage = (): FrameStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The stored frame; solid until someone chooses glass. */
export function readFrame(storage: FrameStorage | null = defaultStorage()) {
  try {
    const stored = storage?.getItem(FRAME_STORAGE_KEY);
    return isFrame(stored) ? stored : "solid";
  } catch {
    return "solid";
  }
}

export function writeFrame(
  frame: Frame,
  storage: FrameStorage | null = defaultStorage(),
) {
  try {
    storage?.setItem(FRAME_STORAGE_KEY, frame);
  } catch {
    // The choice still applies; it just won't be there after a reload.
  }
}

/** Where the page runs, as far as the glass is concerned. */
export type GlassEnvironment = {
  /** A Tauri window (not a browser). */
  tauri: boolean;
  mac: boolean;
  /** The native glass has announced itself beneath this page. */
  announced: boolean;
  reducedTransparency: boolean;
};

/** A browser can't see the desktop, so Glass is offered only in the app. */
export const glassFrameOffered = (env: Pick<GlassEnvironment, "tauri">) =>
  env.tauri;

/** The choice is named for what it draws (SHELL_SPEC.md, "Glass where Liquid
 *  Glass can't be"). */
export const glassFrameName = (env: Pick<GlassEnvironment, "announced">) =>
  env.announced ? "Liquid Glass" : "Glass";

export const solidFrameName = (isDark: boolean) => (isDark ? "Black" : "Paper");

/** The one plain sentence under the row (SHELL_SPEC.md, "The frame setting"). */
export function frameSentence(
  frame: Frame,
  { isDark, announced }: { isDark: boolean; announced: boolean },
) {
  if (frame === "glass") {
    return announced
      ? "Liquid Glass, your desktop showing through it."
      : "Glass, your desktop softly blurred behind it.";
  }
  return isDark
    ? "Solid black, nothing showing through it."
    : "Solid paper, nothing showing through it.";
}

/** What the Glass choice draws here (WP-07a, decision 3). */
export function drawnFrame(frame: Frame, env: GlassEnvironment): FrameDrawn {
  if (frame !== "glass" || !env.tauri || env.reducedTransparency) {
    return "solid";
  }
  if (env.announced) return "liquid";
  // Windows' own glass comes with the app's Windows build; until then the
  // frame stays solid there rather than going clear onto nothing.
  return env.mac ? "frosted" : "solid";
}

// ── the frosted fallback (macOS 14 to 25, and builds without the native glass)

/** The window's corner (SHELL_SPEC.md, "Corners"; ShellStudy.tsx:75). */
export const WINDOW_RADIUS = 16;

/**
 * `set_window_vibrancy`'s arguments for the frosted frame: held in its in-use
 * look so it never turns flat grey when the window rests; the Heads-up
 * display at night (Riley's favourite); by day the under-window background,
 * a provisional pick for Riley to judge in the lab.
 */
export function frostedVibrancyArgs(isDark: boolean) {
  return {
    enabled: true,
    material: isDark ? "hud-window" : "under-window-background",
    state: "active",
    cornerRadius: WINDOW_RADIUS,
  };
}

type Invoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Installs the frosted glass behind the page when the frame draws it.
 *  Resolves true once it is there; false when the frame isn't frosted. */
export async function applyFrameVibrancy(
  drawn: FrameDrawn,
  isDark: boolean,
  invoke: Invoke,
): Promise<boolean> {
  if (drawn !== "frosted") return false;
  await invoke("set_window_vibrancy", frostedVibrancyArgs(isDark));
  return true;
}

// ── Liquid Glass: the page's reports to PolyphonicGlass.swift ────────────

export type Box = { x: number; y: number; w: number; h: number };

/** The `frame` message (PolyphonicGlass.swift's header), less its clock. */
export type GlassFrame = {
  card: (Box & { r: number }) | null;
  floor: string;
  row: null;
  clip: null;
  sheet: Box & {
    r: number;
    style: "regular";
    tint: string | null;
    appearance: "light" | "dark";
  };
};

export type FrameGeometry = {
  /** The window's size, in CSS pixels (points). */
  width: number;
  height: number;
  fullscreen: boolean;
  isDark: boolean;
  card: (Box & { r: number }) | null;
};

/** Apple's dark tint, at night only (ShellStudy.tsx:108, Riley's pick). */
export const DARK_TINT = "#00000080";

/**
 * One sheet of Liquid Glass the size of the window (ShellStudy.tsx:566-576),
 * square in full screen; no native floor, so the glass sees the desktop
 * (ShellStudy.tsx:563); the conversation's card where it is; no selection.
 */
export function frameMessage(geometry: FrameGeometry): GlassFrame {
  return {
    card: geometry.card,
    floor: "none",
    row: null,
    clip: null,
    sheet: {
      x: 0,
      y: 0,
      w: geometry.width,
      h: geometry.height,
      r: geometry.fullscreen ? 0 : WINDOW_RADIUS,
      style: "regular",
      tint: geometry.isDark ? DARK_TINT : null,
      appearance: geometry.isDark ? "dark" : "light",
    },
  };
}

/** The settings the frame asks for: the card stays the page's own surface
 *  (nativeGlass.ts:58-66, the study's `startGlass`). */
export const GLASS_SETTINGS = {
  type: "settings",
  material: "clear",
  motion: "pour",
  floor: "plain",
  cardGlass: false,
  slow: false,
} as const;

type Post = (body: Record<string, unknown>) => void;

/** Sends where everything is only when something changed since the last time
 *  (nativeGlass.ts:45-56); `off` hands the frame back to the page. */
export function createGlassReporter(
  post: Post,
  now: () => number = () => performance.timeOrigin + performance.now(),
) {
  let last = "";
  return {
    start() {
      last = "";
      post({ ...GLASS_SETTINGS });
    },
    report(frame: GlassFrame) {
      const json = JSON.stringify(frame);
      if (json === last) return false;
      last = json;
      post({ type: "frame", ...frame, t: now() });
      return true;
    },
    stop() {
      last = "";
      post({ type: "off" });
    },
  };
}

type GlassWindow = Window & {
  __POLYPHONIC_NATIVE_GLASS__?: number;
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (body: unknown) => void }>;
  };
};

const glassWindow = () => window as GlassWindow;

const postToGlass: Post = (body) => {
  glassWindow().webkit?.messageHandlers?.polyphonicGlass?.postMessage(body);
};

const announcedNow = () => Boolean(glassWindow().__POLYPHONIC_NATIVE_GLASS__);

/** Whether the native glass has announced itself beneath this page. */
export function useNativeGlassAnnounced() {
  const [announced, setAnnounced] = React.useState(announcedNow);
  React.useEffect(() => {
    if (announced) return;
    const show = () => setAnnounced(true);
    window.addEventListener("polyphonic-native-glass", show);
    if (announcedNow()) show();
    return () => window.removeEventListener("polyphonic-native-glass", show);
  }, [announced]);
  return announced;
}

const REDUCED_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";

/** macOS's Reduce Transparency, followed live. */
export function useReducedTransparency() {
  const [reduced, setReduced] = React.useState(
    () => window.matchMedia(REDUCED_TRANSPARENCY).matches,
  );
  React.useEffect(() => {
    const query = window.matchMedia(REDUCED_TRANSPARENCY);
    const change = () => setReduced(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return reduced;
}

/**
 * The conversation's card: the leftmost card on the page outside the rail.
 * (The rail's own card, when the frame gives it one, is not the one the glass
 * is told about: `sync` in ShellStudy.tsx sends the conversation card.)
 */
export function conversationCard(doc: Document = document) {
  let best: HTMLElement | null = null;
  let bestX = Number.POSITIVE_INFINITY;
  for (const card of doc.querySelectorAll<HTMLElement>("[data-luca-card]")) {
    if (card.closest('[data-testid="app-sidebar"]')) continue;
    const rect = card.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    if (rect.x < bestX) {
      best = card;
      bestX = rect.x;
    }
  }
  return best;
}

const measureCard = (card: HTMLElement | null): GlassFrame["card"] => {
  if (!card) return null;
  const rect = card.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
    r: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0,
  };
};

/** The rail slides over 460 ms (SHELL_SPEC.md, "Motion"); a little longer, so
 *  the last frame of any transition is reported. */
const FOLLOW_MS = 520;

/**
 * Tells the native glass where the frame is while `active`: the settings
 * once, then a frame on every layout change (a resize, a route, every frame
 * while something slides). Stands it down (`off`) when it stops: Reduce
 * Transparency, leaving Glass, or the flag going off.
 */
export function useShellGlassReporter(
  active: boolean,
  isDark: boolean,
  fullscreen: boolean,
) {
  const state = React.useRef({ isDark, fullscreen });
  state.current = { isDark, fullscreen };
  const reportRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    if (!active) return;
    const reporter = createGlassReporter(postToGlass);
    const root = document.documentElement;
    const report = () => {
      const { isDark: dark, fullscreen: full } = state.current;
      reporter.report(
        frameMessage({
          width: root.clientWidth || window.innerWidth,
          height: root.clientHeight || window.innerHeight,
          fullscreen: full,
          isDark: dark,
          card: measureCard(conversationCard()),
        }),
      );
    };
    reportRef.current = report;
    reporter.start();
    report();

    let pending = 0;
    const later = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        report();
      });
    };
    let following = 0;
    let until = 0;
    const follow = () => {
      until = performance.now() + FOLLOW_MS;
      if (following) return;
      const step = () => {
        report();
        following = performance.now() < until ? requestAnimationFrame(step) : 0;
      };
      following = requestAnimationFrame(step);
    };

    const resizes = new ResizeObserver(later);
    resizes.observe(root);
    let watched: HTMLElement | null = null;
    const watch = () => {
      const card = conversationCard();
      if (card === watched) return;
      if (watched) resizes.unobserve(watched);
      if (card) resizes.observe(card);
      watched = card;
    };
    watch();
    // A route swaps the card; a drawer or a second pane comes and goes.
    const mutations = new MutationObserver(() => {
      watch();
      later();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", later);
    document.addEventListener("transitionrun", follow, true);
    document.addEventListener("animationstart", follow, true);
    void document.fonts?.ready.then(later);

    return () => {
      reportRef.current = null;
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", later);
      document.removeEventListener("transitionrun", follow, true);
      document.removeEventListener("animationstart", follow, true);
      if (pending) cancelAnimationFrame(pending);
      if (following) cancelAnimationFrame(following);
      // The page draws the whole frame itself again.
      reporter.stop();
    };
  }, [active]);

  // The palette or full screen changed: the sheet's tint, appearance or
  // corners with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: isDark and fullscreen are what the report reads, through the ref
  React.useEffect(() => {
    reportRef.current?.();
  }, [isDark, fullscreen]);
}

// ── the traffic lights ──────────────────────────────────────────────────

/** The lights on the lip's line: the first one's left edge 16 from the
 *  window's corner, centred 22 from its top (ShellStudy.tsx:78-79). */
export const TRAFFIC_LIGHTS = { x: 16, centre: 22 } as const;
