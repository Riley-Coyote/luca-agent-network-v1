import { isTauri } from "@tauri-apps/api/core";
import {
  PhysicalPosition,
  PhysicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import * as React from "react";

import {
  type CanvasWindowRect,
  canvasWindowRectsAreNear,
  planConversationCanvasWindow,
} from "@/features/artifacts/lab/conversationCanvasWindow";

export const CONVERSATION_CANVAS_LAB_KEY = "luca:conversation-canvas-lab.v1";

export type ConversationCanvasPhase = "closed" | "closing" | "open" | "opening";

export type ConversationCanvasMode = "contained" | "expanded" | "focus";

type NativeWindowSnapshot = {
  expandedOuter: CanvasWindowRect;
  initialInner: CanvasWindowRect;
  initialOuter: CanvasWindowRect;
};

const WINDOW_TRANSITION_MS = 480;

function rectFromValues({
  height,
  width,
  x,
  y,
}: CanvasWindowRect): CanvasWindowRect {
  return { height, width, x, y };
}

function browserPresentationMode(): ConversationCanvasMode {
  if (window.innerWidth >= 1600) return "expanded";
  if (window.innerWidth >= 1040) return "contained";
  return "focus";
}

function easedProgress(progress: number) {
  return 1 - (1 - progress) ** 4;
}

async function animateNativeWindow(
  from: CanvasWindowRect,
  to: CanvasWindowRect,
  reducedMotion: boolean,
) {
  const appWindow = getCurrentWindow();
  const steps = reducedMotion ? 1 : 20;

  for (let step = 1; step <= steps; step += 1) {
    const progress = easedProgress(step / steps);
    const interpolate = (start: number, end: number) =>
      Math.round(start + (end - start) * progress);
    const next = {
      height: interpolate(from.height, to.height),
      width: interpolate(from.width, to.width),
      x: interpolate(from.x, to.x),
      y: interpolate(from.y, to.y),
    };
    await Promise.all([
      appWindow.setPosition(new PhysicalPosition(next.x, next.y)),
      appWindow.setSize(new PhysicalSize(next.width, next.height)),
    ]);
    if (step < steps) {
      await new Promise((resolve) => window.setTimeout(resolve, 18));
    }
  }
}

async function expandNativeWindow(
  setMode: (mode: ConversationCanvasMode) => void,
): Promise<NativeWindowSnapshot | null> {
  if (!isTauri()) return null;

  const appWindow = getCurrentWindow();
  const [inner, outer, position, monitor, fullscreen, maximized] =
    await Promise.all([
      appWindow.innerSize(),
      appWindow.outerSize(),
      appWindow.outerPosition(),
      currentMonitor(),
      appWindow.isFullscreen(),
      appWindow.isMaximized(),
    ]);
  if (!monitor) return null;

  const currentOuter = rectFromValues({
    height: outer.height,
    width: outer.width,
    x: position.x,
    y: position.y,
  });
  const plan = planConversationCanvasWindow({
    current: currentOuter,
    fullscreen,
    maximized,
    workArea: {
      height: monitor.workArea.size.height,
      width: monitor.workArea.size.width,
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
    },
  });
  setMode(plan.mode);
  if (plan.mode !== "expanded") return null;

  const widthDelta = plan.target.width - outer.width;
  const targetInner = {
    height: inner.height,
    width: inner.width + widthDelta,
    x: plan.target.x,
    y: plan.target.y,
  };
  const initialInner = {
    height: inner.height,
    width: inner.width,
    x: position.x,
    y: position.y,
  };
  await animateNativeWindow(
    initialInner,
    targetInner,
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  return {
    expandedOuter: plan.target,
    initialInner,
    initialOuter: currentOuter,
  };
}

async function restoreNativeWindow(snapshot: NativeWindowSnapshot | null) {
  if (!snapshot || !isTauri()) return;
  const appWindow = getCurrentWindow();
  const [outer, position] = await Promise.all([
    appWindow.outerSize(),
    appWindow.outerPosition(),
  ]);
  const currentOuter = {
    height: outer.height,
    width: outer.width,
    x: position.x,
    y: position.y,
  };

  // A manual resize while Canvas is open transfers geometry ownership to the
  // user. In that case closing Canvas must not snap the window elsewhere.
  if (!canvasWindowRectsAreNear(currentOuter, snapshot.expandedOuter)) return;

  await animateNativeWindow(
    {
      height: snapshot.initialInner.height,
      width:
        snapshot.initialInner.width +
        (snapshot.expandedOuter.width - snapshot.initialOuter.width),
      x: snapshot.expandedOuter.x,
      y: snapshot.expandedOuter.y,
    },
    snapshot.initialInner,
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

function prototypeEnabled() {
  return (
    window.__BUZZ_E2E__?.mode === "mock" &&
    window.localStorage.getItem(CONVERSATION_CANVAS_LAB_KEY) === "true"
  );
}

export function useConversationCanvasPrototype(
  conversationRef: React.RefObject<HTMLElement | null>,
) {
  const enabled = React.useMemo(prototypeEnabled, []);
  const [phase, setPhase] = React.useState<ConversationCanvasPhase>("closed");
  const [mode, setMode] = React.useState<ConversationCanvasMode>(() =>
    browserPresentationMode(),
  );
  const [conversationWidth, setConversationWidth] = React.useState<number>();
  const [hasOpened, setHasOpened] = React.useState(false);
  const autoOpenAttempted = React.useRef(false);
  const transitionTimer = React.useRef<number | undefined>(undefined);
  const nativeSnapshot = React.useRef<NativeWindowSnapshot | null>(null);

  const open = React.useCallback(() => {
    if (!enabled || phase === "open" || phase === "opening") return;
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    const measuredWidth =
      conversationRef.current?.getBoundingClientRect().width;
    if (measuredWidth) setConversationWidth(Math.round(measuredWidth));
    setMode(browserPresentationMode());
    setHasOpened(true);
    setPhase("opening");
    void expandNativeWindow(setMode)
      .then((snapshot) => {
        nativeSnapshot.current = snapshot;
      })
      .catch(() => {
        nativeSnapshot.current = null;
      });
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    transitionTimer.current = window.setTimeout(
      () => setPhase("open"),
      reducedMotion ? 0 : WINDOW_TRANSITION_MS,
    );
  }, [conversationRef, enabled, phase]);

  const close = React.useCallback(() => {
    if (!enabled || phase === "closed" || phase === "closing") return;
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    setPhase("closing");
    void restoreNativeWindow(nativeSnapshot.current).finally(() => {
      nativeSnapshot.current = null;
    });
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    transitionTimer.current = window.setTimeout(
      () => setPhase("closed"),
      reducedMotion ? 0 : WINDOW_TRANSITION_MS,
    );
  }, [enabled, phase]);

  React.useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.dataset.conversationCanvasPhase = phase;
    root.dataset.conversationCanvasMode = mode;
    return () => {
      delete root.dataset.conversationCanvasPhase;
      delete root.dataset.conversationCanvasMode;
    };
  }, [enabled, mode, phase]);

  React.useEffect(() => {
    if (!enabled) return;
    const handleOpen = () => open();
    const handleClose = () => close();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "closed") close();
      if (
        event.key === "." &&
        event.shiftKey &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        open();
      }
    };
    const handleResize = () => {
      if (!isTauri()) setMode(browserPresentationMode());
    };
    window.addEventListener("luca:conversation-canvas-open", handleOpen);
    window.addEventListener("luca:conversation-canvas-close", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("luca:conversation-canvas-open", handleOpen);
      window.removeEventListener("luca:conversation-canvas-close", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [close, enabled, open, phase]);

  React.useEffect(() => {
    if (!enabled) return;
    if (autoOpenAttempted.current) return;
    autoOpenAttempted.current = true;
    const query = new URLSearchParams(window.location.search);
    if (query.get("canvas") === "closed") return;
    const delay = Number(query.get("canvasDelay") ?? 760);
    const autoOpenTimer = window.setTimeout(
      open,
      Number.isFinite(delay) ? delay : 760,
    );
    return () => window.clearTimeout(autoOpenTimer);
  }, [enabled, open]);

  React.useEffect(
    () => () => {
      if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    },
    [],
  );

  return {
    close,
    conversationWidth,
    enabled,
    hasOpened,
    mode,
    open,
    phase,
  };
}
