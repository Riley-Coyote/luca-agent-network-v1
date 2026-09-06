// Landing-page masters from the design lab. Not a test — a camera.
//   node scripts/_landing-capture.mjs [outdir] [theme]
import { chromium } from "@playwright/test";
import path from "node:path";

const OUT = process.argv[2] ?? "/private/tmp/claude-501/-Users-rileycoyote-Documents-Repositories/3c5ae494-c727-4cb9-b15e-f33b57f18251/scratchpad/shots";
const THEME = process.argv[3] ?? "void";
const MARKS = process.env.MARKS ? `&marks=${process.env.MARKS}` : "";
const URL = `http://127.0.0.1:8898/shell-lab.html?theme=${THEME}${MARKS}`;

const settle = (page, ms = 1200) =>
  page.evaluate((ceiling) => {
    const done = Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    return Promise.race([done.then(() => undefined), new Promise((r) => setTimeout(r, ceiling))]);
  }, ms);

const browser = await chromium.launch();
const DPR = Number(process.env.DPR ?? 2);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector('[data-sidebar="sidebar"]', { timeout: 30_000 });
await page.waitForTimeout(2000);
await page.evaluate(() => document.fonts.ready);

// Companions: small. (The control is a menu; drive it like a person would.)
const mote = page.getByRole("button", { name: /resident companion/i });
if (await mote.count()) {
  await mote.first().click();
  await page.getByRole("menuitemradio", { name: "Small" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

// Read to the latest message so no "new messages" pill covers the text.
const pill = page.getByRole("button", { name: /new messages/i });
if (await pill.count()) await pill.first().click();
await page.evaluate(() => {
  const tl = document.querySelector('[data-testid="message-timeline"]') ?? document.scrollingElement;
  if (tl) tl.scrollTop = tl.scrollHeight;
});
await page.mouse.move(0, 0);
await page.waitForTimeout(600);
await settle(page);

const TAG = (process.env.MARKS ? `-${process.env.MARKS}` : "") + (DPR !== 2 ? `-${DPR}x` : "");
const resting = path.join(OUT, `hero-${THEME}${TAG}-resting.png`);
await page.screenshot({ path: resting });
console.log(resting);

// Optional: open one agent's column and shoot again.
const AGENT = process.argv[4];
if (AGENT) {
  await page.getByTestId(`agent-rail-${AGENT.toLowerCase()}`).click();
  await page.waitForTimeout(700);
  await settle(page);
  const withAgent = path.join(OUT, `hero-${THEME}${TAG}-agent-${AGENT.toLowerCase()}.png`);
  await page.screenshot({ path: withAgent });
  console.log(withAgent);
}
await browser.close();
