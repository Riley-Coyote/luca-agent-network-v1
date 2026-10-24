import * as React from "react";

/**
 * The study's line to Apple's glass, when the page runs in the glass lab
 * (desktop/src-tauri/native/glass): the page says where things are, the
 * native side draws the glass beneath the page and moves it. The protocol is
 * in PolyphonicGlass.swift's header; this sends the shell study's part of it.
 * The glass above the page (the "Above" frame) has its own line, to
 * Lab/ShellChrome.swift: the pieces and what they hold go out, presses and
 * the window's state come back.
 */

export type Box = { x: number; y: number; w: number; h: number };

export type GlassFrame = {
  card: (Box & { r: number }) | null;
  /** The floor under everything, or "none" for a clear window. */
  floor: string;
  row: (Box & { id: string }) | null;
  clip: Box | null;
  /** The frame's one sheet of Apple's material: Liquid Glass (regular or
   *  clear, maybe Apple's tint, "#rrggbbaa") or frosted (one of AppKit's
   *  materials by name, its in-use look held or following the window). */
  sheet:
    | (Box & {
        r: number;
        style: "regular" | "clear" | "frosted";
        tint: string | null;
        material: string | null;
        held: boolean;
      })
    | null;
};

type GlassWindow = Window & {
  __POLYPHONIC_NATIVE_GLASS__?: number;
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (body: unknown) => void }>;
  };
};

const glassWindow = () => window as GlassWindow;

function post(name: string, body: unknown) {
  glassWindow().webkit?.messageHandlers?.[name]?.postMessage(body);
}

let lastFrame = "";

/** Sends where everything is, when anything has changed since the last time. */
export function reportFrame(frame: GlassFrame) {
  const json = JSON.stringify(frame);
  if (json === lastFrame) return;
  lastFrame = json;
  post("polyphonicGlass", {
    type: "frame",
    ...frame,
    t: performance.timeOrigin + performance.now(),
  });
}

export function startGlass() {
  lastFrame = "";
  post("polyphonicGlass", {
    type: "settings",
    material: "clear",
    motion: "pour",
    floor: "plain",
    cardGlass: false,
    slow: false,
  });
}

/** The page draws everything itself again. */
export function stopGlass() {
  lastFrame = "";
  post("polyphonicGlass", { type: "off" });
}

/** The lab's own window: a press on the page's title bar moves it. */
export function dragWindow() {
  post("glassLab", "drag");
}

/** The lab's own window: its real traffic lights, the first one's left edge
 *  and the line they're centred on, to sit on the page's lip. */
export function placeLabLights(left: number, centre: number) {
  post("glassLab", { lights: { left, centre } });
}

/** One thing a piece of the glass above holds (ShellChrome.swift). */
export type ChromeItem = {
  id: string;
  kind: "button" | "place" | "tab" | "avatar" | "gap" | "flex";
  symbol?: string;
  label: string;
  title?: string;
  selected?: boolean;
  disabled?: boolean;
};

/** The glass above the page: where its pieces go and what they hold. */
export type GlassChrome =
  | { on: false }
  | {
      on: true;
      variant: "regular" | "clear";
      h: number;
      r: number;
      card: string;
      modal: boolean;
      lead: { x: number; y: number; items: ChromeItem[] };
      tabs: { x: number; y: number; maxW: number; items: ChromeItem[] } | null;
      /** The places pane, its corners concentric with the window's (r). */
      places: Box & { r: number; items: ChromeItem[] };
    };

let lastChrome = "";

/** Sends the glass above the page its pieces, when anything has changed. */
export function reportChrome(chrome: GlassChrome) {
  const json = JSON.stringify(chrome);
  if (json === lastChrome) return;
  lastChrome = json;
  post("shellChrome", { type: "chrome", ...chrome });
}

/** A press on a piece of the glass above: its item's id. */
export function useChromeActions(act: (action: string) => void) {
  const latest = React.useRef(act);
  latest.current = act;
  React.useEffect(() => {
    const pressed = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action) latest.current(action);
    };
    window.addEventListener("polyphonic-chrome", pressed);
    return () => window.removeEventListener("polyphonic-chrome", pressed);
  }, []);
}

type LabWindowState = { radius: number; key: boolean };

function readLabWindow(): LabWindowState {
  const told = (window as Window & { __polyphonicWindow?: LabWindowState })
    .__polyphonicWindow;
  return told ?? { radius: 16, key: document.hasFocus() };
}

/** The window around the page: its corner radius (from AppKit, in the glass
 *  lab; 16 otherwise) and whether it's the one in use (the lab says; in a
 *  browser, whether the page has focus). */
export function useLabWindow(): LabWindowState {
  const [state, setState] = React.useState(readLabWindow);
  React.useEffect(() => {
    const told = (event: Event) => {
      const detail = (event as CustomEvent<LabWindowState>).detail;
      if (detail) setState(detail);
    };
    const focus = () => {
      if (!("__polyphonicWindow" in window)) setState(readLabWindow());
    };
    window.addEventListener("polyphonic-window", told);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", focus);
    // A page that has just loaded asks the lab where it is.
    post("shellChrome", { type: "window" });
    return () => {
      window.removeEventListener("polyphonic-window", told);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", focus);
    };
  }, []);
  return state;
}

/** Whether the lab's window draws real traffic lights. */
export const titledLabWindow = () =>
  (window as Window & { __POLYPHONIC_GLASS_LAB__?: string })
    .__POLYPHONIC_GLASS_LAB__ === "window";

const announced = () => Boolean(glassWindow().__POLYPHONIC_NATIVE_GLASS__);

/** Whether the glass lab is around this page at all, whatever the person's
 *  settings: Apple's glass above the page follows Reduce Transparency itself. */
export function useNativePresent() {
  const [present, setPresent] = React.useState(announced);
  React.useEffect(() => {
    const show = () => setPresent(true);
    window.addEventListener("polyphonic-native-glass", show);
    if (announced()) show();
    return () => window.removeEventListener("polyphonic-native-glass", show);
  }, []);
  return present;
}

/** Whether Apple's glass is beneath this page: the glass lab announces it, and
 *  Reduce Transparency turns it down (the page draws everything opaque). */
export function useNativeGlass() {
  const [present, setPresent] = React.useState(announced);
  const [opaque, setOpaque] = React.useState(
    () => window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
  );
  React.useEffect(() => {
    const show = () => setPresent(true);
    window.addEventListener("polyphonic-native-glass", show);
    if (announced()) show();
    const query = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const change = () => setOpaque(query.matches);
    query.addEventListener("change", change);
    return () => {
      window.removeEventListener("polyphonic-native-glass", show);
      query.removeEventListener("change", change);
    };
  }, []);
  return present && !opaque;
}
