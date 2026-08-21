import { FileWarning, ImageIcon, LoaderCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";

import type {
  ArtifactDetail,
  ArtifactPreviewPayload,
  PreviewSession,
} from "@/features/artifacts/types";
import {
  buildOpaqueHtmlDocument,
  svgImageDataUrl,
} from "@/features/artifacts/lib/previewSecurity";

type ArtifactRendererProps = {
  artifact: ArtifactDetail;
  payload: ArtifactPreviewPayload | undefined;
  previewSession: PreviewSession | undefined;
  reloadKey: number;
};

export function ArtifactRenderer({
  artifact,
  payload,
  previewSession,
  reloadKey,
}: ArtifactRendererProps) {
  if (artifact.kind === "app") {
    return <LiveAppRenderer reloadKey={reloadKey} session={previewSession} />;
  }

  if (!payload) {
    return (
      <div
        className="artifact-renderer-state"
        data-testid="artifact-preview-loading"
      >
        <LoaderCircle aria-hidden className="animate-spin" />
        <p>Preparing preview</p>
      </div>
    );
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

  if (payload.capability === "html" && payload.text !== null) {
    return (
      <iframe
        className="artifact-renderer-frame"
        data-testid="artifact-html-preview"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        srcDoc={buildOpaqueHtmlDocument(payload.text)}
        title={`Preview of ${artifact.title}`}
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
  reloadKey,
  session,
}: {
  reloadKey: number;
  session: PreviewSession | undefined;
}) {
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
      referrerPolicy="no-referrer"
      sandbox="allow-forms allow-same-origin allow-scripts"
      src={session.proxyUrl}
      title="Local application preview"
    />
  );
}

function RendererFallback({
  title,
  message,
}: {
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
