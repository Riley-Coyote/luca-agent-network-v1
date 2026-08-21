import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDownToLine,
  ExternalLink,
  FileCode2,
  History,
  LoaderCircle,
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
  usePreviewSession,
} from "@/features/artifacts/hooks";
import type { ArtifactView } from "@/features/artifacts/types";
import { ArtifactRenderer } from "@/features/artifacts/ui/ArtifactRenderer";
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
  const previewQuery = useArtifactPreview(
    artifact?.id ?? null,
    selectedVersion ?? artifact?.currentVersion ?? null,
  );
  const sessionQuery = usePreviewSession(
    presentation?.previewSessionId ?? null,
  );
  const mutations = useArtifactMutations();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (phase === "open")
      closeButtonRef.current?.focus({ preventScroll: true });
  }, [phase]);

  if (!presentation) return null;

  const previewSession = sessionQuery.data;
  const currentVersion = selectedVersion ?? artifact?.currentVersion ?? null;
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
              {artifact?.provenance.residentName ?? "Resident"}
              {artifact?.provenance.conversationLabel
                ? ` · ${artifact.provenance.conversationLabel}`
                : ""}
            </p>
          </div>
        </div>
        <div className="artifact-canvas-card__actions">
          {previewSession ? (
            <span
              className="artifact-preview-status"
              data-status={previewSession.status}
            >
              <i aria-hidden /> {previewSession.status}
            </span>
          ) : null}
          <button
            aria-label="Export artifact"
            disabled={!artifact}
            onClick={() =>
              artifact &&
              mutations.exportArtifact.mutate({
                artifactId: artifact.id,
                version: currentVersion ?? undefined,
              })
            }
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
          {(["preview", "source", "versions"] as const).map((tab) => (
            <button
              aria-selected={view === tab}
              className={cn(view === tab && "is-active")}
              key={tab}
              onClick={() => setView(tab)}
              role="tab"
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
                mutations.refreshPreview.mutate(previewSession.id);
              }}
              type="button"
            >
              <RefreshCw aria-hidden />
            </button>
            <button
              aria-label="Open preview externally"
              onClick={() =>
                void openUrl(previewSession.displayUrl).catch(() => undefined)
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
                  .catch(() => undefined)
              }
              type="button"
            >
              <Unplug aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <div className="artifact-canvas-card__body">
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
        ) : view === "preview" ? (
          <ArtifactRenderer
            artifact={artifact}
            payload={previewQuery.data}
            previewSession={previewSession}
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
                        mutations.revertArtifact.mutate({
                          artifactId: artifact.id,
                          version: version.number,
                          expectedCurrentVersion: artifact.currentVersion,
                        })
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

      {previewSession?.status === "stopped" ? (
        <footer className="artifact-canvas-card__recovery">
          <div>
            <strong>Preview stopped</strong>
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
      </span>
    </aside>
  );
}
