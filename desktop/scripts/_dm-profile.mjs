// CPU profile of opening a resident's direct thread from the agent column.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { installMockBridge } from "../tests/helpers/bridge.ts";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT =
  "/private/tmp/claude-501/-Users-rileycoyote-Documents-Repositories/3c5ae494-c727-4cb9-b15e-f33b57f18251/scratchpad/nav-trace";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await installMockBridge(page, {
  managedAgents: [{ name: "Atlas", pubkey: "a".repeat(64), status: "running" }],
});
const cdp = await page.context().newCDPSession(page);
await page.goto(`${BASE}/?e2e=mock&projectDemo=1`, {
  waitUntil: "networkidle",
});
await page.getByTestId("agent-rail-atlas").click();
await page.getByTestId("agent-column-new-chat").click(); // creates + opens once (cold)
await page.waitForTimeout(2500);
await page.getByTestId("channel-watercooler").click(); // leave
await page.waitForTimeout(1500);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page
  .getByTestId("agent-chats-column")
  .locator('[data-testid^="agent-column-chat-"]')
  .first()
  .click(); // warm re-open
await page.waitForTimeout(1600);
const { profile } = await cdp.send("Profiler.stop");
fs.writeFileSync(`${OUT}/dm-open.cpuprofile`, JSON.stringify(profile));
// Aggregate self time per (function, url) and per url.
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
const samples = profile.samples;
for (let i = 0; i < samples.length; i++) {
  const n = nodes.get(samples[i]);
  const cf = n.callFrame;
  const key = `${cf.functionName || "(anon)"} @ ${(cf.url || "").split("/").pop() || "(native)"}:${cf.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
}
const total = dt.reduce((a, b) => a + b, 0) / 1000;
const top = [...self.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 18)
  .map(([k, us]) => `${(us / 1000).toFixed(1)}ms  ${k}`);
// Also aggregate by url only
const byUrl = new Map();
for (let i = 0; i < samples.length; i++) {
  const cf = nodes.get(samples[i]).callFrame;
  const u = (cf.url || "(native)").split("/").pop();
  byUrl.set(u, (byUrl.get(u) ?? 0) + (dt[i] ?? 0));
}
const topUrl = [...byUrl.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([k, us]) => `${(us / 1000).toFixed(1)}ms  ${k}`);
console.log(
  `PROFILE total ${total.toFixed(0)}ms sampled\n== top self time by function\n${top.join("\n")}\n== by file\n${topUrl.join("\n")}`,
);
await browser.close();
