// Export every frame of index.html as a PNG at 2x (3200 x 1800).
// usage: node export.mjs [frameId ...]   (needs the page served on :8896)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../desktop/package.json"));
const pw = require("@playwright/test");
const only = process.argv.slice(2);
const webkitPath = "/Users/rileycoyote/Library/Caches/ms-playwright/webkit-2359/pw_run.sh";
const browser = await pw.webkit.launch({ executablePath: webkitPath });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:8896/index.html", { waitUntil: "networkidle" });
await page.addStyleTag({ content: ".workbar{display:none!important} main{padding:0!important;gap:0!important} .frame-wrap{width:1600px!important}" });
await page.evaluate(() => document.fonts.ready);
const frames = await page.$$eval(".frame", (els) => els.map((el) => el.dataset.frame));
for (const id of frames) {
  if (only.length && !only.some((o) => id.startsWith(o))) continue;
  const frame = page.locator(`.frame[data-frame="${id}"]`);
  await frame.scrollIntoViewIfNeeded();
  // the companion looks where the frame asks (data-gaze, frame px), else at the words
  const box = await frame.boundingBox();
  const gaze = await frame.getAttribute("data-gaze");
  if (gaze && box) {
    const [gx, gy] = gaze.split(",").map(Number);
    await page.mouse.move(box.x + gx, box.y + gy);
  } else {
    const h = await frame.locator("h1, h2").first().boundingBox();
    if (h) await page.mouse.move(h.x + h.width * 0.6, h.y + h.height * 0.5);
  }
  await page.waitForTimeout(2600);
  await frame.screenshot({ path: path.join(here, "exports", `${id}.png`) });
  console.log("exported", id);
}
await browser.close();
