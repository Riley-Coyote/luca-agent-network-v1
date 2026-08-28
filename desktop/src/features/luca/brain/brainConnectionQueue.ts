import type { ConnectedBrainDiscovery } from "@/shared/api/tauriBrain";

export type BrainConnectionQueueStatus =
  | "available"
  | "queued"
  | "connecting"
  | "current"
  | "needs_attention"
  | "failed"
  | "cancelled";

export type BrainConnectionQueueItem = {
  discovery: ConnectedBrainDiscovery;
  status: BrainConnectionQueueStatus;
  error: string | null;
};

export function createBrainConnectionQueueItems(
  discoveries: readonly ConnectedBrainDiscovery[],
): BrainConnectionQueueItem[] {
  return discoveries.map((discovery) => ({
    discovery,
    status: "available",
    error: null,
  }));
}

export function updateBrainConnectionQueueItem(
  items: readonly BrainConnectionQueueItem[],
  discoveryId: string,
  update: Pick<BrainConnectionQueueItem, "status" | "error">,
): BrainConnectionQueueItem[] {
  return items.map((item) =>
    item.discovery.discoveryId === discoveryId ? { ...item, ...update } : item,
  );
}

export function queueSelectedBrainConnections(
  items: readonly BrainConnectionQueueItem[],
  discoveryIds: ReadonlySet<string>,
): BrainConnectionQueueItem[] {
  return items.map((item) =>
    discoveryIds.has(item.discovery.discoveryId) && item.status === "available"
      ? { ...item, status: "queued", error: null }
      : item,
  );
}

export function cancelQueuedBrainConnections(
  items: readonly BrainConnectionQueueItem[],
): BrainConnectionQueueItem[] {
  return items.map((item) =>
    item.status === "queued"
      ? { ...item, status: "cancelled", error: null }
      : item,
  );
}
