import {
  AlertCircle,
  Check,
  FileText,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";

import { formatBytes, previewStatusLabel } from "./brainFormat";
import type {
  OwnerBrainImportCommit,
  OwnerBrainPreview,
} from "@/shared/api/tauriBrain";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Progress } from "@/shared/ui/progress";

export type ImportActivity =
  | { state: "idle" }
  | { state: "cancelled"; label: string }
  | { state: "failed"; label: string }
  | { state: "committed"; commit: OwnerBrainImportCommit };

type BrainImportPanelProps = {
  activity: ImportActivity;
  errorMessage: string | null;
  isCommitting: boolean;
  isPicking: boolean;
  onCancel: () => void;
  onCommit: () => void;
  onDismissPreview: () => void;
  onPick: (kind: "file" | "folder") => void;
  preview: OwnerBrainPreview | null;
};

const rowTone = {
  accepted: "text-emerald-400",
  changed: "text-sky-400",
  duplicate: "text-muted-foreground",
  skipped: "text-muted-foreground",
  unsupported: "text-amber-400",
  oversized: "text-amber-400",
  binary: "text-amber-400",
  credential_like: "text-amber-400",
  unsafe_path: "text-destructive",
} as const;

export function BrainImportPanel({
  activity,
  errorMessage,
  isCommitting,
  isPicking,
  onCancel,
  onCommit,
  onDismissPreview,
  onPick,
  preview,
}: BrainImportPanelProps) {
  if (!preview) {
    return (
      <section
        aria-labelledby="brain-import-heading"
        className="rounded-2xl border border-border/60 bg-card/35 p-5"
        data-testid="brain-import-panel"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-border/60 bg-background/45 p-2.5 text-muted-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="text-base font-semibold tracking-tight"
              id="brain-import-heading"
            >
              Add a private source
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Luca previews Markdown and text locally before anything is
              written. Importing a source does not give any resident access.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={isPicking}
                onClick={() => onPick("folder")}
                size="sm"
                type="button"
              >
                {isPicking ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <FolderOpen />
                )}
                Choose folder
              </Button>
              <Button
                disabled={isPicking}
                onClick={() => onPick("file")}
                size="sm"
                type="button"
                variant="outline"
              >
                <FileText />
                Choose file
              </Button>
            </div>
          </div>
        </div>

        {activity.state !== "idle" ? (
          <ImportActivityNotice activity={activity} />
        ) : null}
        {errorMessage ? <ErrorNotice message={errorMessage} /> : null}
      </section>
    );
  }

  const includedRows = preview.rows.filter((row) =>
    ["accepted", "changed", "duplicate"].includes(row.status),
  ).length;

  return (
    <section
      aria-labelledby="brain-preview-heading"
      className="overflow-hidden rounded-2xl border border-border/70 bg-card/45"
      data-testid="brain-preview-panel"
    >
      <div className="flex flex-col gap-4 border-b border-border/60 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Zero-write preview
          </p>
          <h2
            className="mt-1 text-lg font-semibold tracking-tight"
            id="brain-preview-heading"
          >
            {preview.displayName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {includedRows} of {preview.rows.length} entries ·{" "}
            {formatBytes(preview.acceptedBytes)} ready
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            disabled={isCommitting}
            onClick={onDismissPreview}
            size="sm"
            type="button"
            variant="ghost"
          >
            Close
          </Button>
          <Button
            disabled={!preview.canCommit || isCommitting}
            onClick={onCommit}
            size="sm"
            type="button"
          >
            {isCommitting ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Check />
            )}
            {isCommitting ? "Importing" : "Import source"}
          </Button>
        </div>
      </div>

      {isCommitting ? (
        <div className="border-b border-border/60 px-5 py-4" role="status">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span>Encrypting and indexing one atomic revision</span>
            <button
              className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
          <Progress />
        </div>
      ) : null}

      <div className="max-h-72 overflow-y-auto">
        {preview.rows.map((row) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border/40 px-5 py-3 last:border-b-0"
            data-testid={`brain-preview-row-${row.status}`}
            key={`${row.relativePath}-${row.status}`}
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-foreground/90">
                {row.relativePath}
              </p>
              {row.reasonCode ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.reasonCode.replaceAll("-", " ")}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              <p className={cn("text-xs font-medium", rowTone[row.status])}>
                {previewStatusLabel(row.status)}
              </p>
              <p className="mt-0.5 font-mono text-2xs text-muted-foreground">
                {formatBytes(row.byteCount)}
              </p>
            </div>
          </div>
        ))}
      </div>
      {activity.state !== "idle" ? (
        <div className="px-5 pb-5">
          <ImportActivityNotice activity={activity} />
        </div>
      ) : null}
      {errorMessage ? <ErrorNotice message={errorMessage} /> : null}
    </section>
  );
}

function ImportActivityNotice({ activity }: { activity: ImportActivity }) {
  if (activity.state === "idle") return null;
  const failed = activity.state === "failed";
  const cancelled = activity.state === "cancelled";
  return (
    <div
      className={cn(
        "mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
        failed
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : cancelled
            ? "border-border/60 bg-muted/25 text-muted-foreground"
            : "border-emerald-500/25 bg-emerald-500/5 text-emerald-300",
      )}
      data-testid={`brain-import-${activity.state}`}
      role="status"
    >
      {failed ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : cancelled ? (
        <X className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Check className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div>
        <p className="font-medium">
          {activity.state === "committed"
            ? activity.commit.replayed
              ? "Source already current"
              : "Source imported"
            : activity.label}
        </p>
        {activity.state === "committed" ? (
          <p className="mt-0.5 text-xs opacity-80">
            {activity.commit.importedFileCount} files ·{" "}
            {activity.commit.importedChunkCount} indexed sections
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">Import could not finish</p>
        <p className="mt-0.5 text-xs opacity-85">{message}</p>
        <p className="mt-1 flex items-center gap-1 text-xs opacity-75">
          <RotateCcw className="h-3 w-3" /> Choose the source again to retry.
        </p>
      </div>
    </div>
  );
}
