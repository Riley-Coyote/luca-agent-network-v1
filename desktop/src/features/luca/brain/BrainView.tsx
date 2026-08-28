import {
  Activity,
  AlertCircle,
  Files,
  GitBranch,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  Terminal,
} from "lucide-react";
import * as React from "react";

import { startBackgroundTask } from "@/shared/lib/backgroundTasks";
import { BusyMark } from "@/shared/ui/BusyMark";
import { readableConnectedBrainError } from "./brainErrors";
import { BrainActivity } from "./BrainActivity";
import {
  BrainConnectionCard,
  type BrainConnectionState,
} from "./BrainConnectionCard";
import { BrainConnectionDialog } from "./BrainConnectionDialog";
import { BrainConnectedDetails } from "./BrainConnectedDetails";
import { BrainFilesDetails } from "./BrainFilesDetails";
import {
  cancelQueuedBrainConnections,
  createBrainConnectionQueueItems,
  queueSelectedBrainConnections,
  type BrainConnectionQueueItem,
  updateBrainConnectionQueueItem,
} from "./brainConnectionQueue";
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
import { NavigationTransition } from "@/shared/ui/NavigationTransition";

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
  const [connectionCategory, setConnectionCategory] =
    React.useState<ConnectedBrainSourceKind | null>(null);
  const [connectionItems, setConnectionItems] = React.useState<
    BrainConnectionQueueItem[]
  >([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = React.useState(
    () => new Set<string>(),
  );
  const [connectionQueueRunning, setConnectionQueueRunning] =
    React.useState(false);
  const [connectionStopRequested, setConnectionStopRequested] =
    React.useState(false);
  const [busySourceIds, setBusySourceIds] = React.useState(
    () => new Set<string>(),
  );
  const [operationError, setOperationError] = React.useState<string | null>(
    null,
  );
  const queueRunningRef = React.useRef(false);
  const stopRequestedRef = React.useRef(false);
  const activeDiscoveryIdsRef = React.useRef(new Set<string>());
  const busySourceIdsRef = React.useRef(new Set<string>());

  const inventory = connectedQuery.data;
  const residents = residentsQuery.data?.residents ?? [];
  const run = React.useCallback(async (operation: () => Promise<unknown>) => {
    setOperationError(null);
    try {
      await operation();
    } catch (error) {
      setOperationError(readableConnectedBrainError(error));
    }
  }, []);

  const requestConnection = React.useCallback(
    (kind: ConnectedBrainSourceKind) => {
      if (!inventory) return;
      const discoveries = unconnectedDiscoveries(inventory, kind);
      if (discoveries.length === 0) return;
      setDetailCategory(null);
      setConnectionItems(createBrainConnectionQueueItems(discoveries));
      setSelectedConnectionIds(new Set());
      setConnectionStopRequested(false);
      stopRequestedRef.current = false;
      setConnectionCategory(kind);
    },
    [inventory],
  );

  const startConnectionQueue = React.useCallback(
    (discoveryIds: readonly string[], retryFailed = false) => {
      if (
        !connectionCategory ||
        queueRunningRef.current ||
        discoveryIds.length === 0
      ) {
        return;
      }
      const uniqueIds = [...new Set(discoveryIds)].filter(
        (discoveryId) => !activeDiscoveryIdsRef.current.has(discoveryId),
      );
      if (uniqueIds.length === 0) return;

      queueRunningRef.current = true;
      stopRequestedRef.current = false;
      setConnectionQueueRunning(true);
      setConnectionStopRequested(false);
      const selected = new Set(uniqueIds);
      setConnectionItems((current) =>
        retryFailed
          ? current.map((item) =>
              selected.has(item.discovery.discoveryId) &&
              item.status === "failed"
                ? { ...item, status: "queued", error: null }
                : item,
            )
          : queueSelectedBrainConnections(current, selected),
      );

      const queuePromise = (async () => {
        let failureCount = 0;
        for (const discoveryId of uniqueIds) {
          if (stopRequestedRef.current) {
            setConnectionItems(cancelQueuedBrainConnections);
            break;
          }
          if (activeDiscoveryIdsRef.current.has(discoveryId)) continue;
          activeDiscoveryIdsRef.current.add(discoveryId);
          setConnectionItems((current) =>
            updateBrainConnectionQueueItem(current, discoveryId, {
              status: "connecting",
              error: null,
            }),
          );
          try {
            const result = await actions.connect.mutateAsync({
              discoveryIds: [discoveryId],
              consentAccepted: true,
            });
            const source = result.sources[0];
            if (!source) {
              throw new Error("connected source returned no result");
            }
            setConnectionItems((current) =>
              updateBrainConnectionQueueItem(current, discoveryId, {
                status:
                  source.status === "needs_attention" ||
                  source.status === "unavailable"
                    ? "needs_attention"
                    : "current",
                error: null,
              }),
            );
          } catch (error) {
            failureCount += 1;
            setConnectionItems((current) =>
              updateBrainConnectionQueueItem(current, discoveryId, {
                status: "failed",
                error: readableConnectedBrainError(error),
              }),
            );
          } finally {
            activeDiscoveryIdsRef.current.delete(discoveryId);
          }
        }
        if (stopRequestedRef.current) {
          setConnectionItems(cancelQueuedBrainConnections);
        }
        await connectedQuery.refetch();
        return failureCount;
      })().finally(() => {
        queueRunningRef.current = false;
        setConnectionQueueRunning(false);
      });

      startBackgroundTask(
        `Connecting ${categoryLabels[connectionCategory]}`,
        queuePromise.then((failureCount) => {
          if (failureCount > 0) {
            throw new Error(
              `${failureCount} Brain source${failureCount === 1 ? "" : "s"} failed to connect`,
            );
          }
        }),
        readableConnectedBrainError,
      );
      void queuePromise;
    },
    [actions.connect, connectedQuery, connectionCategory],
  );

  const runForSource = React.useCallback(
    async (sourceId: string, operation: () => Promise<unknown>) => {
      if (busySourceIdsRef.current.has(sourceId)) return;
      busySourceIdsRef.current.add(sourceId);
      setBusySourceIds(new Set(busySourceIdsRef.current));
      try {
        await run(operation);
      } finally {
        busySourceIdsRef.current.delete(sourceId);
        setBusySourceIds(new Set(busySourceIdsRef.current));
      }
    },
    [run],
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
    connectionQueueRunning ? connectionCategory : null,
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
            disabled={connectedQuery.isFetching}
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

        <NavigationTransition transitionKey={mode} variant="section">
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
                    disabled={
                      card.kind === "repository" && actions.addRoot.isPending
                    }
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
        </NavigationTransition>
      </main>

      <BrainConnectionDialog
        consentCopy={inventory.consentCopy}
        items={connectionItems}
        onConfirm={() => {
          startConnectionQueue([...selectedConnectionIds]);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setConnectionCategory(null);
            setConnectionItems([]);
            setSelectedConnectionIds(new Set());
          }
        }}
        onRetry={(discoveryId) => startConnectionQueue([discoveryId], true)}
        onSelectAll={(selected) =>
          setSelectedConnectionIds(
            selected
              ? new Set(
                  connectionItems
                    .filter((item) => item.status === "available")
                    .map((item) => item.discovery.discoveryId),
                )
              : new Set(),
          )
        }
        onStop={() => {
          stopRequestedRef.current = true;
          setConnectionStopRequested(true);
        }}
        onToggle={(discoveryId, selected) =>
          setSelectedConnectionIds((current) => {
            const next = new Set(current);
            if (selected) next.add(discoveryId);
            else next.delete(discoveryId);
            return next;
          })
        }
        open={connectionCategory !== null}
        running={connectionQueueRunning}
        selectedIds={selectedConnectionIds}
        sourceLabel={
          connectionCategory ? categoryLabels[connectionCategory] : "sources"
        }
        stopRequested={connectionStopRequested}
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
              busySourceIds={busySourceIds}
              inventory={inventory}
              kind={detailCategory}
              onConnect={() => requestConnection(detailCategory)}
              onDisconnect={(sourceId) =>
                void runForSource(sourceId, () =>
                  actions.disconnect.mutateAsync({ sourceId }),
                )
              }
              onReconfirm={(sourceId, residentPubkey) =>
                void runForSource(sourceId, () =>
                  actions.reconfirm.mutateAsync({ sourceId, residentPubkey }),
                )
              }
              onRefresh={(sourceId) =>
                void runForSource(sourceId, () =>
                  actions.refresh.mutateAsync({ sourceId }),
                )
              }
              onRevoke={(sourceId, residentPubkey) =>
                void runForSource(sourceId, () =>
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
      <div className="flex flex-col items-center text-sm text-muted-foreground">
        <BusyMark className="mb-2.5 opacity-80" size={22} />
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
