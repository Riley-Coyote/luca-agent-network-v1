import { FileWarning, ImageIcon, LoaderCircle } from "lucide-react";
import type * as React from "react";
import ReactMarkdown from "react-markdown";

import type {
  ArtifactDetail,
  LastPreviewMetadata,
  ArtifactPreviewPayload,
  PreparedArtifactPreview,
  PreviewSession,
} from "@/features/artifacts/types";
import { svgImageDataUrl } from "@/features/artifacts/lib/previewSecurity";

type ArtifactRendererProps = {
  artifact: ArtifactDetail;
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  lastPreview: LastPreviewMetadata | null;
  payload: ArtifactPreviewPayload | undefined;
  payloadError: Error | null;
  preparedPreview: PreparedArtifactPreview | undefined;
  preparedPreviewError: Error | null;
  previewSession: PreviewSession | undefined;
  previewSessionError: Error | null;
  reloadKey: number;
};

export function ArtifactRenderer({
  artifact,
  frameRef,
  lastPreview,
  payload,
  payloadError,
  preparedPreview,
  preparedPreviewError,
  previewSession,
  previewSessionError,
  reloadKey,
}: ArtifactRendererProps) {
  if (artifact.kind === "app") {
    return (
      <LiveAppRenderer
        error={previewSessionError}
        frameRef={frameRef}
        lastPreview={lastPreview}
        reloadKey={reloadKey}
        session={previewSession}
      />
    );
  }

  if (artifact.kind === "html") {
    if (preparedPreviewError) {
      return (
        <RendererFallback
          message={previewErrorMessage(preparedPreviewError)}
          title="HTML preview unavailable"
        />
      );
    }
    if (!preparedPreview) {
      return <RendererLoading label="Preparing secure preview" />;
    }
    return (
      <iframe
        className="artifact-renderer-frame"
        data-testid="artifact-html-preview"
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        src={preparedPreview.uri}
        tabIndex={-1}
        title={`Preview of ${artifact.title}`}
      />
    );
  }

  if (payloadError) {
    return (
      <RendererFallback
        message={previewErrorMessage(payloadError)}
        title="Preview unavailable"
      />
    );
  }

  if (!payload) {
    return <RendererLoading label="Preparing preview" />;
  }

  if (payload.availability !== "ready") {
    return (
      <RendererFallback
        message={
          payload.safeMessage ?? availabilityMessage(payload.availability)
        }
        title="Preview unavailable"
      />
    );
  }

  if (payload.capability === "image" && payload.dataUrl) {
    return (
      <div className="artifact-renderer-image">
        <img alt={artifact.summary ?? artifact.title} src={payload.dataUrl} />
        <span>
          <ImageIcon aria-hidden /> Managed image preview
        </span>
      </div>
    );
  }

  if (payload.capability === "svg_image" && (payload.dataUrl || payload.text)) {
    return (
      <div className="artifact-renderer-image">
        <img
          alt={artifact.summary ?? artifact.title}
          data-testid="artifact-svg-image"
          src={payload.dataUrl ?? svgImageDataUrl(payload.text ?? "")}
        />
        <span>
          <ImageIcon aria-hidden /> SVG rendered as an image
        </span>
      </div>
    );
  }

  if (payload.capability === "markdown" && payload.text !== null) {
    return (
      <article
        className="artifact-renderer-document"
        data-testid="artifact-markdown-preview"
      >
        <ReactMarkdown
          allowedElements={[
            "a",
            "blockquote",
            "br",
            "code",
            "del",
            "em",
            "h1",
            "h2",
            "h3",
            "h4",
            "hr",
            "li",
            "ol",
            "p",
            "pre",
            "strong",
            "table",
            "tbody",
            "td",
            "th",
            "thead",
            "tr",
            "ul",
          ]}
          components={{
            a: ({ children }) => (
              <span className="artifact-document-link">{children}</span>
            ),
          }}
          skipHtml
          urlTransform={() => ""}
        >
          {payload.text}
        </ReactMarkdown>
      </article>
    );
  }

  if (
    (payload.capability === "text" || payload.capability === "code") &&
    payload.text !== null
  ) {
    return (
      <pre
        className="artifact-renderer-code"
        data-testid="artifact-text-preview"
      >
        <code>{payload.text}</code>
      </pre>
    );
  }

  if (payload.capability === "pdf") {
    return (
      <RendererFallback
        message="PDF preview depends on the native viewer. Export the file to inspect it without granting generated content app access."
        title="PDF kept safely"
      />
    );
  }

  return (
    <RendererFallback
      message="This file is stored in Library and can be exported to its native application."
      title="No inline preview"
    />
  );
}

