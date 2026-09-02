// Shoot the Aperture at every beat, plus detail crops. Real Chromium, 1440x900, dpr 2.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/desktop/package.json");
const { chromium } = require("@playwright/test");

const OUT = process.argv[2] || "./shots";
const URL = "file:///Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/design-artifacts/landing/aperture.html";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(URL);
await page.waitForFunction(() => document.fonts.status === "loaded" && window.__aperture, null, { timeout: 15000 });
await page.waitForTimeout(3000);

const stops = [["b1", 0], ["b2", 1.0], ["b3a", 1.9], ["b3b", 2.45], ["b4a", 3.0], ["b4b", 3.45], ["b5", 3.8], ["b5t", 4.7], ["b6", 5.0], ["b7", 7.5], ["b8", 9.5]];
for (const [name, s] of stops) {
  await page.evaluate(v => window.scrollTo(0, v * innerHeight), s);
  await page.waitForFunction(v => Math.abs(window.__aperture.s - v) < 0.02, s, { timeout: 30000 });
  await page.waitForTimeout(3200);
  const st = await page.evaluate(() => { const a = window.__aperture; return { beat: a.beat, s: +a.s.toFixed(2), K: +a.K.toFixed(2), r: +a.r.toFixed(3), spread: +a.spread.toFixed(3), fps: Math.round(a.fps), locked: a.locked, cut: Object.fromEntries(Object.entries(a.cut).map(([k, v]) => [k, Math.round(v)])) }; });
  console.log(name, JSON.stringify(st));
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

// Detail crops at the locked hero.
await page.evaluate(() => window.scrollTo(0, 2.45 * innerHeight));
await page.waitForFunction(() => Math.abs(window.__aperture.s - 2.45) < 0.02, null, { timeout: 30000 });
await page.waitForTimeout(3200);
const cut = await page.evaluate(() => window.__aperture.cut);
await page.screenshot({ path: `${OUT}/crop-edge-topleft.png`, clip: { x: cut.x - 70, y: cut.y - 50, width: 260, height: 170 } });
await page.screenshot({ path: `${OUT}/crop-edge-bottomright.png`, clip: { x: cut.x + cut.w - 150, y: cut.y + cut.h - 110, width: 280, height: 190 } });
const src = await page.evaluate(() => { const r = document.querySelector(".src").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.screenshot({ path: `${OUT}/crop-source.png`, clip: { x: src.x - 90, y: src.y - 90, width: 240, height: 260 } });
// A patch of open field.
await page.screenshot({ path: `${OUT}/crop-field.png`, clip: { x: 980, y: 560, width: 260, height: 200 } });

// The cut edge: window vs field.
await page.evaluate(() => window.scrollTo(0, 4.6 * innerHeight));
await page.waitForFunction(() => Math.abs(window.__aperture.s - 4.6) < 0.02, null, { timeout: 30000 });
await page.waitForTimeout(3200);
const fr = await page.evaluate(() => { const r = document.getElementById("frame").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.screenshot({ path: `${OUT}/crop-frame-edge.png`, clip: { x: fr.x - 120, y: fr.y - 60, width: 320, height: 220 } });
console.log("frame", JSON.stringify(fr));
console.log("errors", JSON.stringify(errors));
await browser.close();
