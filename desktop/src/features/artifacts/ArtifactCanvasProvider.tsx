import { listen } from "@tauri-apps/api/event";
import { useLocation } from "@tanstack/react-router";
import * as React from "react";

import { isPopoutWindow } from "@/app/popout/popoutMode";
import type {
  ArtifactCanvasMode,
  ArtifactCanvasPhase,
  ArtifactCanvasPresentation,
} from "@/features/artifacts/types";
import { ArtifactCanvas } from "@/features/artifacts/ui/ArtifactCanvas";
import type { ArtifactCanvasWindowResult } from "@/shared/api/tauriArtifacts";
import { setArtifactCanvasWindowOpen } from "@/shared/api/tauriArtifacts";
import { useRightCardsSlot } from "@/shared/layout/RightCardsSlot";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { artifactsQueryKey } from "@/features/artifacts/hooks";

type ArtifactCanvasContextValue = {
  closeCanvas: () => void;
  mode: ArtifactCanvasMode;
  openArtifact: (presentation: ArtifactCanvasPresentation) => void;
  phase: ArtifactCanvasPhase;
  presentation: ArtifactCanvasPresentation | null;
};

const ArtifactCanvasContext =
  React.createContext<ArtifactCanvasContextValue | null>(null);

const TRANSITION_MS = 480;

function browserMode(): ArtifactCanvasMode {
  if (window.innerWidth < 64 * 16) return "focus";
  return window.innerWidth >= 100 * 16 ? "expanded" : "contained";
}

/**
 * Widen or narrow THIS window to seat the canvas — main window only.
 *
 * `set_artifact_canvas_window_open` resizes the window it is called from: it
 * is how the main window grows by the canvas's width and shrinks back
 * afterwards. A pop-out must never ask for it. It opens at 380px beside
 * whatever the owner is actually working in, so the call would shove the
 * pop-out across the desktop — and the geometry it restores to is the main
 * window's, not this one's.
 *
 * One choke point rather than a guard at each call site, so a fourth caller
 * cannot reintroduce the resize by forgetting.
 *
 * TODO(M2): what a pop-out does with an artifact AT ALL is still open. The
 * question worth answering is the hand-off — a pop-out passing the artifact to
 * the main window's canvas — not a second canvas inside a 380px window.
 */
async function seatCanvasWindow(
  open: boolean,
  preferredCanvasWidthPx?: number,
): Promise<ArtifactCanvasWindowResult | null> {
  if (isPopoutWindow()) {
    return null;
  }
  return setArtifactCanvasWindowOpen(open, preferredCanvasWidthPx);
}