function LiveAppRenderer({
  error,
  frameRef,
  lastPreview,
  reloadKey,
  session,
}: {
  error: Error | null;
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  lastPreview: LastPreviewMetadata | null;
  reloadKey: number;
  session: PreviewSession | undefined;
}) {
  if (error) {
    return (
      <RendererFallback
        message="Canvas could not read the current preview session. The application artifact is still safe in Library."
        title="Preview state unavailable"
      />
    );
  }
  if (!session) {
    return (
      <div className="artifact-renderer-state" data-preview-health="stopped">
        <FileWarning aria-hidden />
        <h3>No server attached</h3>
        <p>
          {lastPreview
            ? `The last preview used ${previewDisplayUrl(lastPreview)}. Ask the source resident to start it again.`
            : "Ask the source resident to start its development server and attach a loopback preview."}
        </p>
      </div>
    );
  }
  if (session?.status !== "ready" || !session.proxyUrl) {
    return (
      <div
        className="artifact-renderer-state"
        data-preview-health={session?.status ?? "starting"}
      >
        {session?.status === "starting" ? (
          <LoaderCircle aria-hidden className="animate-spin" />
        ) : (
          <FileWarning aria-hidden />
        )}
        <p>
          {session?.status === "unreachable"
            ? "The server has not answered yet."
            : session?.status === "stopped"
              ? "The development server stopped."
              : "Waiting for the local application."}
        </p>
      </div>
    );
  }
  return (
    <iframe
      className="artifact-renderer-frame"
      data-testid="artifact-live-preview"
      key={reloadKey}
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox="allow-forms allow-same-origin allow-scripts"
      src={session.proxyUrl}
      tabIndex={-1}
      title="Local application preview"
    />
  );
}

function RendererLoading({ label }: { label: string }) {
  return (
    <div
      className="artifact-renderer-state"
      data-testid="artifact-preview-loading"
    >
      <LoaderCircle aria-hidden className="animate-spin" />
      <p>{label}</p>
    </div>
  );
}

function previewDisplayUrl(preview: LastPreviewMetadata) {
  return `${preview.origin}:${preview.port}`;
}

function previewErrorMessage(error: Error) {
  const message = error.message.toLowerCase();
  if (message.includes("deleted"))
    return "Restore this artifact before previewing it.";
  if (message.includes("corrupt"))
    return "The managed copy could not be verified. No source bytes were substituted.";
  if (message.includes("source-missing"))
    return "The bound source is missing, but the artifact record remains available.";
  if (message.includes("too-large"))
    return "This artifact is larger than the safe inline preview limit.";
  if (message.includes("expired") || message.includes("not-found"))
    return "This preview expired. Close and reopen Canvas to prepare a fresh one.";
  return "Canvas could not prepare this preview. The artifact remains available to export.";
}

function RendererFallback({
  actionDisabled,
  actionLabel,
  onAction,
  title,
  message,
}: {
  actionDisabled?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  title: string;
  message: string;
}) {
  return (
    <div
      className="artifact-renderer-state"
      data-testid="artifact-preview-fallback"
    >
      <FileWarning aria-hidden />
      <h3>{title}</h3>
      <p>{message}</p>
      {actionLabel && onAction ? (
        <button disabled={actionDisabled} onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function availabilityMessage(
  availability: ArtifactPreviewPayload["availability"],
) {
  switch (availability) {
    case "corrupt":
      return "The managed copy could not be verified. No source bytes were substituted.";
    case "source_missing":
      return "The bound source is missing, but the artifact record remains available.";
    case "too_large":
      return "This artifact is larger than the inline preview limit.";
    case "unavailable":
      return "The artifact service is unavailable. Conversation remains unaffected.";
    default:
      return "This artifact does not have a safe inline renderer.";
  }
}
