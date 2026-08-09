import {
  AlertTriangle,
  Check,
  Database,
  RefreshCw,
  ShieldOff,
  Unplug,
} from "lucide-react";
import * as React from "react";

import { formatDate } from "./brainFormat";
import type { ResidentRegistryEntry } from "@/features/luca/residents/api";
import type {
  ConnectedBrainInventory,
  ConnectedBrainSource,
  ConnectedBrainSourceKind,
} from "@/shared/api/tauriBrain";
import { cn } from "@/shared/lib/cn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";

export function BrainConnectedDetails({
  inventory,
  isMutating,
  kind,
  onDisconnect,
  onReconfirm,
  onRefresh,
  onRevoke,
  residents,
}: {
  inventory: ConnectedBrainInventory;
  isMutating: boolean;
  kind: ConnectedBrainSourceKind;
  onDisconnect: (sourceId: string) => void;
  onReconfirm: (sourceId: string, residentPubkey: string) => void;
  onRefresh: (sourceId: string) => void;
  onRevoke: (sourceId: string, residentPubkey: string) => void;
  residents: ResidentRegistryEntry[];
}) {
  const [disconnectTarget, setDisconnectTarget] =
    React.useState<ConnectedBrainSource | null>(null);
  const sources = inventory.sources.filter(
    (source) => source.sourceKind === kind && source.status !== "disconnected",
  );
  const discoveries = inventory.discoveries.filter(
    (discovery) => discovery.sourceKind === kind,
  );

  return (
    <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
      {sources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing in this category is connected yet.
        </div>
      ) : (
        sources.map((source) => (
          <section
            className="overflow-hidden rounded-xl border border-border/60 bg-card/20"
            data-testid={`connected-source-${source.sourceId}`}
            key={source.sourceId}
          >
            <div className="flex flex-col gap-3 border-b border-border/45 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium">
                      {source.displayName}
                    </h3>
                    <SourceStatus status={source.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {source.itemCount} items · {source.entryCount} searchable
                    sections
                    {source.lastRefreshedAt
                      ? ` · refreshed ${formatDate(source.lastRefreshedAt)}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  disabled={isMutating}
                  onClick={() => onRefresh(source.sourceId)}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <RefreshCw /> Refresh
                </Button>
                <Button
                  disabled={isMutating}
                  onClick={() => setDisconnectTarget(source)}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <Unplug /> Disconnect
                </Button>
              </div>
            </div>
            <div>
              {residents.map((resident) => (
                <ResidentAccessRow
                  inventory={inventory}
                  isMutating={isMutating}
                  key={resident.residentPubkey}
                  onReconfirm={() =>
                    onReconfirm(source.sourceId, resident.residentPubkey)
                  }
                  onRevoke={() =>
                    onRevoke(source.sourceId, resident.residentPubkey)
                  }
                  resident={resident}
                  source={source}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {discoveries.length > 0 ? (
        <section className="rounded-xl border border-border/50 bg-card/15 px-4 py-3.5">
          <p className="text-xs font-medium">Found on this device</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {discoveries.length} available source
            {discoveries.length === 1 ? "" : "s"} ·{" "}
            {discoveries
              .slice(0, 4)
              .map((source) => source.displayName)
              .join(", ")}
          </p>
        </section>
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
        open={disconnectTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {disconnectTarget?.displayName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Recall and repository tools stop immediately. Luca removes its
              private index but never deletes or modifies the original source.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (disconnectTarget) onDisconnect(disconnectTarget.sourceId);
                setDisconnectTarget(null);
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ResidentAccessRow({
  inventory,
  isMutating,
  onReconfirm,
  onRevoke,
  resident,
  source,
}: {
  inventory: ConnectedBrainInventory;
  isMutating: boolean;
  onReconfirm: () => void;
  onRevoke: () => void;
  resident: ResidentRegistryEntry;
  source: ConnectedBrainSource;
}) {
  const recall = inventory.recallGrants.find(
    (grant) =>
      grant.sourceId === source.sourceId &&
      grant.residentPubkey === resident.residentPubkey,
  );
  const work = inventory.repositoryGrants.find(
    (grant) =>
      grant.sourceId === source.sourceId &&
      grant.residentPubkey === resident.residentPubkey,
  );
  const state = recall?.state ?? "revoked";
  return (
    <div
      className="flex flex-col gap-3 border-b border-border/35 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`connected-grant-${source.sourceId}-${resident.residentPubkey}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm">{resident.displayName}</p>
          <GrantStatus state={state} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {source.sourceKind === "repository"
            ? `Recall and repository work · ${work?.state === "active" ? "ready" : "review needed"}`
            : "Recall access"}
        </p>
      </div>
      {state === "active" ? (
        <Button
          disabled={isMutating}
          onClick={onRevoke}
          size="xs"
          type="button"
          variant="ghost"
        >
          Exclude
        </Button>
      ) : (
        <Button
          disabled={isMutating}
          onClick={onReconfirm}
          size="xs"
          type="button"
          variant="outline"
        >
          {state === "stale" ? "Reconfirm" : "Restore access"}
        </Button>
      )}
    </div>
  );
}

function SourceStatus({ status }: { status: ConnectedBrainSource["status"] }) {
  const attention = status === "needs_attention" || status === "unavailable";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-2xs",
        attention ? "text-amber-400" : "text-emerald-400",
      )}
    >
      {attention ? (
        <AlertTriangle className="h-3 w-3" />
      ) : (
        <Check className="h-3 w-3" />
      )}
      {attention ? "Needs attention" : "Current"}
    </span>
  );
}

function GrantStatus({ state }: { state: "active" | "revoked" | "stale" }) {
  const Icon =
    state === "active" ? Check : state === "stale" ? AlertTriangle : ShieldOff;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-2xs",
        state === "active"
          ? "text-emerald-400"
          : state === "stale"
            ? "text-amber-400"
            : "text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {state === "active"
        ? "Included"
        : state === "stale"
          ? "Review needed"
          : "Excluded"}
    </span>
  );
}
