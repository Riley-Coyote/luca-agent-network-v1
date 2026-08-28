import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelQueuedBrainConnections,
  createBrainConnectionQueueItems,
  queueSelectedBrainConnections,
  updateBrainConnectionQueueItem,
} from "./brainConnectionQueue.ts";

const discoveries = ["alpha", "beta", "gamma"].map((name) => ({
  discoveryId: `discovery-${name}`,
  sourceKind: "repository",
  displayName: name,
  itemCount: 1,
  earliestAt: null,
  latestAt: null,
}));

test("queues only the explicit Brain source selection", () => {
  const items = queueSelectedBrainConnections(
    createBrainConnectionQueueItems(discoveries),
    new Set(["discovery-alpha", "discovery-gamma"]),
  );

  assert.deepEqual(
    items.map((item) => item.status),
    ["queued", "available", "queued"],
  );
});

test("a failed source does not rewrite neighboring queue state", () => {
  const queued = queueSelectedBrainConnections(
    createBrainConnectionQueueItems(discoveries),
    new Set(discoveries.map((source) => source.discoveryId)),
  );
  const failed = updateBrainConnectionQueueItem(queued, "discovery-beta", {
    status: "failed",
    error: "fixture failure",
  });

  assert.deepEqual(
    failed.map((item) => [item.status, item.error]),
    [
      ["queued", null],
      ["failed", "fixture failure"],
      ["queued", null],
    ],
  );
});

test("stopping a queue cancels only work that has not started", () => {
  const queued = queueSelectedBrainConnections(
    createBrainConnectionQueueItems(discoveries),
    new Set(discoveries.map((source) => source.discoveryId)),
  );
  const connecting = updateBrainConnectionQueueItem(queued, "discovery-alpha", {
    status: "connecting",
    error: null,
  });
  const cancelled = cancelQueuedBrainConnections(connecting);

  assert.deepEqual(
    cancelled.map((item) => item.status),
    ["connecting", "cancelled", "cancelled"],
  );
});
