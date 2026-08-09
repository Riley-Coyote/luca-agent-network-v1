import { Database, FileText, Folder, History, RefreshCw } from "lucide-react";

import { formatDate, formatSourceKind } from "./brainFormat";
import type {
  OwnerBrainReceipt,
  OwnerBrainSource,
} from "@/shared/api/tauriBrain";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { SubsectionLabel } from "@/shared/ui/PageHeader";

type BrainSourceListProps = {
  onSelect: (sourceId: string) => void;
  selectedSourceId: string | null;
  sources: OwnerBrainSource[];
};

export function BrainSourceList({
  onSelect,
  selectedSourceId,
  sources,
}: BrainSourceListProps) {
  return (
    <section aria-labelledby="brain-sources-heading">
      <SubsectionLabel>Private sources</SubsectionLabel>
      <h2 className="sr-only" id="brain-sources-heading">
        Imported Brain sources
      </h2>
      <div className="mt-2 space-y-1.5">
        {sources.map((source) => {
          const active = source.sourceId === selectedSourceId;
          const Icon = source.sourceKind === "text_folder" ? Folder : FileText;
          return (
            <button
              className={cn(
                "group flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
                active
                  ? "border-border bg-accent/65"
                  : "border-transparent hover:border-border/50 hover:bg-accent/30",
              )}
              data-testid={`brain-source-${source.sourceId}`}
              key={source.sourceId}
              onClick={() => onSelect(source.sourceId)}
              type="button"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {source.displayName}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {source.fileCount} files · {source.chunkCount} sections
                </span>
              </span>
              {source.changedFileCount > 0 ? (
                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-2xs font-medium text-sky-300">
                  {source.changedFileCount} changed
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function BrainSourceSummary({
  onChooseUpdate,
  receipts,
  source,
}: {
  onChooseUpdate: () => void;
  receipts: OwnerBrainReceipt[];
  source: OwnerBrainSource;
}) {
  const sourceReceipts = receipts.filter(
    (receipt) => receipt.sourceId === source.sourceId,
  );
  return (
    <>
      <section className="rounded-2xl border border-border/60 bg-card/30 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="rounded-xl border border-border/60 bg-background/40 p-2.5 text-muted-foreground">
              <Database className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {formatSourceKind(source.sourceKind)}
              </p>
              <h2 className="mt-1 truncate text-lg font-semibold tracking-tight">
                {source.displayName}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {source.fileCount} files · {source.chunkCount} indexed sections
              </p>
            </div>
          </div>
          <Button
            onClick={onChooseUpdate}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw /> Preview update
          </Button>
        </div>
        <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-border/50 bg-border/40 sm:grid-cols-2">
          <Metric label="Indexed" value={formatDate(source.indexedAt)} />
          <Metric
            label="Change review"
            value={
              source.changedFileCount > 0
                ? `${source.changedFileCount} changed files`
                : "Source is current"
            }
          />
        </div>
      </section>

      <section
        aria-labelledby="brain-provenance-heading"
        className="overflow-hidden rounded-2xl border border-border/60 bg-card/30"
        data-testid="brain-provenance-panel"
      >
        <div className="border-b border-border/60 px-5 py-4">
          <SubsectionLabel>Recent provenance</SubsectionLabel>
          <h2
            className="mt-1 text-base font-semibold tracking-tight"
            id="brain-provenance-heading"
          >
            Retrieval receipts
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Body-free evidence of which source was considered and how many
            bounded sections were selected.
          </p>
        </div>
        {sourceReceipts.length === 0 ? (
          <div className="px-5 py-7 text-center text-sm text-muted-foreground">
            No retrieval receipts for this source yet.
          </div>
        ) : (
          <div>
            {sourceReceipts.map((receipt) => (
              <ReceiptRow key={receipt.receiptId} receipt={receipt} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background/45 px-4 py-3">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

function ReceiptRow({ receipt }: { receipt: OwnerBrainReceipt }) {
  const ready = receipt.status === "ready";
  return (
    <div className="flex items-start gap-3 border-b border-border/40 px-5 py-3.5 last:border-b-0">
      <History
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          ready ? "text-emerald-400" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium capitalize">{receipt.status}</p>
          <p className="font-mono text-2xs text-muted-foreground">
            {formatDate(receipt.createdAt)}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {receipt.selectedChunkCount} selected sections
          {receipt.truncated
            ? " · bounded result truncated"
            : " · within bound"}
        </p>
      </div>
    </div>
  );
}
