import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDownToLine,
  ExternalLink,
  FileCode2,
  History,
  LoaderCircle,
  MousePointer2,
  RefreshCw,
  RotateCcw,
  Unplug,
  X,
} from "lucide-react";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useArtifactCanvas } from "@/features/artifacts/ArtifactCanvasProvider";
import {
  useArtifactDetail,
  useArtifactMutations,
  useArtifactPreview,
  useArtifactPreviewState,
  usePreviewSession,
} from "@/features/artifacts/hooks";
import type {
  ArtifactView,
  PreviewHealth,
  PreviewSession,
} from "@/features/artifacts/types";
import { ArtifactRenderer } from "@/features/artifacts/ui/ArtifactRenderer";
import { useArtifactProvenanceLabels } from "@/features/artifacts/useArtifactProvenanceLabels";
import {
  loadDraftEntry,
  saveDraftEntry,
} from "@/features/messages/lib/useDrafts";
import { detachPreviewSession } from "@/shared/api/tauriArtifacts";
import { cn } from "@/shared/lib/cn";

import "./artifact-canvas.css";

export function ArtifactCanvas() {
  const { closeCanvas, mode, phase, presentation } = useArtifactCanvas();
  const { goChannel } = useAppNavigation();
  const artifactQuery = useArtifactDetail(presentation?.artifactId ?? null);
  const artifact = artifactQuery.data;
  const [view, setView] = React.useState<ArtifactView>("preview");
  const [selectedVersion, setSelectedVersion] = React.useState<number | null>(
    presentation?.version ?? null,
  );
  const [reloadKey, setReloadKey] = React.useState(0);
  const [actionMessage, setActionMessage] = React.useState("");
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const tabRefs = React.useRef(new Map<ArtifactView, HTMLButtonElement>());
  const isHtml = artifact?.kind === "html";
  const isApp = artifact?.kind === "app";
  const previewQuery = useArtifactPreview(
    artifact?.id ?? null,
    selectedVersion ?? artifact?.currentVersion ?? null,
    Boolean(artifact) && !isApp && (!isHtml || view === "source"),
  );
  const previewStateQuery = useArtifactPreviewState(
    isApp ? (artifact?.id ?? null) : null,
  );
  const resolvedPreviewSessionId =
    presentation?.previewSessionId ??
    previewStateQuery.data?.activeSession?.id ??
    artifact?.activePreviewSessionId ??
    null;
  const sessionQuery = usePreviewSession(
    isApp ? resolvedPreviewSessionId : null,
  );
  const mutations = useArtifactMutations();
  const provenanceLabels = useArtifactProvenanceLabels();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const previewSession = useHystereticPreviewSession(
    sessionQuery.data ?? previewStateQuery.data?.activeSession ?? undefined,
  );
  const presentationResetKey = [
    presentation?.artifactId,
    presentation?.conversationId,
    presentation?.previewSessionId,
    presentation?.source,
    presentation?.turnId,
    presentation?.version,
  ].join("\u0000");

  React.useEffect(() => {
    void presentationResetKey;
    setView("preview");
    setSelectedVersion(presentation?.version ?? null);
    setReloadKey(0);
    setActionMessage("");
  }, [presentation?.version, presentationResetKey]);

  React.useEffect(() => {
    if (phase === "open")
      closeButtonRef.current?.focus({ preventScroll: true });
  }, [phase]);

  React.useEffect(() => {
    if (!actionMessage) return;
    const timer = window.setTimeout(() => setActionMessage(""), 3_500);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  if (!presentation) return null;

  const lastPreview =
    previewStateQuery.data?.lastPreview ?? artifact?.lastPreview ?? null;
  const currentVersion = selectedVersion ?? artifact?.currentVersion ?? null;
  const labels = artifact ? provenanceLabels(artifact.provenance) : null;
  const exportCurrentArtifact = () => {
    if (!artifact) return;
    mutations.exportArtifact.mutate(
      {
        artifactId: artifact.id,
        version: currentVersion ?? undefined,
      },
      {
        onSuccess: (exported) =>
          setActionMessage(exported ? "Artifact exported" : "Export cancelled"),
        onError: () => setActionMessage("Artifact export failed"),
      },
    );
  };
  const askAgentToRestart = () => {
    const conversationId =
      previewSession?.conversationId ?? presentation.conversationId;
    if (!conversationId) return;
    if (!loadDraftEntry(conversationId)) {
      const now = new Date().toISOString();
      const content = `Please restart the development server for ${artifact?.title ?? "this app"} and attach its loopback preview to Canvas again.`;
      saveDraftEntry(conversationId, {
        content,
        selectionStart: content.length,
        selectionEnd: content.length,
        channelId: conversationId,
        createdAt: now,
        updatedAt: now,
        pendingImeta: [],
        mentionRefs: [],
        spoileredAttachmentUrls: [],
        status: "active",
      });
    }
    closeCanvas();
    void goChannel(conversationId);
  };
  const views = ["preview", "source", "versions"] as const;
  const selectRelativeTab = (current: ArtifactView, direction: number) => {
    const index = views.indexOf(current);
    const next = views[(index + direction + views.length) % views.length];
    setView(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <aside
      aria-label={
        artifact ? `Canvas preview of ${artifact.title}` : "Artifact Canvas"
      }
      className="artifact-canvas-card"
      data-canvas-mode={mode}
      data-canvas-phase={phase}
      data-luca-card
      data-luca-canvas
      data-testid="artifact-canvas"
    >
      <header className="artifact-canvas-card__header">
        <div className="artifact-canvas-card__identity">
          <span className="artifact-canvas-card__mark" aria-hidden>
            <FileCode2 />
          </span>
          <div>
            <div className="artifact-canvas-card__title">
              <h2>{artifact?.title ?? "Opening artifact"}</h2>
              {artifact ? <span>v{currentVersion}</span> : null}
            </div>
            <p>
              {labels?.resident ?? "Resident"}
              {labels?.conversation ? ` · ${labels.conversation}` : ""}
            </p>
          </div>
        </div>
        <div className="artifact-canvas-card__actions">
          {previewSession ? (
            <span
              className="artifact-preview-status"
              data-status={previewSession.status}
              role="status"
            >
              <i aria-hidden /> {previewSession.status}
            </span>
          ) : null}
          <button
            aria-label="Export artifact"
            disabled={!artifact}
            onClick={exportCurrentArtifact}
            type="button"
          >
            <ArrowDownToLine aria-hidden />
          </button>
          <button
            aria-label="Close Canvas"
            data-testid="close-artifact-canvas"
            onClick={closeCanvas}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden />
          </button>
        </div>
      </header>

      <div className="artifact-canvas-card__toolbar">
        <div
          aria-label="Artifact view"
          className="artifact-canvas-tabs"
          role="tablist"
        >
          {views.map((tab) => (
            <button
              aria-controls="artifact-canvas-panel"
              aria-selected={view === tab}
              className={cn(view === tab && "is-active")}
              id={`artifact-tab-${tab}`}
              key={tab}
              onClick={() => setView(tab)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") selectRelativeTab(tab, 1);
                if (event.key === "ArrowLeft") selectRelativeTab(tab, -1);
                if (event.key === "Home") {
                  setView(views[0]);
                  tabRefs.current.get(views[0])?.focus();
                }
                if (event.key === "End") {
                  setView(views[views.length - 1]);
                  tabRefs.current.get(views[views.length - 1])?.focus();
                }
              }}
              ref={(element) => {
                if (element) tabRefs.current.set(tab, element);
                else tabRefs.current.delete(tab);
              }}
              role="tab"
              tabIndex={view === tab ? 0 : -1}
              type="button"
            >
              {tab}
              {tab === "versions" && artifact ? (
                <span>{artifact.versions.length}</span>
              ) : null}
            </button>
          ))}
        </div>
        {previewSession ? (
          <div className="artifact-live-controls">
            <span title={previewSession.displayUrl}>
              {previewSession.displayUrl}
            </span>
            <button
              aria-label="Reload preview"
              onClick={() => {
                setReloadKey((key) => key + 1);
                mutations.refreshPreview.mutate(previewSession.id, {
                  onError: () => setActionMessage("Preview is unreachable"),
                });
              }}
              type="button"
            >
              <RefreshCw aria-hidden />
            </button>
            <button
              aria-label="Open preview externally"
              onClick={() =>
                void openUrl(previewSession.displayUrl).catch(() =>
                  setActionMessage("Could not open the preview externally"),
                )
              }
              type="button"
            >
              <ExternalLink aria-hidden />
            </button>
            <button
              aria-label="Detach preview"
              onClick={() =>
                void detachPreviewSession(previewSession.id)
                  .then(closeCanvas)
                  .catch(() => setActionMessage("Could not detach the preview"))
              }
              type="button"
            >
              <Unplug aria-hidden />
            </button>
          </div>
        ) : null}
        {view === "preview" && isApp && previewSession?.status === "ready" ? (
          <button
            aria-label="Interact with artifact preview"
            className="artifact-preview-enter"
            onClick={() => frameRef.current?.focus()}
            type="button"
          >
            <MousePointer2 aria-hidden /> Interact
          </button>
        ) : null}
      </div>

      <div
        aria-labelledby={`artifact-tab-${view}`}
        className="artifact-canvas-card__body"
        id="artifact-canvas-panel"
        role="tabpanel"
      >
        {artifactQuery.isLoading ? (
          <div className="artifact-renderer-state">
            <LoaderCircle aria-hidden className="animate-spin" />
            <p>Opening Canvas</p>
          </div>
        ) : artifactQuery.isError || !artifact ? (
          <div
            className="artifact-renderer-state"
            data-testid="artifact-canvas-error"
          >
            <FileCode2 aria-hidden />
            <h3>Artifact unavailable</h3>
            <p>
              Canvas could not load this artifact. Your conversation is still
              available.
            </p>
            <button onClick={() => void artifactQuery.refetch()} type="button">
              Try again
            </button>
          </div>
        ) : artifact.deletedAt ? (
          <div className="artifact-renderer-state">
            <FileCode2 aria-hidden />
            <h3>Artifact is in Recently deleted</h3>
            <p>Restore it before opening or exporting its contents.</p>
            <button
              disabled={mutations.restoreArtifact.isPending}
              onClick={() =>
                mutations.restoreArtifact.mutate(artifact.id, {
                  onError: () => setActionMessage("Could not restore artifact"),
                })
              }
              type="button"
            >
              Restore artifact
            </button>
          </div>
        ) : view === "preview" ? (
          <ArtifactRenderer
            artifact={artifact}
            frameRef={frameRef}
            lastPreview={lastPreview}
            payload={previewQuery.data}
            payloadError={previewQuery.error}
            exportPending={mutations.exportArtifact.isPending}
            onExport={exportCurrentArtifact}
            previewSession={previewSession}
            previewSessionError={sessionQuery.error ?? previewStateQuery.error}
            reloadKey={reloadKey}
          />
        ) : view === "source" ? (
          <pre className="artifact-renderer-code">
            <code>
              {previewQuery.data?.text ??
                "Source is not available for this artifact."}
            </code>
          </pre>
        ) : (
          <ol className="artifact-version-list">
            {artifact.versions.map((version) => (
              <li
                data-current={version.number === artifact.currentVersion}
                key={version.id}
              >
                <span>
                  <History aria-hidden />
                </span>
                <div>
                  <strong>Version {version.number}</strong>
                  <p>{version.note}</p>
                  <small>
                    {version.createdAt} · {version.sizeLabel}
                  </small>
                </div>
                <div className="artifact-version-list__actions">
                  <button
                    onClick={() => {
                      setSelectedVersion(version.number);
                      setView("preview");
                    }}
                    type="button"
                  >
                    Preview
                  </button>
                  {version.number !== artifact.currentVersion ? (
                    <button
                      disabled={mutations.revertArtifact.isPending}
                      onClick={() =>
                        mutations.revertArtifact.mutate(
                          {
                            artifactId: artifact.id,
                            version: version.number,
                            expectedCurrentVersion: artifact.currentVersion,
                          },
                          {
                            onError: () =>
                              setActionMessage(
                                "Could not restore that version",
                              ),
                          },
                        )
                      }
                      type="button"
                    >
                      <RotateCcw aria-hidden /> Restore as new
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {actionMessage ? (
        <div className="artifact-canvas-card__notice" role="status">
          {actionMessage}
        </div>
      ) : null}

      {isApp &&
      (previewSession?.status === "stopped" ||
        previewSession?.status === "unreachable" ||
        (!previewSession && !previewStateQuery.isLoading)) ? (
        <footer className="artifact-canvas-card__recovery">
          <div>
            <strong>
              {previewSession?.status === "unreachable"
                ? "Preview unreachable"
                : "Preview stopped"}
            </strong>
            <span>
              Luca does not own or restart the agent’s server process.
            </span>
          </div>
          <button
            data-testid="ask-agent-restart"
            onClick={askAgentToRestart}
            type="button"
          >
            Ask agent to restart
          </button>
        </footer>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {phase === "open" && artifact
          ? `${artifact.title} opened in Canvas`
          : ""}
        {actionMessage ? `. ${actionMessage}` : ""}
      </span>
    </aside>
  );
}

function useHystereticPreviewSession(
  session: PreviewSession | undefined,
): PreviewSession | undefined {
  const [failures, setFailures] = React.useState(0);
  const sessionId = session?.id ?? null;
  const status = session?.status;
  const checkedAt = session?.checkedAt;
  React.useEffect(() => {
    void checkedAt;
    if (!sessionId || status === "ready" || status === "starting") {
      setFailures(0);
      return;
    }
    if (status === "unreachable") setFailures((count) => count + 1);
  }, [checkedAt, sessionId, status]);
  if (session?.status !== "unreachable" || failures < 3) return session;
  return { ...session, status: "stopped" as PreviewHealth };
}
