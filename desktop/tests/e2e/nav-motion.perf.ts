import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Nav motion budgets: the agent column's open and close, in a plain room
 * and in a project room, must not start a long task; and the rail's slide
 * is reported by its layout passes.
 *
 * WHY LONGTASKS: a frame the owner feels is the main thread blocked past
 * the 50 ms wall. `longtask` entries are the engine's own signal for that.
 * Each transition is measured over a short window after the click, three
 * times, and the median total must stay under budget.
 *
 * WHY LAYOUT PASSES: the rail's slide is meant to be the compositor's
 * (`transform`), with the content inset changing once. CDP's LayoutCount
 * across one toggle says whether the reading plane relayouts per frame
 * (~30) or once. Reported here; the budget lands with the slide itself.
 *
 * The companion's warm-open budget lives in dm-open.perf.ts.
 *
 * Run it:
 *   pnpm build:e2e && npx playwright test --config=playwright.perf.config.ts \
 *     nav-motion.perf.ts
 */

const RUNS = 3;
const COLUMN_TOGGLE_LONGTASK_BUDGET_MS = 50;
const SETTLE_MS = 500;

type LongtaskWindow = { __LONGTASKS__?: number[] };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

test.beforeEach(async ({ page }) => {
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
      { name: "Bex", pubkey: "b".repeat(64), status: "running" },
    ],
  });
  await page.goto("/?e2e=mock&projectDemo=1");
  await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();
});

async function measureToggles(page: Page, label: string) {
  const atlas = page.getByTestId("agent-rail-atlas");
  const column = page.getByTestId("agent-chats-column");
  const totals: { open: number[]; close: number[] } = { open: [], close: [] };
  const reset = () =>
    page.evaluate(() => {
      (window as unknown as LongtaskWindow).__LONGTASKS__ = [];
    });
  const read = () =>
    page.evaluate(
      () => (window as unknown as LongtaskWindow).__LONGTASKS__ ?? [],
    );
  for (let run = 0; run < RUNS; run += 1) {
    await reset();
    await atlas.click();
    await expect(column).toHaveAttribute("data-panel-open", "true");
    await page.waitForTimeout(SETTLE_MS);
    totals.open.push((await read()).reduce((sum, d) => sum + d, 0));

    await reset();
    await atlas.click();
    await expect(column).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    totals.close.push((await read()).reduce((sum, d) => sum + d, 0));
  }
  const openMedian = median(totals.open);
  const closeMedian = median(totals.close);
  /* eslint-disable no-console */
  console.log(
    `\n=== COLUMN TOGGLE LONGTASKS — ${label} ===\n` +
      `open  per-run total (ms): [${totals.open.map((v) => v.toFixed(1)).join(", ")}] median ${openMedian.toFixed(1)}\n` +
      `close per-run total (ms): [${totals.close.map((v) => v.toFixed(1)).join(", ")}] median ${closeMedian.toFixed(1)}\n` +
      `budget ${COLUMN_TOGGLE_LONGTASK_BUDGET_MS} ms\n`,
  );
  /* eslint-enable no-console */
  expect(openMedian).toBeLessThan(COLUMN_TOGGLE_LONGTASK_BUDGET_MS);
  expect(closeMedian).toBeLessThan(COLUMN_TOGGLE_LONGTASK_BUDGET_MS);
}

test("GATE: the column opens and closes without a long task in a plain room", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.getByTestId("channel-watercooler").click();
  await expect(page.getByTestId("chat-title")).toHaveText("watercooler");
  await measureToggles(page, "plain room (watercooler)");
});

test("GATE: the column opens and closes without a long task in a project room", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.getByTestId("project-row-luca").click();
  await page
    .getByTestId("project-room-navigator")
    .getByRole("button", { name: /deep-history/i })
    .click();
  await expect(page.getByTestId("chat-title")).toHaveText("deep-history");
  await page.waitForTimeout(SETTLE_MS);
  await measureToggles(page, "project room (deep-history, 600 messages)");
});

test("MEASURE: layout passes per rail slide", async ({ page }) => {
  test.setTimeout(90_000);
  await page.getByTestId("project-row-luca").click();
  await page
    .getByTestId("project-room-navigator")
    .getByRole("button", { name: /deep-history/i })
    .click();
  await expect(page.getByTestId("chat-title")).toHaveText("deep-history");
  await page.waitForTimeout(SETTLE_MS);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const layouts = async () => {
    const { metrics } = await client.send("Performance.getMetrics");
    return metrics.find((m) => m.name === "LayoutCount")?.value ?? 0;
  };
  const toggle = page.getByRole("button", { name: "Toggle Sidebar" }).first();
  const results: { collapse: number; expand: number }[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const before = await layouts();
    await toggle.click();
    await page.waitForTimeout(SETTLE_MS);
    const mid = await layouts();
    await toggle.click();
    await page.waitForTimeout(SETTLE_MS);
    const after = await layouts();
    results.push({ collapse: mid - before, expand: after - mid });
  }
  /* eslint-disable no-console */
  console.log(
    `\n=== RAIL SLIDE LAYOUT PASSES ===\n` +
      `collapse per-run: [${results.map((r) => r.collapse).join(", ")}]\n` +
      `expand   per-run: [${results.map((r) => r.expand).join(", ")}]\n` +
      "(one pass per frame ≈ 30 means the inset animates; a handful means it changes once)\n",
  );
  /* eslint-enable no-console */
  expect(results.every((r) => r.collapse > 0 && r.expand > 0)).toBe(true);
});
