// Synthetic only. Run from desktop with the production test-loader and Node's
// --experimental-strip-types. This measures projection, not chat latency or FPS.
import { performance } from "node:perf_hooks";
import * as rail from "../src/features/sidebar/lib/railWork.ts";

const rows = Array.from({ length: 512 }, (_, index) => ({
  kind: "task",
  id: `synthetic-${index}`,
  conversationId: "fixture",
  at: 2000 - index,
  live: index === 0,
  residentPubkey: "a".repeat(64),
  runtimeFamily: "claude_code",
  summary: "Synthetic writing task",
  state: index === 0 ? "active" : "succeeded",
  deliveryState: index === 0 ? "awaiting_result" : "published",
  word: index === 0 ? "working" : null,
}));
const native = new Map(rows.map((r) => [r.id, { ...r, taskId: r.id }]));
const none = new Set();
function batch() {
  const start = performance.now();
  let displayed = 0;
  for (let index = 0; index < 1000; index++) {
    const family = rail.appTaskRows(rows).get("claude") ?? [];
    displayed += (
      rail.activeRuntimeRailRows?.(family, native, none, none) ?? family
    ).length;
  }
  if (displayed === 0)
    throw new Error("Fixture did not exercise the Claude rail");
  return {
    rowsPerProjection: displayed / 1000,
    msPerProjection: (performance.now() - start) / 1000,
  };
}
batch();
console.log(JSON.stringify(Array.from({ length: 5 }, batch)));