export function ArtifactCanvasProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [presentation, setPresentation] =
    React.useState<ArtifactCanvasPresentation | null>(null);
  const [phase, setPhase] = React.useState<ArtifactCanvasPhase>("closed");
  const [mode, setMode] = React.useState<ArtifactCanvasMode>(browserMode);
  const closeTimer = React.useRef<number | null>(null);
  const nativeWindowOpen = React.useRef(false);
  const openRequest = React.useRef(0);
  const restoreFocus = React.useRef<HTMLElement | null>(null);
  const dismissedTurns = React.useRef(new Set<string>());
  const autoPresentedTurns = React.useRef(new Set<string>());
  const currentConversationId = location.pathname.startsWith("/channels/")
    ? decodeURIComponent(location.pathname.split("/")[2] ?? "")
    : null;

  const openArtifact = React.useCallback((next: ArtifactCanvasPresentation) => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    const request = ++openRequest.current;
    restoreFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPhase("opening");
    nativeWindowOpen.current = true;
    void seatCanvasWindow(true, 704)
      .then((result) => setMode(result?.mode ?? browserMode()))
      .catch(() => setMode(browserMode()))
      .finally(() => {
        if (request !== openRequest.current) return;
        setPresentation(next);
        requestAnimationFrame(() => setPhase("open"));
      });
  }, []);

  const closeCanvas = React.useCallback(() => {
    if (!presentation) return;
    ++openRequest.current;
    if (presentation.turnId) dismissedTurns.current.add(presentation.turnId);
    setPhase("closing");
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    closeTimer.current = window.setTimeout(
      () => {
        setPresentation(null);
        setPhase("closed");
        nativeWindowOpen.current = false;
        void seatCanvasWindow(false).catch(() => undefined);
        if (restoreFocus.current?.isConnected) restoreFocus.current.focus();
      },
      reduced ? 0 : TRANSITION_MS,
    );
  }, [presentation]);

  React.useEffect(() => {
    if (!presentation) return;
    let lastWidth = window.innerWidth;
    const onResize = () => {
      if (Math.abs(window.innerWidth - lastWidth) < 8) return;
      lastWidth = window.innerWidth;
      setMode(browserMode());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [presentation]);

  React.useEffect(() => {
    const root = document.documentElement;
    if (presentation) {
      root.dataset.artifactCanvasOpen = "true";
      root.dataset.artifactCanvasMode = mode;
      root.dataset.artifactCanvasPhase = phase;
    } else {
      delete root.dataset.artifactCanvasOpen;
      delete root.dataset.artifactCanvasMode;
      delete root.dataset.artifactCanvasPhase;
    }
    return () => {
      delete root.dataset.artifactCanvasOpen;
      delete root.dataset.artifactCanvasMode;
      delete root.dataset.artifactCanvasPhase;
    };
  }, [mode, phase, presentation]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && presentation) closeCanvas();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCanvas, presentation]);

  React.useEffect(() => {
    const unlisten = Promise.all([
      listen<{ artifactId?: string; conversationId?: string }>(
        "luca://artifacts-changed",
        () =>
          void queryClient.invalidateQueries({ queryKey: artifactsQueryKey }),
      ),
      listen<{
        artifactId: string;
        version?: number | null;
        previewSessionId?: string | null;
        conversationId: string;
        residentPubkey?: string | null;
        turnId?: string | null;
      }>("luca://canvas-present", ({ payload }) => {
        void queryClient.invalidateQueries({ queryKey: artifactsQueryKey });
        // A pop-out does not auto-present. Every window listening to this
        // event would open its own canvas on the same turn, and the one that
        // should is the window the owner is looking at — the main one. The
        // receipt in the pop-out's own timeline still opens by hand.
        // TODO(M2): the hand-off — a pop-out sending an artifact to the main
        // window's canvas rather than swallowing or duplicating it.
        if (isPopoutWindow()) return;
        const turnId = payload.turnId ?? null;
        if (payload.conversationId !== currentConversationId) return;
        if (turnId && dismissedTurns.current.has(turnId)) return;
        if (turnId && autoPresentedTurns.current.has(turnId)) return;
        if (turnId) autoPresentedTurns.current.add(turnId);
        if (presentation) return;
        openArtifact({
          artifactId: payload.artifactId,
          version: payload.version ?? null,
          previewSessionId: payload.previewSessionId ?? null,
          conversationId: payload.conversationId,
          residentPubkey: payload.residentPubkey ?? null,
          turnId,
          source: "agent",
        });
      }),
      listen(
        "luca://preview-state",
        () =>
          void queryClient.invalidateQueries({ queryKey: artifactsQueryKey }),
      ),
    ]);
    return () =>
      void unlisten.then((callbacks) =>
        callbacks.forEach((stop) => {
          stop();
        }),
      );
  }, [currentConversationId, openArtifact, presentation, queryClient]);

  React.useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      ++openRequest.current;
      if (nativeWindowOpen.current) {
        nativeWindowOpen.current = false;
        void seatCanvasWindow(false).catch(() => undefined);
      }
    },
    [],
  );

  const value = React.useMemo(
    () => ({ closeCanvas, mode, openArtifact, phase, presentation }),
    [closeCanvas, mode, openArtifact, phase, presentation],
  );
  return (
    <ArtifactCanvasContext.Provider value={value}>
      {children}
      <ArtifactCanvasHost />
    </ArtifactCanvasContext.Provider>
  );
}

function ArtifactCanvasHost() {
  const slot = useRightCardsSlot();
  const canvas = useArtifactCanvas();
  if (!slot || !canvas.presentation) return null;
  return createPortal(<ArtifactCanvas />, slot);
}

export function useArtifactCanvas() {
  const value = React.useContext(ArtifactCanvasContext);
  if (!value)
    throw new Error(
      "useArtifactCanvas must be used inside ArtifactCanvasProvider",
    );
  return value;
}
