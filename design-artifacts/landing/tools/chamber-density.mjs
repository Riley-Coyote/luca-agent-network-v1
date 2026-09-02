// How much dust is on screen, and where — measured, not eyeballed.
//
// NOTE: you cannot read the field canvas with drawImage(). #field has no
// preserveDrawingBuffer, so a 2d copy comes back empty and every tile reads 0.
// This screenshots through Playwright (which composites correctly) and pipes the
// PNG back into the page as an <img> to measure it.
//
//   node chamber-density.mjs [--n=120000] [--stops=0,0.8,1.6,2.4,3.2,4.0,4.7]
import { createRequire } from "node:module";
const require = createRequire("/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/desktop/package.json");
const { chromium } = require("@playwright/test");

const argv = process.argv.slice(2);
const arg = (k, d) => { const m = argv.find(a => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const n = arg("n", "120000");
const stops = arg("stops", "0,0.8,1.6,2.4,3.2,4.0,4.7").split(",").map(Number);
const COLS = 6, ROWS = 4;

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", e => console.log("ERR", String(e).slice(0, 200)));
await page.goto(`file:///Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/design-artifacts/landing/chamber.html?n=${n}`);
await page.waitForFunction(() => window.__aperture, null, { timeout: 20000 });
await page.waitForTimeout(8000);

// Hide every DOM layer (opacity only — layout and the obstacle rects are untouched)
// so the tiles measure dust and nothing else.
const domVisible = async (on) => page.evaluate((on) => {
  for (const el of document.querySelectorAll("body > *")) if (el.id !== "field") el.style.opacity = on ? "" : "0";
}, on);

const walkTo = async (vh) => {
  await page.evaluate(async (vh) => {
    const target = vh * innerHeight, start = scrollY, dist = target - start;
    if (Math.abs(dist) < 1) return;
    const dur = Math.abs(dist) / 900 * 1000, t0 = performance.now();
    await new Promise(res => { const step = t => { const k = Math.min(1, (t - t0) / dur); scrollTo(0, start + dist * k); k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
  }, vh);
  await page.waitForTimeout(2200);
};

// mean luminance per tile, from a PNG round-tripped back into the page
const measure = async (buf, cols, rows) => page.evaluate(async ([b64, cols, rows]) => {
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = "data:image/png;base64," + b64; });
  const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
  const c = cv.getContext("2d"); c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  const tw = cv.width / cols, th = cv.height / rows;
  const tiles = [];
  for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < cols; rx++) {
    let sum = 0, cnt = 0;
    for (let y = Math.floor(ry * th); y < (ry + 1) * th; y += 2)
      for (let x = Math.floor(rx * tw); x < (rx + 1) * tw; x += 2) {
        const i = (y * cv.width + x) * 4;
        sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; cnt++;
      }
    tiles.push(+(sum / cnt).toFixed(2));
  }
  return tiles;
}, [buf.toString("base64"), cols, rows]);

const ramp = " ·:-=+*#%@";
const glyph = (v, lo, hi) => ramp[Math.max(0, Math.min(9, Math.round((v - lo) / (hi - lo) * 9)))];

for (const vh of stops) {
  await walkTo(vh);
  const st = await page.evaluate(() => { const a = window.__aperture; return { beat: a.beat, fps: Math.round(a.fps) }; });
  await domVisible(false);
  const shot = await page.screenshot();
  await domVisible(true);
  const tiles = await measure(shot, COLS, ROWS);
  const lo = Math.min(...tiles), hi = Math.max(...tiles);
  const mean = tiles.reduce((a, b) => a + b, 0) / tiles.length;
  console.log(`\n${vh}vh  beat ${st.beat}  fps ${st.fps}  mean ${mean.toFixed(2)}  range ${lo.toFixed(2)}–${hi.toFixed(2)}`);
  for (let r = 0; r < ROWS; r++) {
    const row = tiles.slice(r * COLS, (r + 1) * COLS);
    console.log("   " + row.map(v => glyph(v, lo, hi)).join(" ") + "   " + row.map(v => v.toFixed(1).padStart(5)).join(" "));
  }
}
await browser.close();
