import {
  Activity,
  AlertCircle,
  Files,
  GitBranch,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  Terminal,
} from "lucide-react";
import * as React from "react";

import { BrainActivity } from "./BrainActivity";
import {
  BrainConnectionCard,
  type BrainConnectionState,
} from "./BrainConnectionCard";
import { BrainConnectedDetails } from "./BrainConnectedDetails";
import { BrainConsentDialog } from "./BrainConsentDialog";
import { BrainFilesDetails } from "./BrainFilesDetails";
import {
  useConnectedBrainActions,
  useConnectedBrainInventoryQuery,
  useOwnerBrainStateQuery,
} from "./hooks";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import type {
  ConnectedBrainDiscovery,
  ConnectedBrainInventory,
  ConnectedBrainSource,
  ConnectedBrainSourceKind,
} from "@/shared/api/tauriBrain";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { PageHeader } from "@/shared/ui/PageHeader";

type BrainCategory = ConnectedBrainSourceKind | "files";
type ViewMode = "connections" | "activity";

const categoryLabels: Record<BrainCategory, string> = {
  repository: "Repositories",
  codex_history: "Codex",
  claude_history: "Claude Code",
  files: "Files",
};

export function BrainView() {
  const connectedQuery = useConnectedBrainInventoryQuery();
  const ownerQuery = useOwnerBrainStateQuery();
  const residentsQuery = useLucaResidentsQuery();
  const actions = useConnectedBrainActions();
  const [mode, setMode] = React.useState<ViewMode>("connections");
  const [detailCategory, setDetailCategory] =
    React.useState<BrainCategory | null>(null);
  const [consentCategory, setConsentCategory] =
    React.useState<ConnectedBrainSourceKind | null>(null);
  const [connectingCategory, setConnectingCategory] =
    React.useState<ConnectedBrainSourceKind | null>(null);
  const [operationError, setOperationError] = React.useState<string | null>(
    null,
  );

  const inventory = connectedQuery.data;
  const residents = residentsQuery.data?.residents ?? [];
  const mutating =
    actions.addRoot.isPending ||
    actions.connect.isPending ||
    actions.disconnect.isPending ||
    actions.reconfirm.isPending ||
    actions.refresh.isPending ||
    actions.revoke.isPending;

  const run = React.useCallback(async (operation: () => Promise<unknown>) => {
    setOperationError(null);
    try {
      await operation();
    } catch (error) {
      setOperationError(readableConnectionError(error));
    }
  }, []);

  const connectCategory = React.useCallback(
    async (kind: ConnectedBrainSourceKind) => {
      if (!inventory) return;
      const discoveryIds = unconnectedDiscoveries(inventory, kind).map(
        (source) => source.discoveryId,
      );
      if (discoveryIds.length === 0) return;
      setConnectingCategory(kind);
      await run(() =>
        actions.connect.mutateAsync({
          discoveryIds,
          consentAccepted: true,
        }),
      );
      setConnectingCategory(null);
      setConsentCategory(null);
    },
    [actions.connect, inventory, run],
  );

  const requestConnection = React.useCallback(
    (kind: ConnectedBrainSourceKind) => {
      if (!inventory) return;
      const hasConnection = inventory.sources.some(
        (source) => source.status !== "disconnected",
      );
      if (hasConnection) {
        void connectCategory(kind);
      } else {
        setConsentCategory(kind);
      }
    },
    [connectCategory, inventory],
  );

  if (connectedQuery.isLoading || !inventory) {
    if (connectedQuery.isError) {
      return <BrainUnavailable onRetry={() => void connectedQuery.refetch()} />;
    }
    return <BrainLoading />;
  }

  const cards = cardModels(
    inventory,
    ownerQuery.data?.sources.length ?? 0,
    connectingCategory,
  );

  return (
    <div className="h-full overflow-y-auto" data-testid="brain-view">
      <main className="mx-auto w-full max-w-5xl px-5 pb-12 pt-14 sm:px-7 sm:pt-7 lg:px-9">
        <PageHeader
          action={
            <div className="hidden items-center gap-2 rounded-full border border-border/55 bg-card/30 px-3 py-1.5 text-xs text-muted-foreground sm:flex">
              <LockKeyhole className="h-3.5 w-3.5" />
              Private and local
            </div>
          }
          description="Connect the work your residents should know. Luca keeps it current in the background."
          title="Brain"
        />

        <div className="mt-6 flex items-center justify-between gap-3 border-b border-border/45">
          <div aria-label="Brain views" className="flex" role="tablist">
            <ViewTab
              active={mode === "connections"}
              icon={GitBranch}
              label="Connections"
              onClick={() => setMode("connections")}
            />
            <ViewTab
              active={mode === "activity"}
              icon={Activity}
              label="Activity"
              onClick={() => setMode("activity")}
            />
          </div>
          <Button
            aria-label="Scan for Brain sources"
            disabled={connectedQuery.isFetching || mutating}
            onClick={() => void connectedQuery.refetch()}
            size="xs"
            type="button"
            variant="ghost"
          >
            <RefreshCw
              className={cn(connectedQuery.isFetching && "animate-spin")}
            />
            Scan again
          </Button>
        </div>

        {operationError ? (
          <div
            className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{operationError}</p>
          </div>
        ) : null}

        {mode === "connections" ? (
          <section
            aria-label="Brain connections"
            className="mt-6 grid gap-4 md:grid-cols-2"
          >
            {cards.map((card) => {
              const hasDetails = card.connectedCount > 0;
              const hasFound = card.discoveryCount > 0;
              const onAction = () => {
                if (card.kind === "files" || hasDetails) {
                  setDetailCategory(card.kind);
                } else if (hasFound) {
                  requestConnection(card.kind);
                } else if (card.kind === "repository") {
                  void run(() => actions.addRoot.mutateAsync());
                } else {
                  void connectedQuery.refetch();
                }
              };
              return (
                <BrainConnectionCard
                  actionLabel={
                    hasDetails
                      ? "Details"
                      : hasFound
                        ? card.kind === "repository"
                          ? "Connect repositories"
                          : "Connect sessions"
                        : card.kind === "files"
                          ? "Add files"
                          : card.kind === "repository"
                            ? "Add folder"
                            : "Scan again"
                  }
                  description={card.description}
                  detail={card.detail}
                  disabled={mutating}
                  icon={card.icon}
                  key={card.kind}
                  onAction={onAction}
                  onSecondaryAction={
                    card.kind === "repository" && hasDetails
                      ? () => void run(() => actions.addRoot.mutateAsync())
                      : undefined
                  }
                  secondaryActionLabel={
                    card.kind === "repository" && hasDetails
                      ? "Add folder"
                      : undefined
                  }
                  state={card.state}
                  testId={`brain-card-${card.kind}`}
                  title={card.title}
                />
              );
            })}
          </section>
        ) : (
          <div className="mt-6">
            <BrainActivity
              connected={inventory}
              imported={ownerQuery.data}
              residents={residents}
            />
          </div>
        )}
      </main>

      <BrainConsentDialog
        consentCopy={inventory.consentCopy}
        isConnecting={actions.connect.isPending}
        onConfirm={() => {
          if (consentCategory) void connectCategory(consentCategory);
        }}
        onOpenChange={(open) => {
          if (!open && !actions.connect.isPending) setConsentCategory(null);
        }}
        open={consentCategory !== null}
        sourceLabel={
          consentCategory ? categoryLabels[consentCategory] : "source"
        }
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open) setDetailCategory(null);
        }}
        open={detailCategory !== null}
      >
        <DialogContent className="max-w-4xl border border-border/70 bg-background">
          <DialogHeader>
            <DialogTitle>
              {detailCategory ? categoryLabels[detailCategory] : "Details"}
            </DialogTitle>
            <DialogDescription>
              {detailCategory === "files"
                ? "Imported snapshots, resident access, and body-free provenance."
                : "Connection health, resident access, and local refresh details."}
            </DialogDescription>
          </DialogHeader>
          {detailCategory === "files" ? (
            <BrainFilesDetails />
          ) : detailCategory ? (
            <BrainConnectedDetails
              inventory={inventory}
              isMutating={mutating}
              kind={detailCategory}
              onDisconnect={(sourceId) =>
                void run(() => actions.disconnect.mutateAsync({ sourceId }))
              }
              onReconfirm={(sourceId, residentPubkey) =>
                void run(() =>
                  actions.reconfirm.mutateAsync({ sourceId, residentPubkey }),
                )
              }
              onRefresh={(sourceId) =>
                void run(() => actions.refresh.mutateAsync({ sourceId }))
              }
              onRevoke={(sourceId, residentPubkey) =>
                void run(() =>
                  actions.revoke.mutateAsync({ sourceId, residentPubkey }),
                )
              }
              residents={residents}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function cardModels(
  inventory: ConnectedBrainInventory,
  importedFileCount: number,
  connecting: ConnectedBrainSourceKind | null,
) {
  const connectedCard = (
    kind: ConnectedBrainSourceKind,
    title: string,
    description: string,
    icon: typeof GitBranch,
  ) => {
    const sources = inventory.sources.filter(
      (source) =>
        source.sourceKind === kind && source.status !== "disconnected",
    );
    const discoveries = unconnectedDiscoveries(inventory, kind);
    return {
      kind,
      title,
      description,
      icon,
      connectedCount: sources.length,
      discoveryCount: discoveries.length,
      state: connectionState(sources, discoveries, connecting === kind),
      detail:
        sources.length > 0
          ? `${sources.length} connected · ${sources.reduce((total, source) => total + source.entryCount, 0)} searchable sections`
          : discoveries.length > 0
            ? `${discoveries.length} found · ${discoveries.reduce((total, source) => total + source.itemCount, 0)} items available`
            : "No standard location found yet",
    };
  };
  return [
    connectedCard(
      "repository",
      "Repositories",
      "Code, documentation, and working-tree changes from projects on this Mac.",
      GitBranch,
    ),
    connectedCard(
      "codex_history",
      "Codex",
      "Your user-visible Codex conversations, associated with their projects locally.",
      Terminal,
    ),
    connectedCard(
      "claude_history",
      "Claude Code",
      "Your user-visible Claude Code conversations without hidden or tool content.",
      MessageSquare,
    ),
    {
      kind: "files" as const,
      title: "Files",
      description:
        "Markdown and text snapshots you choose explicitly for durable reference.",
      icon: Files,
      connectedCount: importedFileCount,
      discoveryCount: 0,
      state: (importedFileCount > 0
        ? "Current"
        : "Not found") as BrainConnectionState,
      detail:
        importedFileCount > 0
          ? `${importedFileCount} private source${importedFileCount === 1 ? "" : "s"} imported`
          : "Add a file or folder when you need a fixed snapshot",
    },
  ];
}

function unconnectedDiscoveries(
  inventory: ConnectedBrainInventory,
  kind: ConnectedBrainSourceKind,
): ConnectedBrainDiscovery[] {
  const connectedNames = new Set(
    inventory.sources
      .filter(
        (source) =>
          source.sourceKind === kind && source.status !== "disconnected",
      )
      .map((source) => source.displayName),
  );
  return inventory.discoveries.filter(
    (source) =>
      source.sourceKind === kind && !connectedNames.has(source.displayName),
  );
}

function connectionState(
  sources: ConnectedBrainSource[],
  discoveries: ConnectedBrainDiscovery[],
  connecting: boolean,
): BrainConnectionState {
  if (connecting) return "Connecting";
  if (
    sources.some(
      (source) =>
        source.status === "needs_attention" || source.status === "unavailable",
    )
  ) {
    return "Needs attention";
  }
  if (sources.length > 0) {
    return sources.every((source) => source.status === "current")
      ? "Current"
      : "Connected";
  }
  return discoveries.length > 0 ? "Found" : "Not found";
}

function ViewTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Activity;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "relative flex items-center gap-2 px-3 pb-3 pt-1 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {active ? (
        <span className="absolute inset-x-2 bottom-0 h-px bg-foreground" />
      ) : null}
    </button>
  );
}

function BrainLoading() {
  return (
    <div className="flex h-full items-center justify-center" role="status">
      <div className="text-center text-sm text-muted-foreground">
        <LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin" />
        Finding your work
      </div>
    </div>
  );
}

function BrainUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <section className="max-w-md text-center">
        <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          Brain is unavailable
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Luca could not open the private connection inventory. Conversations
          remain available and no source content was exposed.
        </p>
        <Button className="mt-5" onClick={onRetry} size="sm" variant="outline">
          Try again
        </Button>
      </section>
    </div>
  );
}

function readableConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const values: Record<string, string> = {
    "owner-brain-locked": "Unlock Luca, then try this operation again.",
    "owner-brain-stale": "The source changed. Scan again and retry.",
    "owner-brain-unavailable": "The private Brain store is unavailable.",
  };
  return values[message] ?? message.replaceAll("-", " ");
}
