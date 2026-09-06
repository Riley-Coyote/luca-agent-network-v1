import { chromium } from "@playwright/test";
const OUT = "/private/tmp/claude-501/-Users-rileycoyote-Documents-Repositories/3c5ae494-c727-4cb9-b15e-f33b57f18251/scratchpad/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://127.0.0.1:8898/identity-marks.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
for (const id of ["lineage", "skeleton", "seal", "constellation", "silhouette", "knot", "rune", "pips", "dots", "pairs", "verdict"]) {
  await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: "start" }), id);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/marks-${id}.png` });
}
console.log("errors:", JSON.stringify(errors));
await browser.close();
