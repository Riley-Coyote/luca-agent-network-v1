// Mobile, reduced motion, the chord button, focus states.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/desktop/package.json");
const { chromium } = require("@playwright/test");
const OUT = process.argv[2] || "./shots-extra";
const URL = "file:///Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/design-artifacts/landing/aperture.html";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const errors = [];
const hook = p => { p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error") errors.push(m.text()); }); };
const state = p => p.evaluate(() => { const a = window.__aperture; return { beat: a.beat, s: +a.s.toFixed(2), K: +a.K.toFixed(2), r: +a.r.toFixed(3), spread: +a.spread.toFixed(3), locked: a.locked, pitch: a.pitch, LW: a.LW, LH: a.LH, dpr: a.dpr }; });

// ── mobile
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  hook(page); await page.goto(URL);
  await page.waitForFunction(() => document.fonts.status === "loaded" && window.__aperture, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  for (const [name, s] of [["m-b1", 0], ["m-b3", 2.45], ["m-b5", 3.8], ["m-b8", 9.5]]) {
    await page.evaluate(v => window.scrollTo(0, v * innerHeight), s); await page.waitForFunction(v => Math.abs(window.__aperture.s - v) < 0.02, s, { timeout: 30000 }); await page.waitForTimeout(3000);
    console.log(name, JSON.stringify(await state(page)));
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  // horizontal overflow check
  console.log("mobile scrollWidth", await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
  await page.close();
}
// ── reduced motion
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  hook(page); await page.goto(URL);
  await page.waitForFunction(() => document.fonts.status === "loaded" && window.__aperture, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  console.log("rm-b1", JSON.stringify(await state(page)));
  await page.screenshot({ path: `${OUT}/rm-b1.png` });
  await page.evaluate(() => window.scrollTo(0, 3.8 * innerHeight)); await page.waitForTimeout(1200);
  console.log("rm-b5", JSON.stringify(await state(page)));
  await page.screenshot({ path: `${OUT}/rm-b5.png` });
  await page.close();
}
// ── interactions: chord button, focus ring, hover
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  hook(page); await page.goto(URL);
  await page.waitForFunction(() => document.fonts.status === "loaded" && window.__aperture, null, { timeout: 15000 });
  await page.waitForTimeout(2000);
  const btn = page.locator("#chord");
  await btn.click();
  console.log("chord pressed", await btn.getAttribute("aria-pressed"), await btn.locator("span").nth(1).textContent());
  await page.waitForTimeout(300);
  const row = await page.locator("#aperture .cta-row").boundingBox();
  await page.screenshot({ path: `${OUT}/chord-on.png`, clip: { x: row.x - 10, y: row.y - 10, width: row.width + 20, height: row.height + 20 } });
  await btn.click();
  console.log("chord released", await btn.getAttribute("aria-pressed"));
  // focus on the primary button (keyboard)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.locator(".nav-link").focus();
  await page.keyboard.press("Tab"); console.log("focused", await page.evaluate(()=>document.activeElement.textContent.trim().slice(0,40)));
  await page.waitForTimeout(250);
  const rowNow = await page.locator("#aperture .cta-row").boundingBox();
  await page.screenshot({ path: `${OUT}/focus-primary.png`, clip: { x: rowNow.x - 10, y: rowNow.y - 10, width: rowNow.width + 20, height: rowNow.height + 20 } });
  await page.keyboard.press("Tab"); console.log("focused", await page.evaluate(()=>document.activeElement.textContent.trim().slice(0,40)));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/focus-secondary.png`, clip: { x: rowNow.x - 10, y: rowNow.y - 10, width: rowNow.width + 20, height: rowNow.height + 20 } });
  await page.locator("#aperture .link").hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/hover-secondary.png`, clip: { x: row.x - 10, y: row.y - 10, width: row.width + 20, height: row.height + 20 } });
  // measurements the Critic asked for: type left vs cutout left, measure in ch
  const m = await page.evaluate(() => {
    const ap = document.getElementById("aperture").getBoundingClientRect();
    const h1 = document.querySelector("#aperture h1"); const r = h1.getBoundingClientRect(); const cs = getComputedStyle(h1);
    const range = document.createRange(); range.selectNodeContents(h1.firstChild); const first = range.getBoundingClientRect();
    return { apertureLeft: ap.left, h1Left: r.left, cutLeft: window.__aperture.cut.x, h1FontSize: cs.fontSize, h1Weight: cs.fontWeight, h1LineHeight: cs.lineHeight, firstLineWidth: first.width, firstLineChars: h1.firstChild.textContent.length, viewport: [innerWidth, innerHeight] };
  });
  console.log("measure", JSON.stringify(m));
  await page.close();
}
console.log("errors", JSON.stringify(errors));
await browser.close();
