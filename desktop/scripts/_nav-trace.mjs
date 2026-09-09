// Nav motion trace. Not a test — an instrument. Measures every rail
// transition against the mock: frame pacing (rAF intervals), layout and
// style-recalc counts and durations (CDP Performance metrics), and long
// tasks. Then a torture pass: rapid interruption of every transition.
//   node scripts/_nav-trace.mjs [outdir]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { installMockBridge } from "../tests/helpers/bridge.ts";

const OUT =
  process.argv[2] ??
  "/private/tmp/claude-501/-Users-rileycoyote-Documents-Repositories/3c5ae494-c727-4cb9-b15e-f33b57f18251/scratchpad/nav-trace";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const WINDOW_MS = 700;

const browser = await chromium.launch({ args: ["--disable-gpu-vsync"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160));
});

await installMockBridge(page, {
  managedAgents: [
    { name: "Atlas", pubkey: "a".repeat(64), status: "running" },
    { name: "Bex", pubkey: "b".repeat(64), status: "running" },
  ],
});
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");

await page.goto(`${BASE}/?e2e=mock&projectDemo=1`, {
  waitUntil: "networkidle",
});
await page.getByTestId("agent-rail-atlas").waitFor();
// A heavy reading plane: the deep-history room, so layout has real cost.
await page.getByTestId("project-row-luca").click();
await page
  .getByTestId("project-room-navigator")
  .getByRole("button", { name: /deep-history/i })
  .click();
await page.waitForTimeout(1200);

const metrics = async () => {
  const { metrics: m } = await cdp.send("Performance.getMetrics");
  const get = (n) => m.find((x) => x.name === n)?.value ?? 0;
  return {
    layouts: get("LayoutCount"),
    recalcs: get("RecalcStyleCount"),
    layoutMs: get("LayoutDuration") * 1000,
    recalcMs: get("RecalcStyleDuration") * 1000,
    scriptMs: get("ScriptDuration") * 1000,
    taskMs: get("TaskDuration") * 1000,
  };
};

const startSampling = () =>
  page.evaluate((windowMs) => {
    window.__navFrames = [];
    window.__navLong = [];
    const t0 = performance.now();
    const tick = (t) => {
      window.__navFrames.push(t);
      if (t - t0 < windowMs) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          window.__navLong.push(Math.round(e.duration));
      });
      po.observe({ type: "longtask", buffered: false });
      window.__navPO = po;
    } catch {}
  }, WINDOW_MS);

const stopSampling = () =>
  page.evaluate(() => {
    window.__navPO?.disconnect();
    const f = window.__navFrames ?? [];
    const gaps = [];
    for (let i = 1; i < f.length; i++) gaps.push(f[i] - f[i - 1]);
    const expected = 1000 / 60;
    return {
      frames: f.length,
      worstGapMs: Math.round(Math.max(0, ...gaps) * 10) / 10,
      droppedFrames: gaps.filter((g) => g > expected * 1.5).length,
      longTasks: window.__navLong ?? [],
    };
  });

const results = [];
async function measure(name, action, settleMs = WINDOW_MS) {
  const m0 = await metrics();
  await startSampling();
  await action();
  await page.waitForTimeout(settleMs);
  const s = await stopSampling();
  const m1 = await metrics();
  const row = {
    transition: name,
    frames: s.frames,
    dropped: s.droppedFrames,
    worstGapMs: s.worstGapMs,
    layouts: m1.layouts - m0.layouts,
    layoutMs: Math.round((m1.layoutMs - m0.layoutMs) * 10) / 10,
    recalcs: m1.recalcs - m0.recalcs,
    recalcMs: Math.round((m1.recalcMs - m0.recalcMs) * 10) / 10,
    scriptMs: Math.round((m1.scriptMs - m0.scriptMs) * 10) / 10,
    longTasks: s.longTasks,
  };
  results.push(row);
  console.log(JSON.stringify(row));
}

const toggle = () =>
  page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
