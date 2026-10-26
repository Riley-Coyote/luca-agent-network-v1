import {
  AppWindow,
  Braces,
  File,
  FileImage,
  FileText,
  ImageIcon,
} from "lucide-react";

import { useArtifactPreview } from "@/features/artifacts/hooks";

/** A piece's picture (an image's own pixels) or its kind's mark, as the
 *  Library marks it. */
export function MadeThumb({
  artifactId,
  className,
  kind,
  title,
  version,
}: {
  artifactId: string;
  className?: string;
  kind: string;
  title: string;
  version: number;
}) {
  const isPicture = kind === "image" || kind === "svg";
  const preview = useArtifactPreview(artifactId, version, isPicture);
  const src = isPicture ? preview.data?.dataUrl : null;
  return (
    <span
      className={["luca-mind-thumb", className].filter(Boolean).join(" ")}
      data-made={src ? "picture" : kind}
    >
      {src ? <img alt={title} src={src} /> : <KindMark kind={kind} />}
    </span>
  );
}

function KindMark({ kind }: { kind: string }) {
  switch (kind) {
    case "html":
    case "app":
      return <AppWindow aria-hidden />;
    case "image":
      return <ImageIcon aria-hidden />;
    case "svg":
      return <FileImage aria-hidden />;
    case "markdown":
    case "text":
      return <FileText aria-hidden />;
    case "code":
      return <Braces aria-hidden />;
    default:
      return <File aria-hidden />;
  }
}
