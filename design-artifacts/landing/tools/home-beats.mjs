// Capture and check the Home page (WP-01, first half).
//
// Judged by looking, not by reasoning: a real GPU, a real window, screenshots at
// the three sizes the package names. A headless run uses SwiftShader and lies
// about type rendering and canvas, so --gpu (headful) is the default here.
//
//   node home-beats.mjs [outdir] [--url=http://127.0.0.1:4211/home.html] [--headless]
//
// Writes home-hero, home-shell, home-band, home-spread-a, home-spread-b,
// home-door, home-mobile-hero, home-mobile-spread + checks.json.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire("/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/desktop/package.json");
const { chromium } = require("@playwright/test");

const argv = process.argv.slice(2);
const arg = (k, d) => { const m = argv.find(a => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const out = (argv.find(a => !a.startsWith("--")) || ".").replace(/\/$/, "");
const URL = arg("url", "http://127.0.0.1:4211/home.html");
const headless = argv.includes("--headless");
mkdirSync(out, { recursive: true });

const gpuArgs = ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"];
const swArgs = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ headless, args: headless ? swArgs : gpuArgs });

const console_ = [];
const newPage = async (ctx, w, h) => {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  page.on("pageerror", e => console_.push(`pageerror: ${e}`));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console_.push(`${m.type()}: ${m.text()}`); });
  return page;
};

const settle = async (page, ms = 1400) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
};

/* Scroll a section to a comfortable place in the viewport and let reveals land. */
const to = async (page, sel, offset = 24) => {
  await page.evaluate(([s, o]) => {
    const el = document.querySelector(s);
    scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - o, behavior: "instant" });
  }, [sel, offset]);
  await page.waitForTimeout(900);
};

const checks = { sizesTested: [] };

/* ── main pass · 1440×900 ─────────────────────────────────────────────── */
const ctx = await browser.newContext({ deviceScaleFactor: 2, colorScheme: "dark" });
const page = await newPage(ctx, 1440, 900);
await page.goto(URL, { waitUntil: "load" });
await settle(page, 2200);
checks.sizesTested.push("1440x900");

checks.kitScriptsLoaded = await page.evaluate(() => {
  const ok = !!(window.DotDisplay && DotDisplay.scenes && DotDisplay.scenes.marquee);
  const cv = document.querySelector('canvas[data-scene="marquee"]');
  let lit = 0;
  if (cv) {
    const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height;
    const g = c.getContext("2d"); g.drawImage(cv, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 60) lit++;
  }
  return { engine: ok, mounted: !!(window.__home && window.__home.engine), litPixels: lit };
});

checks.h1Count = await page.locator("h1").count();
const h1 = await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector("h1"));
  return { family: s.fontFamily, size: parseFloat(s.fontSize), weight: s.fontWeight };
});
checks.h1FontSizePx = h1.size;
checks.h1FontFamily = h1.family;

checks.fontsLoaded = await page.evaluate(async () => {
  await document.fonts.ready;
  const want = ["Instrument Sans", "Fragment Mono"];
  const have = {};
  want.forEach(f => { have[f] = document.fonts.check(`500 20px "${f}"`); });
  // A real webfont measures differently from the fallback stack.
  const m = (fam) => {
    const s = document.createElement("span");
    s.textContent = "Every agent you work with";
    s.style.cssText = `position:absolute;visibility:hidden;font-size:64px;font-family:${fam}`;
    document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w;
  };
  have.differsFromFallback = Math.abs(m('"Instrument Sans"') - m("system-ui")) > 1;
  return have;
});

checks.contrastT1 = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const hex = (v) => v.trim();
  const lum = (h) => {
    const n = h.replace("#", "");
    const ch = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const a = lum(hex(cs.getPropertyValue("--t1"))), b = lum(hex(cs.getPropertyValue("--bg")));
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return { ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2), ok: (hi + 0.05) / (lo + 0.05) >= 7 };
});

