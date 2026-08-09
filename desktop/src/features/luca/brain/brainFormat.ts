import type {
  OwnerBrainPreviewRowStatus,
  OwnerBrainSourceKind,
} from "@/shared/api/tauriBrain";

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function formatSourceKind(kind: OwnerBrainSourceKind): string {
  if (kind === "text_folder") return "Folder";
  if (kind === "markdown_file") return "Markdown";
  return "Text file";
}

export function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function previewStatusLabel(status: OwnerBrainPreviewRowStatus): string {
  const labels: Record<OwnerBrainPreviewRowStatus, string> = {
    accepted: "Ready",
    skipped: "Skipped",
    unsupported: "Unsupported",
    oversized: "Too large",
    binary: "Binary",
    credential_like: "Protected",
    duplicate: "Unchanged",
    changed: "Changed",
    unsafe_path: "Unsafe path",
  };
  return labels[status];
}
