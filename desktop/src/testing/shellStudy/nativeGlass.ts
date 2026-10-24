import * as React from "react";

/**
 * The study's line to Apple's glass, when the page runs in the glass lab
 * (desktop/src-tauri/native/glass): the page says where things are, the
 * native side draws the glass beneath the page and moves it. The protocol is
 * in PolyphonicGlass.swift's header; this sends the shell study's part of it.
 */

export type Box = { x: number; y: number; w: number; h: number };

export type GlassFrame = {
  card: (Box & { r: number }) | null;
  /** The floor under everything, or "none" for a clear window. */
  floor: string;
  row: (Box & { id: string }) | null;
  clip: Box | null;
  sheet: (Box & { r: number; style: "clear" | "regular" }) | null;
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

/** Whether the lab's window draws real traffic lights. */
export const titledLabWindow = () =>
  (window as Window & { __POLYPHONIC_GLASS_LAB__?: string })
    .__POLYPHONIC_GLASS_LAB__ === "window";

const announced = () => Boolean(glassWindow().__POLYPHONIC_NATIVE_GLASS__);

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
