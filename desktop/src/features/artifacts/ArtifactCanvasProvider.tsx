import { listen } from "@tauri-apps/api/event";
import { useLocation } from "@tanstack/react-router";
import * as React from "react";

import type {
  ArtifactCanvasMode,
  ArtifactCanvasPhase,
  ArtifactCanvasPresentation,
} from "@/features/artifacts/types";
import { ArtifactCanvas } from "@/features/artifacts/ui/ArtifactCanvas";
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
  const restoreFocus = React.useRef<HTMLElement | null>(null);
  const dismissedTurns = React.useRef(new Set<string>());
  const autoPresentedTurns = React.useRef(new Set<string>());
  const currentConversationId = location.pathname.startsWith("/channels/")
    ? decodeURIComponent(location.pathname.split("/")[2] ?? "")
    : null;

  const openArtifact = React.useCallback((next: ArtifactCanvasPresentation) => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    restoreFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPhase("opening");
    void setArtifactCanvasWindowOpen(true, 704)
      .then((result) => setMode(result.mode))
      .catch(() => setMode(browserMode()))
      .finally(() => {
        setPresentation(next);
        requestAnimationFrame(() => setPhase("open"));
      });
  }, []);

  const closeCanvas = React.useCallback(() => {
    if (!presentation) return;
    if (presentation.turnId) dismissedTurns.current.add(presentation.turnId);
    setPhase("closing");
    void setArtifactCanvasWindowOpen(false).catch(() => undefined);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    closeTimer.current = window.setTimeout(
      () => {
        setPresentation(null);
        setPhase("closed");
        restoreFocus.current?.focus();
      },
      reduced ? 0 : TRANSITION_MS,
    );
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
        const turnId = payload.turnId ?? null;
        if (payload.conversationId !== currentConversationId) return;
        if (turnId && dismissedTurns.current.has(turnId)) return;
        if (turnId && autoPresentedTurns.current.has(turnId)) return;
        if (presentation) return;
        if (turnId) autoPresentedTurns.current.add(turnId);
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
