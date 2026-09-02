// Walk the Chamber the way a person scrolls — smooth, ~900 px/s — and capture at rest.
// An instant scrollTo() reads as a ~38,000 px/s gust and evacuates the field; that is a
// capture artifact, not the design. Use this, not chamber-beats.mjs, to judge the fluid.
//
//   node chamber-walk.mjs [outdir] [--gpu] [--n=200000] [--stops=0,1.5,2.5,3.5,4.7]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/desktop/package.json");
const { chromium } = require("@playwright/test");

const argv = process.argv.slice(2);
const out = (argv.find(a => !a.startsWith("--")) || ".").replace(/\/$/, "");
const arg = (k, d) => { const m = argv.find(a => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const gpu = argv.includes("--gpu");
const n = arg("n", "200000");
const stops = arg("stops", "0,1.5,2.5,3.5,4.7").split(",").map(Number);
mkdirSync(out, { recursive: true });

const swArgs = ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
const gpuArgs = ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy"];
const browser = await chromium.launch({ headless: !gpu, args: gpu ? gpuArgs : swArgs });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`file:///Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/design-artifacts/landing/chamber.html?n=${n}`);
await page.waitForFunction(() => window.__aperture, null, { timeout: 20000 }).catch(() => console.log("no __aperture"));

// Let the fluid develop from cold before touching the scrollbar.
await page.waitForTimeout(9000);

const state = async () => page.evaluate(() => {
  const a = window.__aperture;
  return { beat: a.beat, s: +a.s.toFixed(2), fps: Math.round(a.fps), scrollVel: Math.round(a.scrollVel), particles: a.particles, grid: a.grid };
});

// Smooth-scroll to a target in viewport-heights at a human rate, then settle.
const walkTo = async (vh, pxPerSec = 900) => {
  await page.evaluate(async ([vh, pps]) => {
    const target = vh * innerHeight, start = scrollY, dist = target - start;
    if (Math.abs(dist) < 1) return;
    const dur = Math.abs(dist) / pps * 1000, t0 = performance.now();
    await new Promise(res => {
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        // ease-in-out so we start and stop like a hand, not a teleport
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        scrollTo(0, start + dist * e);
        k < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
  }, [vh, pxPerSec]);
  await page.waitForTimeout(2500); // let the wind die and the field re-home
};

const rows = [];
for (const vh of stops) {
  await walkTo(vh);
  const st = await state();
  rows.push({ vh, ...st });
  const name = `${out}/walk-${String(vh).replace(".", "_")}vh.png`;
  await page.screenshot({ path: name });
  console.log(`${name}  ${JSON.stringify(st)}`);
}

console.log("\nrenderer", await page.evaluate(() => {
  const c = document.createElement("canvas").getContext("webgl2");
  const d = c && c.getExtension("WEBGL_debug_renderer_info");
  return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : "n/a";
}));
console.log("errors", JSON.stringify(errors.slice(0, 5)));
await browser.close();
