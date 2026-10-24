import * as React from "react";

/**
 * The study's line to Apple's glass, when the page runs in the glass lab
 * (desktop/src-tauri/native/glass): the page says where things are, the
 * native side draws the glass beneath the page and moves it. The protocol is
 * in PolyphonicGlass.swift's header; this sends the shell study's part of it.
 * The glass floor (the frame in its own shape, with what it holds inside it)
 * has its own line, to Lab/ShellFloor.swift, whose header has that protocol.
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

/** Whether the lab had a handler by that name to take it. */
function post(name: string, body: unknown) {
  const handler = glassWindow().webkit?.messageHandlers?.[name];
  handler?.postMessage(body);
  return Boolean(handler);
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

/** One thing the frame holds, drawn inside the glass floor
 *  (Lab/ShellFloor.swift): a symbol, words, or the avatar's initial. r is the
 *  radius of the plate beneath it on hover, and of the chip when it's where
 *  you are. */
export type FloorItem = Box & {
  id: string;
  kind: "symbol" | "text" | "avatar";
  symbol?: string;
  size?: number;
  text?: string;
  /** Words in tones (the title's home, slash and session). */
  parts?: { text: string; tone: "full" | "muted" | "faint"; weight: number }[];
  align?: "center";
  pad?: number;
  r?: number;
  /** How far the plate under it stands in from its top and bottom. */
  inset?: number;
  selected?: boolean;
  disabled?: boolean;
  hover?: boolean;
  pressed?: boolean;
  /** Its name fades out under its close button. */
  fade?: boolean;
  strong?: boolean;
};

/** The glass floor: the frame as one piece of Apple's glass in its own
 *  shape, the cards (and the open tab) cut out of it, what the frame holds
 *  inside it, and darkness, if any, beneath it. */
export type GlassFloor =
  | { on: false }
  | {
      on: true;
      style: "regular" | "clear";
      tint: string | null;
      dim: number;
      r: number;
      rail: (Box & { r: number }) | null;
      card: (Box & { r: number }) | null;
      tab: Box | null;
      cardColor: string;
      items: FloorItem[];
    };

let lastFloor = "";

/** Sends the floor, when anything has changed since the last one it took. */
export function reportFloor(floor: GlassFloor) {
  const json = JSON.stringify(floor);
  if (json === lastFloor) return;
  if (post("shellFloor", { type: "floor", ...floor })) lastFloor = json;
}

/** The floor's handler has just arrived: send everything again. */
export function resetFloor() {
  lastFloor = "";
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
    post("shellFloor", { type: "window" });
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

/** Whether Apple's glass is beneath this page: the glass lab announces it.
 *  Apple's materials follow Reduce Transparency themselves (frostier, more
 *  opaque), so the page never paints a stand-in desktop over the real one. */
export function useNativeGlass() {
  const [present, setPresent] = React.useState(announced);
  React.useEffect(() => {
    const show = () => setPresent(true);
    window.addEventListener("polyphonic-native-glass", show);
    if (announced()) show();
    return () => window.removeEventListener("polyphonic-native-glass", show);
  }, []);
  return present;
}
