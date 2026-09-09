// CPU profile of ONE nav transition against the mock, with the engine's own
// layout / style / script totals for the same window. Not a test — an
// instrument.
//   node --experimental-strip-types --import ./test-loader.mjs scripts/_nav-profile.mjs <scenario>
// scenarios: column-open-room | column-open-project | column-close | navigator-enter
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { installMockBridge } from "../tests/helpers/bridge.ts";

const scenario = process.argv[2] ?? "column-open-room";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT =
  "/private/tmp/claude-501/-Users-rileycoyote-Documents-Repositories/3c5ae494-c727-4cb9-b15e-f33b57f18251/scratchpad/nav-trace";
fs.mkdirSync(OUT, { recursive: true });
const WINDOW_MS = 1000;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

const openDeepHistory = async () => {
  await page.getByTestId("project-row-luca").click();
  await page
    .getByTestId("project-room-navigator")
    .getByRole("button", { name: /deep-history/i })
    .click();
};
const setups = {
  "column-open-room": () => page.getByTestId("channel-watercooler").click(),
  "column-open-project": openDeepHistory,
  "column-close": async () => {
    await page.getByTestId("channel-watercooler").click();
    await page.getByTestId("agent-rail-atlas").click();
  },
  "navigator-enter": () => page.getByTestId("project-row-field-unit").click(),
};
const actions = {
  "column-open-room": () => page.getByTestId("agent-rail-atlas").click(),
  "column-open-project": () => page.getByTestId("agent-rail-atlas").click(),
  "column-close": () => page.getByTestId("agent-rail-atlas").click(),
  "navigator-enter": () => page.getByTestId("project-row-luca").click(),
};
if (!setups[scenario]) throw new Error(`unknown scenario ${scenario}`);
await setups[scenario]();
await page.waitForTimeout(3000);

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
    nodes: get("Nodes"),
  };
};

const m0 = await metrics();
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await actions[scenario]();
await page.waitForTimeout(WINDOW_MS);
const { profile } = await cdp.send("Profiler.stop");
const m1 = await metrics();
fs.writeFileSync(`${OUT}/${scenario}.cpuprofile`, JSON.stringify(profile));

const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const byUrl = new Map();
const dt = profile.timeDeltas;
const samples = profile.samples;
for (let i = 0; i < samples.length; i++) {
  const cf = nodes.get(samples[i]).callFrame;
  const file = (cf.url || "(native)").split("/").pop();
  const key = `${cf.functionName || "(anon)"} @ ${file}:${cf.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
  byUrl.set(file, (byUrl.get(file) ?? 0) + (dt[i] ?? 0));
}
const fmt = (map, n) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, us]) => `${(us / 1000).toFixed(1).padStart(7)}ms  ${k}`)
    .join("\n");
const d = (k) => Math.round((m1[k] - m0[k]) * 10) / 10;
console.log(
  `SCENARIO ${scenario}\n` +
    `engine: layouts ${m1.layouts - m0.layouts} (${d("layoutMs")} ms) · recalcs ${m1.recalcs - m0.recalcs} (${d("recalcMs")} ms) · script ${d("scriptMs")} ms · tasks ${d("taskMs")} ms · DOM nodes ${m0.nodes} → ${m1.nodes}\n` +
    `== top self time by function\n${fmt(self, 14)}\n== by file\n${fmt(byUrl, 8)}`,
);
await browser.close();