/* Five states: every interactive element must carry rules for resting, hover,
   focus, active and disabled — from the stylesheet, not the browser default. */
checks.buttonsWithFiveStates = await page.evaluate(() => {
  const rules = [];
  for (const sh of document.styleSheets) {
    let rs; try { rs = sh.cssRules; } catch { continue; }
    for (const r of rs) if (r.selectorText) rules.push(r.selectorText);
  }
  const has = (cls, pseudo) => rules.some(s => s.split(",").some(p =>
    p.includes("." + cls) && (pseudo ? p.includes(pseudo) : !/[:\[]/.test(p.trim().replace("." + cls, "")))));
  const els = [...document.querySelectorAll("button, a[href], input")];
  const missing = [];
  els.forEach(el => {
    const cls = [...el.classList].find(c => ["btn", "tlink", "navlink", "tick", "field"].includes(c));
    if (!cls) { missing.push(`${el.tagName.toLowerCase()} (no control class)`); return; }
    const gaps = [];
    if (!has(cls, null)) gaps.push("resting");
    if (!has(cls, ":hover")) gaps.push("hover");
    if (!has(cls, ":focus-visible")) gaps.push("focus");
    if (!has(cls, ":active")) gaps.push("active");
    if (!(has(cls, ":disabled") || has(cls, "aria-disabled"))) gaps.push("disabled");
    if (gaps.length) missing.push(`.${cls}: ${gaps.join(",")}`);
  });
  return { total: els.length, ok: els.length - missing.length, missing };
});

/* At most two uppercase mono labels in any one viewport. */
const monoScan = async (p) => p.evaluate(() => {
  let max = 0, worst = [];
  const els = [...document.querySelectorAll("*")].filter(el => {
    const s = getComputedStyle(el);
    if (!/Fragment Mono/.test(s.fontFamily)) return false;
    if (s.textTransform !== "uppercase" && el.textContent.trim() !== el.textContent.trim().toUpperCase()) return false;
    if (s.textTransform !== "uppercase") return false;
    if (!el.textContent.trim()) return false;
    return !el.querySelector("*");
  });
  const H = innerHeight, total = document.documentElement.scrollHeight;
  for (let y = 0; y <= total - H + H; y += Math.round(H / 3)) {
    scrollTo({ top: Math.min(y, total - H), behavior: "instant" });
    const inView = els.filter(el => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < H && r.width > 0;
    });
    if (inView.length > max) { max = inView.length; worst = inView.map(e => e.textContent.trim()); }
  }
  scrollTo({ top: 0, behavior: "instant" });
  return { max, worst };
});
checks.maxMonoLabelsInView = await monoScan(page);

/* The grant matrix rewrites its own footer line. */
checks.matrixToggleWorks = await page.evaluate(async () => {
  const el = document.querySelector("[data-knows]");
  const before = el.textContent;
  const ticks = [...document.querySelectorAll(".grant .cell:nth-child(2) .tick")];
  ticks.forEach(t => { if (t.getAttribute("aria-pressed") === "true") t.click(); });
  const none = el.textContent;
  ticks[0].click();
  const one = el.textContent;
  ticks.forEach((t, i) => { if ((i === 0 || i === 1 || i === 2) && t.getAttribute("aria-pressed") !== "true") t.click(); });
  const back = el.textContent;
  return { changed: before !== none && none !== one && one !== back, none, one, restored: back };
});
await page.reload({ waitUntil: "load" }); await settle(page, 1800);

/* The replay reaches Vektor's turn. */
await to(page, "#rooms", 40);
checks.replayReachesVektor = await page.evaluate(async () => {
  const want = "Show the room itself. The interface is the proof that the network is real.";
  const turn = () => [...document.querySelectorAll(".turn")][2];
  const t0 = performance.now();
  while (performance.now() - t0 < 26000) {
    const el = turn();
    if (el && el.querySelector(".turn-t span").textContent.trim() === want
        && el.querySelector(".sign").classList.contains("is-on")) {
      return { reached: true, running: window.__home.running, afterMs: Math.round(performance.now() - t0) };
    }
    await new Promise(r => setTimeout(r, 120));
  }
  return { reached: false, running: window.__home.running };
});

