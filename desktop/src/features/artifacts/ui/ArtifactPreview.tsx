import { Code2, FileWarning, ImageIcon } from "lucide-react";

import type { ArtifactRecord } from "@/features/artifacts/types";

// The design lab preserves its geometry with a fixed, non-executing document.
// Production HTML always comes from the native luca-artifact:// preview scheme.
const LAB_HTML_PLACEHOLDER = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#f5f4f1;color:#77736c;font:13px ui-monospace,monospace;letter-spacing:.04em}</style></head><body>Static HTML preview</body></html>`;

export function ArtifactPreview({ artifact }: { artifact: ArtifactRecord }) {
  const current = artifact.versions[0];

  if (artifact.kind === "html") {
    return (
      <iframe
        className="artifact-preview__iframe"
        data-testid="artifact-html-preview"
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={LAB_HTML_PLACEHOLDER}
        title={`Preview of ${artifact.title}`}
      />
    );
  }

  if (artifact.kind === "image" && artifact.imageUrl) {
    return (
      <div className="artifact-preview__image-stage">
        <img alt={artifact.summary} src={artifact.imageUrl} />
        <div className="artifact-preview__image-meta">
          <ImageIcon aria-hidden size={13} />
          original size · 1400 × 900
        </div>
      </div>
    );
  }

  if (artifact.kind === "markdown") {
    return (
      <article className="artifact-preview__document">
        <p className="artifact-preview__eyebrow">Working document</p>
        <h1>{artifact.title.replace(/\.md$/, "")}</h1>
        {current.source.split("\n").map((line, index) => {
          const key = `${index}-${line}`;
          if (line.startsWith("# ")) return null;
          if (line.startsWith("- **")) {
            const match = line.match(/^- \*\*(.+?)\*\* — (.+)$/);
            return match ? (
              <div className="artifact-preview__definition" key={key}>
                <strong>{match[1]}</strong>
                <span>{match[2]}</span>
              </div>
            ) : null;
          }
          if (!line.trim()) return <div className="h-3" key={key} />;
          return <p key={key}>{line}</p>;
        })}
      </article>
    );
  }

  if (artifact.kind === "code") {
    return (
      <div className="artifact-preview__code">
        <div className="artifact-preview__code-header">
          <span>
            <Code2 aria-hidden size={13} />
            {artifact.language ?? "Source"}
          </span>
          <span>{artifact.sizeLabel}</span>
        </div>
        <pre>
          <code>{current.source}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="artifact-preview__unsupported">
      <FileWarning aria-hidden size={28} strokeWidth={1.4} />
      <div>
        <h2>Preview not available</h2>
        <p>
          The file is safe in Library and can still be exported or opened in its
          native app.
        </p>
      </div>
      <button type="button">Export file</button>
    </div>
  );
}
