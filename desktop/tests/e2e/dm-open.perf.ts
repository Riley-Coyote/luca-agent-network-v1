import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Warm DM-open harness.
 *
 * Opening a resident's direct thread is the click the agent column exists for,
 * and it used to stall the main thread for about a second even when the thread
 * had been open before: the companion (`<mote-3d>`) created a WebGL context,
 * generated a PMREM environment and compiled its shaders on every mount. The
 * renderers now persist in a document-wide pool, so a warm open should cost a
 * scene graph and nothing else.
 *
 * WHY LONGTASKS: the felt stall is the main thread blocked past the 50 ms
 * frame-budget wall. `longtask` entries are the engine's own signal for that.
 * We report the longest single task and the total across the open window.
 *
 * WHY WARM: the first open pays whatever the idle warm-up has not yet done
 * (headless Chromium renders WebGL in software, so its absolute cost is not
 * portable). Every open after the first must be warm; that is the gate.
 *
 * Run it:
 *   pnpm build:e2e && npx playwright test --config=playwright.perf.config.ts \
 *     dm-open.perf.ts
 */

const RUNS = 3;
const WARM_OPEN_TOTAL_LONGTASK_BUDGET_MS = 100;
const SETTLE_MS = 400;

type LongtaskWindow = { __LONGTASKS__?: number[] };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

test("GATE: a warm open of a resident's thread stays under the long-task budget", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const store = window as unknown as LongtaskWindow;
    store.__LONGTASKS__ = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.__LONGTASKS__?.push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
  });
  await installMockBridge(page, {
    managedAgents: [
      { name: "Atlas", pubkey: "a".repeat(64), status: "running" },
    ],
  });
  await page.goto("/?e2e=mock&projectDemo=1");

  const mote = page.getByTestId("resident-header-mote");
  const column = page.getByTestId("agent-chats-column");
  const columnThread = column
    .locator('[data-testid^="agent-column-chat-"]')
    .first();

  // Cold: the column offers a thread; taking it creates and opens the DM.
  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  await expect(mote).toHaveAttribute("data-ready", "");

  const results: { longest: number; total: number; count: number }[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    // Leave for a room, so the next open is a real route change back.
    await page.getByTestId("channel-watercooler").click();
    await expect(page.getByTestId("chat-title")).toHaveText("watercooler");
    await expect(mote).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);

    await page.evaluate(() => {
      (window as unknown as LongtaskWindow).__LONGTASKS__ = [];
    });
    await columnThread.click();
    await expect(mote).toHaveAttribute("data-ready", "");
    await page.waitForTimeout(SETTLE_MS);

    const tasks = await page.evaluate(
      () => (window as unknown as LongtaskWindow).__LONGTASKS__ ?? [],
    );
    results.push({
      longest: tasks.length ? Math.max(...tasks) : 0,
      total: tasks.reduce((sum, duration) => sum + duration, 0),
      count: tasks.length,
    });
  }

  const totals = results.map((result) => result.total);
  const longests = results.map((result) => result.longest);
  const medianTotal = median(totals);

  /* eslint-disable no-console */
  console.log("\n=== WARM DM-OPEN LONGTASKS (resident thread, companion) ===");
  console.log(
    `per-run longest (ms): [${longests.map((v) => v.toFixed(1)).join(", ")}]`,
  );
  console.log(
    `per-run total (ms):   [${totals.map((v) => v.toFixed(1)).join(", ")}]`,
  );
  console.log(
    `per-run count:        [${results.map((r) => r.count).join(", ")}]`,
  );
  console.log(
    `MEDIAN total: ${medianTotal.toFixed(1)}ms (budget ${WARM_OPEN_TOTAL_LONGTASK_BUDGET_MS}ms)`,
  );
  console.log("============================================================\n");
  /* eslint-enable no-console */

  expect(medianTotal).toBeLessThan(WARM_OPEN_TOTAL_LONGTASK_BUDGET_MS);
});