const atlas = () => page.getByTestId("agent-rail-atlas").click();
const bex = () => page.getByTestId("agent-rail-bex").click();

await measure("idle (no action)", async () => {});
await measure("rail collapse", toggle);
await measure("rail expand", toggle);
await measure("column open (Atlas)", atlas);
await measure("agent switch (Atlas → Bex)", bex);
await measure("column close (Bex again)", bex);
await measure("column open, then collapse with column", async () => {
  await atlas();
  await page.waitForTimeout(400);
  await toggle();
});
await measure("expand with column", toggle);
await measure("peek in (collapsed with column)", async () => {
  await toggle();
  await page.waitForTimeout(400);
  await page.getByTestId("sidebar-peek-edge").hover();
});
await measure("peek out", async () => {
  await page.mouse.move(900, 400);
});
await measure("expand (cleanup)", toggle);
await measure("column close (Atlas)", atlas);
// Leave the Luca project first so the next click is a real navigator entrance.
await page.getByTestId("project-row-field-unit").click();
await page.waitForTimeout(800);
await measure("project row → navigator (Field Unit → Luca)", () =>
  page.getByTestId("project-row-luca").click(),
);
await measure(
  "chat select from column (cold: creates + opens the DM)",
  async () => {
    await atlas();
    await page.waitForTimeout(300);
    const row = page
      .getByTestId("agent-chats-column")
      .locator('[data-testid^="agent-column-chat-"]')
      .first();
    if (await row.count()) await row.click();
    else await page.getByTestId("agent-column-new-chat").click();
  },
  1400,
);
await measure(
  "chat select warm (rail row: watercooler)",
  () => page.getByTestId("channel-watercooler").click(),
  1000,
);
await measure(
  "chat select warm (back to the column's DM)",
  () =>
    page
      .getByTestId("agent-chats-column")
      .locator('[data-testid^="agent-column-chat-"]')
      .first()
      .click(),
  1000,
);
await measure(
  "chat select warm (rail row: announcements)",
  () => page.getByTestId("channel-announcements").click(),
  1000,
);

// Torture: rapid interruption.
const torture = {};
async function state() {
  return page.evaluate(() => ({
    railState:
      document
        .querySelector('[data-testid="app-sidebar"]')
        ?.closest("[data-state]")
        ?.getAttribute("data-state") ?? null,
    collapsible:
      document
        .querySelector("[data-collapsible]")
        ?.getAttribute("data-collapsible") ?? null,
    column: document.querySelectorAll('[data-testid="agent-chats-column"]')
      .length,
    railVisible: (() => {
      const a = document.querySelector(
        '[data-testid="app-sidebar-scroll-anchor"]',
      );
      return a ? getComputedStyle(a).display !== "none" : null;
    })(),
  }));
}
for (let i = 0; i < 6; i++) {
  await toggle();
  await page.waitForTimeout(60);
}
await page.waitForTimeout(500);
torture.rapidToggleEven = await state();
for (let i = 0; i < 6; i++) {
  await atlas();
  await page.waitForTimeout(60);
}
await page.waitForTimeout(500);
torture.rapidColumnEven = await state();
await atlas();
await page.waitForTimeout(300);
for (let i = 0; i < 5; i++) {
  await toggle();
  await page.waitForTimeout(80);
}
await page.waitForTimeout(500);
torture.rapidToggleWithColumnOdd = await state();
await toggle();
await page.waitForTimeout(400);
for (let i = 0; i < 6; i++) {
  await page
    .getByTestId("sidebar-peek-edge")
    .hover()
    .catch(() => {});
  await page.waitForTimeout(40);
  await page.mouse.move(900, 400);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(500);
torture.peekFlicker = await state();
await page.screenshot({ path: path.join(OUT, "after-torture.png") });

const report = { results, torture, errors };
fs.writeFileSync(
  path.join(OUT, "nav-trace.json"),
  JSON.stringify(report, null, 2),
);
console.log("TORTURE " + JSON.stringify(torture));
console.log("ERRORS " + JSON.stringify(errors));
await browser.close();