/* ── screenshots · 1440×900 ───────────────────────────────────────────── */
await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/home-hero.png` });

await to(page, "#rooms", 56);
// Hold the replay on a chosen beat: Luca and Anima signed, Vektor mid-sentence.
await page.evaluate(() => window.__home.seek(8000));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/home-shell.png` });

await to(page, ".band", 240);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/home-band.png` });

await to(page, "#agents", 90);
await page.waitForTimeout(1100);
await page.screenshot({ path: `${out}/home-spread-a.png` });

await to(page, "#brain", 90);
await page.waitForTimeout(1100);
await page.screenshot({ path: `${out}/home-spread-b.png` });

await to(page, "#beta", 40);
await page.waitForTimeout(1100);
await page.screenshot({ path: `${out}/home-door.png` });

checks.overflowX = {};
checks.overflowX["1440x900"] = await page.evaluate(() =>
  ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
     ok: document.documentElement.scrollWidth <= document.documentElement.clientWidth }));

/* ── 1280×800 ─────────────────────────────────────────────────────────── */
const p2 = await newPage(ctx, 1280, 800);
await p2.goto(URL, { waitUntil: "load" }); await settle(p2, 2000);
checks.sizesTested.push("1280x800");
checks.overflowX["1280x800"] = await p2.evaluate(() =>
  ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
     ok: document.documentElement.scrollWidth <= document.documentElement.clientWidth }));
const mono1280 = await monoScan(p2);
if (mono1280.max > checks.maxMonoLabelsInView.max) checks.maxMonoLabelsInView = mono1280;
await p2.close();

/* ── 390×844 ──────────────────────────────────────────────────────────── */
const mctx = await browser.newContext({ deviceScaleFactor: 3, colorScheme: "dark", isMobile: false });
const m = await newPage(mctx, 390, 844);
await m.goto(URL, { waitUntil: "load" }); await settle(m, 2200);
checks.sizesTested.push("390x844");
await m.screenshot({ path: `${out}/home-mobile-hero.png` });
await to(m, "#agents", 30);
await m.waitForTimeout(1100);
await m.screenshot({ path: `${out}/home-mobile-spread.png` });
checks.overflowX["390x844"] = await m.evaluate(() =>
  ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
     ok: document.documentElement.scrollWidth <= document.documentElement.clientWidth }));
const mono390 = await monoScan(m);
if (mono390.max > checks.maxMonoLabelsInView.max) checks.maxMonoLabelsInView = mono390;
await mctx.close();

/* ── reduced motion ───────────────────────────────────────────────────── */
const rctx = await browser.newContext({ reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "dark" });
const r = await newPage(rctx, 1440, 900);
await r.goto(URL, { waitUntil: "load" }); await settle(r, 1600);
await to(r, "#rooms", 40);
await r.waitForTimeout(2600);
checks.reducedMotionStatic = await r.evaluate(() => {
  const t = [...document.querySelectorAll(".turn")];
  const before = t.map(x => x.querySelector(".turn-t span").textContent);
  return new Promise(res => setTimeout(() => {
    const after = t.map(x => x.querySelector(".turn-t span").textContent);
    res({
      running: window.__home.running,
      reducedSeen: window.__home.reduced,
      allTurnsFinal: t.every(x => x.classList.contains("is-on") && x.querySelector(".sign").classList.contains("is-on")),
      static: JSON.stringify(before) === JSON.stringify(after),
      revealsRested: [...document.querySelectorAll("[data-rv]")].every(x => getComputedStyle(x).opacity === "1")
    });
  }, 2000));
});
await rctx.close();

checks.consoleClean = { errors: console_.filter(l => l.startsWith("pageerror") || l.startsWith("error")), all: console_ };
writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));
if (!headless) await page.waitForTimeout(400);
await browser.close();
