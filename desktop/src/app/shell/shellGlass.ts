import * as React from "react";
import { createFrameLayoutWatcher } from "./frameLayout";

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

/** Glass by default; explicit solid choices remain authoritative. The drawing
 * resolver still uses solid where glass is unavailable or transparency reduced.
 */
export function readFrame(storage: FrameStorage | null = defaultStorage()) {
  try {
    const stored = storage?.getItem(FRAME_STORAGE_KEY);
    return isFrame(stored) ? stored : "glass";
  } catch {
    return "glass";
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

/** Glass is offered only where it can be drawn: in the app on a Mac. A
 *  browser can't see the desktop, and Windows' own glass comes with the app's
 *  Windows build (SHELL_BUILD.md, WP-05b, 6). */
export const glassFrameOffered = (
  env: Pick<GlassEnvironment, "tauri" | "mac">,
) => env.tauri && env.mac;

/** The choice is named for what it draws (SHELL_SPEC.md, "Glass where Liquid
 *  Glass can't be"). */
export const glassFrameName = (env: Pick<GlassEnvironment, "announced">) =>
  env.announced ? "Liquid Glass" : "Glass";

export const solidFrameName = (isDark: boolean) => (isDark ? "Black" : "Paper");

/** The one plain sentence under the row (SHELL_SPEC.md, "The frame setting"):
 *  what the choice draws, here and now. Under Reduce Transparency the glass
 *  stays chosen and is drawn solid, and the sentence says so. */
export function frameSentence(
  frame: Frame,
  {
    isDark,
    announced,
    reducedTransparency = false,
  }: { isDark: boolean; announced: boolean; reducedTransparency?: boolean },
) {
  if (frame === "glass" && reducedTransparency) {
    return `${glassFrameName({ announced })}, drawn solid while Reduce Transparency is on.`;
  }
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
 * a provisional pick for Riley to judge in the lab. Square in full screen,
 * as the window is (SHELL_SPEC.md, "Full screen").
 */
export function frostedVibrancyArgs(isDark: boolean, fullscreen = false) {
  return {
    enabled: true,
    material: isDark ? "hud-window" : "under-window-background",
    state: "active",
    cornerRadius: fullscreen ? 0 : WINDOW_RADIUS,
  };
}

type Invoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Installs the frosted glass behind the page when the frame draws it, with
 *  the window's corners (square in full screen). Resolves true once it is
 *  there; false when the frame isn't frosted. */
export async function applyFrameVibrancy(
  drawn: FrameDrawn,
  isDark: boolean,
  invoke: Invoke,
  fullscreen = false,
): Promise<boolean> {
  if (drawn !== "frosted") return false;
  await invoke("set_window_vibrancy", frostedVibrancyArgs(isDark, fullscreen));
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

/**
 * One sheet of Liquid Glass the size of the window (ShellStudy.tsx:566-576),
 * square in full screen; no native floor, so the glass sees the desktop
 * (ShellStudy.tsx:563); the conversation's card where it is; no selection.
 * Never tinted: macOS drops a glass tint whenever the window isn't the one in
 * use, and the night frame turned into another glass when Riley clicked away
 * (2026-10-25). The night's darkness is the page's veil (shell-glass.css),
 * which stays the same whatever has focus.
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

/** The rail under the frame (WP-01). */
const RAIL_CARD_SELECTOR = '[data-frame] [data-sidebar="sidebar"]';

/** The one card (WP-12, shell-frame.css): beneath the rail and what it
 *  opens, in every place. */
export const ONE_CARD_SELECTOR = "[data-luca-one-card]";

/** What lies on the one card, no card of its own here: the rail, and what
 *  it opens, with everything in them (the conversation, the workspace's
 *  panes, Settings' panels). A peeking rail is a card over the one, but its
 *  shadow is its own panel's, cast only past its right edge
 *  (shell-frame.css): one on the floor too would darken the floor round the
 *  one card's left. The right cards stand beside it. */
const ON_ONE_CARD_SELECTOR = [
  '[data-luca-frame-row] [data-frame] [data-sidebar="sidebar"]',
  "[data-luca-frame-row] [data-luca-conversation-surface]",
  "[data-luca-frame-row] [data-luca-conversation-surface] *",
].join(", ");

/** The runtime sessions card, between the rail's and the conversation's
 *  while it is open (WP-08c, shell-runtime.css), and its body, which holds
 *  the card's open width while the card narrows. */
const RUNTIME_CARD_SELECTOR =
  "[data-luca-frame-row] > [data-luca-runtime-card]";
const RUNTIME_CARD_BODY_SELECTOR = "[data-luca-runtime-card-body]";

/**
 * Every card the shell has: the one card (WP-12), glass-floor.css's own list
 * (a card, and a route's surface that is itself the card, not the clear
 * plane that holds a workspace's cards), the rail under the frame (WP-01's
 * shell-frame.css), and the runtime sessions card (WP-08c). Where the one
 * card is drawn, what lies on it is no card of its own (frameCards).
 * shell-glass.css lights them; the runtime card carries its own light
 * (shell-runtime.css).
 */
export const CARD_SELECTOR = [
  ONE_CARD_SELECTOR,
  "[data-luca-card]",
  "[data-luca-conversation-surface]:not(:has([data-luca-workspace-floor]))",
  RAIL_CARD_SELECTOR,
  RUNTIME_CARD_SELECTOR,
].join(", ");

/** The cards that rest on the frame: every card not inside another one,
 *  and not lying on the one card, on screen and shown. */
export function frameCards(doc: Document = document) {
  return measuredFrameCards(doc).map(({ card }) => card);
}

type MeasuredCard = {
  card: HTMLElement;
  rect: DOMRect;
  style: CSSStyleDeclaration;
};

function measuredFrameCards(doc: Document = document): MeasuredCard[] {
  const all = [...doc.querySelectorAll<HTMLElement>(CARD_SELECTOR)];
  const oneCard = all.some((card) => card.matches(ONE_CARD_SELECTOR));
  const measured: MeasuredCard[] = [];
  for (const card of all) {
    if (all.some((other) => other !== card && other.contains(card))) {
      continue;
    }
    if (oneCard && card.matches(ON_ONE_CARD_SELECTOR)) continue;
    const rect = card.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const style = getComputedStyle(card);
    if (style.visibility === "visible") measured.push({ card, rect, style });
  }
  return measured;
}

/**
 * The card the glass is told about: the one card where it is drawn (the
 * study's `sync` sends the card the conversation lies on); otherwise the
 * leftmost card on the frame outside the rail and the runtime sessions card.
 */
export function conversationCard(doc: Document = document) {
  return measuredConversationCard(measuredFrameCards(doc))?.card ?? null;
}

function measuredConversationCard(cards: readonly MeasuredCard[]) {
  const one = cards.find(({ card }) => card.matches(ONE_CARD_SELECTOR));
  if (one) return one;
  return cards
    .filter(
      ({ card }) =>
        !card.closest('[data-testid="app-sidebar"]') &&
        !card.matches(RUNTIME_CARD_SELECTOR),
    )
    .reduce<MeasuredCard | null>(
      (best, entry) => (!best || entry.rect.x < best.rect.x ? entry : best),
      null,
    );
}

const measureCard = (entry: MeasuredCard | null): GlassFrame["card"] => {
  if (!entry) return null;
  const { rect, style } = entry;
  return {
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
    r: Number.parseFloat(style.borderTopLeftRadius) || 0,
  };
};

/** What the one card's right edge follows: the content the lip measures
 *  (ShellLip.tsx, `look`). */
const ONE_CARD_FOLLOWS_SELECTOR =
  "[data-buzz-content-surface], [data-buzz-content-plane]";

const FRAME_MOTION_SELECTOR = [
  CARD_SELECTOR,
  "[data-frame]",
  "[data-sidebar-gap]",
  "[data-luca-right-cards]",
  ".luca-panel-frame",
  ".luca-panel-overlay",
  ".buzz-huddle-shell",
].join(", ");
const shadowNode = (node: Node) =>
  (node instanceof Element ? node : node.parentElement)?.closest(
    "[data-luca-frame-shadows]",
  ) != null;

type FrameLayout = {
  width: number;
  height: number;
  cards: readonly MeasuredCard[];
  conversation: GlassFrame["card"];
  shadows: readonly CardShadow[];
};
let lastCards: readonly MeasuredCard[] = [];

/** Both consumers use this one measured snapshot and one follow loop. */
const frameLayout = createFrameLayoutWatcher<FrameLayout>({
  read: () => {
    const cards = measuredFrameCards();
    lastCards = cards;
    return {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
      cards,
      conversation: measureCard(measuredConversationCard(cards)),
      shadows: cards.map(measureShadow),
    };
  },
  watched: ({ cards }) =>
    cards.flatMap(({ card }) => {
      if (!card.matches(ONE_CARD_SELECTOR)) return [card];
      // Never RO-observe the lip-managed one card itself (WP-26). Watch the
      // content plane it follows, avoiding WebKit's shallow-delivery feedback.
      const follows = document.querySelector(ONE_CARD_FOLLOWS_SELECTOR);
      return follows ? [follows] : [];
    }),
  motionTarget: (target) =>
    target.matches(FRAME_MOTION_SELECTOR) ||
    lastCards.some(({ card }) => target.contains(card)),
  ignoreMutation: (record) =>
    shadowNode(record.target) ||
    ([...record.addedNodes, ...record.removedNodes].length > 0 &&
      [...record.addedNodes, ...record.removedNodes].every(shadowNode)),
});

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
    const report = (layout: FrameLayout) => {
      const { isDark: dark, fullscreen: full } = state.current;
      reporter.report(
        frameMessage({
          width: layout.width,
          height: layout.height,
          fullscreen: full,
          isDark: dark,
          card: layout.conversation,
        }),
      );
    };
    reportRef.current = frameLayout.invalidate;
    reporter.start();
    const stop = frameLayout.subscribe(report);

    return () => {
      reportRef.current = null;
      stop();
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

/** Where one card's shadow lies on the glass. */
export type CardShadow = Box & { r: number; opacity: number };

/**
 * A card's shadow: where it lies, its corners, and how strongly it is cast.
 * The rail's fades as its card narrows, gone once it is closed
 * (shellStudy.css:1345-1355), and so does the runtime sessions card's, which
 * opens and closes on the rail's slide; every other card's is cast in full.
 */
export function cardShadow(
  rect: Box,
  radius: number,
  rail: { full: number } | null,
): CardShadow {
  const opacity =
    rail && rail.full > 0 ? Math.max(0, Math.min(1, rect.w / rail.full)) : 1;
  return { ...rect, r: radius, opacity };
}

function measureShadow({ card, rect, style }: MeasuredCard): CardShadow {
  const body = card.matches(RUNTIME_CARD_SELECTOR)
    ? card.querySelector<HTMLElement>(RUNTIME_CARD_BODY_SELECTOR)
    : null;
  const rail = card.matches(RAIL_CARD_SELECTOR)
    ? { full: Number.parseFloat(style.getPropertyValue("--sidebar-width")) }
    : body
      ? { full: body.getBoundingClientRect().width }
      : null;
  return cardShadow(
    { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    Number.parseFloat(style.borderTopLeftRadius) || 0,
    rail,
  );
}

/**
 * The cards' shadows by day (SHELL_SPEC.md, "Black (Paper in light)" and
 * "Glass: Liquid Glass", the cards): one layer beneath all the cards at once,
 * so no card shades its neighbour, with one shadow where each card lies, kept
 * in place as they move. It is made whenever the frame is drawn by day;
 * shell-glass.css draws it on the glass, shell-light.css on Paper's floor,
 * each with its own values.
 */
export function useShellGlassShadows(active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("data-luca-frame-shadows", "");
    layer.setAttribute("data-testid", "shell-glass-shadows");
    document.body.append(layer);
    const shadows: HTMLElement[] = [];
    const draw = ({ shadows: cards }: FrameLayout) => {
      while (shadows.length < cards.length) {
        const shadow = document.createElement("span");
        shadow.setAttribute("data-luca-frame-shadow", "");
        layer.append(shadow);
        shadows.push(shadow);
      }
      while (shadows.length > cards.length) shadows.pop()?.remove();
      cards.forEach((card, index) => {
        const { style } = shadows[index];
        style.left = `${card.x}px`;
        style.top = `${card.y}px`;
        style.width = `${card.w}px`;
        style.height = `${card.h}px`;
        style.borderRadius = `${card.r}px`;
        style.opacity = String(card.opacity);
      });
    };
    const stop = frameLayout.subscribe(draw);
    return () => {
      stop();
      layer.remove();
    };
  }, [active]);
}

// ── the traffic lights ──────────────────────────────────────────────────

/** The lights on the lip's line: the first one's left edge 16 from the
 *  window's corner, centred 22 from its top (ShellStudy.tsx:78-79). */
export const TRAFFIC_LIGHTS = { x: 16, centre: 22 } as const;
