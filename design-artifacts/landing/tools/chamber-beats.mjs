import { createRequire } from "node:module";
const require = createRequire("/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/desktop/package.json");
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors=[]; page.on("pageerror",e=>errors.push(String(e))); page.on("console",m=>{ if(m.type()==="error") errors.push(m.text()); });
await page.goto("file:///Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/design-artifacts/landing/chamber.html?n=200000");
try { await page.waitForFunction(() => window.__aperture, null, { timeout: 20000 }); } catch(e){ console.log("no __aperture"); }
await page.waitForTimeout(9000);
const st = await page.evaluate(() => { const a=window.__aperture; return a? {ticks:a.ticks, particles:a.particles, grid:a.grid, fps:Math.round(a.fps), s:a.s} : null; });
console.log("state", JSON.stringify(st)); console.log("errors", JSON.stringify(errors.slice(0,5)));
await page.screenshot({ path: "./chamber-1.png" });
await page.evaluate(() => window.scrollTo(0, 2.0*innerHeight)); await page.waitForTimeout(3000);
await page.screenshot({ path: "./chamber-2.png" });
await page.evaluate(() => window.scrollTo(0, 4.7*innerHeight)); await page.waitForTimeout(3000);
await page.screenshot({ path: "./chamber-3.png" });
console.log("errors2", JSON.stringify(errors.slice(0,5)));
await browser.close();
