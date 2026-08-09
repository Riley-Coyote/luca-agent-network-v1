import { Check, Clock3, FileSearch, ShieldX, Wrench } from "lucide-react";

import { formatDate } from "./brainFormat";
import type { ResidentRegistryEntry } from "@/features/luca/residents/api";
import type {
  ConnectedBrainInventory,
  OwnerBrainFixtureState,
} from "@/shared/api/tauriBrain";
import { cn } from "@/shared/lib/cn";

type ActivityRow = {
  id: string;
  at: string;
  description: string;
  label: string;
  status: string;
  type: "recall" | "tool";
};

export function BrainActivity({
  connected,
  imported,
  residents,
}: {
  connected: ConnectedBrainInventory;
  imported: OwnerBrainFixtureState | undefined;
  residents: ResidentRegistryEntry[];
}) {
  const sourceNames = new Map([
    ...connected.sources.map(
      (source) => [source.sourceId, source.displayName] as const,
    ),
    ...(imported?.sources.map(
      (source) => [source.sourceId, source.displayName] as const,
    ) ?? []),
  ]);
  const residentNames = new Map(
    residents.map(
      (resident) => [resident.residentPubkey, resident.displayName] as const,
    ),
  );
  const rows: ActivityRow[] = [
    ...connected.repositoryReceipts.map((receipt) => ({
      id: receipt.receiptId,
      at: receipt.createdAt,
      label: receipt.operation.replace("repo_", "").replaceAll("_", " "),
      description: `${residentNames.get(receipt.residentPubkey) ?? "Resident"} · ${sourceNames.get(receipt.sourceId) ?? "Repository"}${receipt.changedPathCount ? ` · ${receipt.changedPathCount} changed paths` : ""}`,
      status: receipt.status,
      type: "tool" as const,
    })),
    ...(imported?.receipts.map((receipt) => ({
      id: receipt.receiptId,
      at: receipt.createdAt,
      label: "Recall",
      description: `${residentNames.get(receipt.residentPubkey) ?? "Resident"} · ${sourceNames.get(receipt.sourceId) ?? "Private source"} · ${receipt.selectedChunkCount} sections`,
      status: receipt.status,
      type: "recall" as const,
    })) ?? []),
  ].sort((left, right) => right.at.localeCompare(left.at));

  if (rows.length === 0) {
    return (
      <section className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/15 px-6 text-center">
        <div className="max-w-sm">
          <Clock3 className="mx-auto h-5 w-5 text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">
            Nothing to review yet
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Body-free recall and repository-work receipts appear here after your
            residents use connected knowledge.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Brain activity"
      className="overflow-hidden rounded-2xl border border-border/55 bg-card/20"
      data-testid="brain-activity-list"
    >
      {rows.map((row) => (
        <ActivityItem key={row.id} row={row} />
      ))}
    </section>
  );
}

function ActivityItem({ row }: { row: ActivityRow }) {
  const complete = row.status === "completed" || row.status === "ready";
  const denied = row.status === "denied" || row.status === "cancelled";
  const Icon = row.type === "tool" ? Wrench : FileSearch;
  return (
    <div className="flex items-start gap-3 border-b border-border/40 px-4 py-3.5 last:border-b-0 sm:px-5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-background/35 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium capitalize">{row.label}</p>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-2xs capitalize",
                complete
                  ? "text-emerald-400"
                  : denied
                    ? "text-muted-foreground"
                    : "text-amber-400",
              )}
            >
              {complete ? (
                <Check className="h-3 w-3" />
              ) : denied ? (
                <ShieldX className="h-3 w-3" />
              ) : (
                <Clock3 className="h-3 w-3" />
              )}
              {row.status}
            </span>
          </div>
          <time className="font-mono text-2xs text-muted-foreground">
            {formatDate(row.at)}
          </time>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {row.description}
        </p>
      </div>
    </div>
  );
}
