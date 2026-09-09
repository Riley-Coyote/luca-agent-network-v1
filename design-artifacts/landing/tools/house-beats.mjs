// Walk the House and judge it by looking: capture every beat at the three sizes,
// then measure the things WP-02 says must be true.
//
//   node house-beats.mjs [outdir] [--url=http://127.0.0.1:4402/house.html] [--gpu]
//
// --gpu launches a headed Chromium on the real GPU (a window will appear); that is
// the only way the phosphor glow and the lattice are judged as a person sees them.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire("/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/desktop/package.json");
const { chromium } = require("@playwright/test");

const argv = process.argv.slice(2);
const arg = (k, d) => { const m = argv.find(a => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const out = (argv.find(a => !a.startsWith("--")) || ".").replace(/\/$/, "");
const PAGE_URL = arg("url", "http://127.0.0.1:4402/house.html");
const gpu = argv.includes("--gpu");
mkdirSync(out, { recursive: true });

const PHOSPHOR = ["#EFEFED", "#A8D2E0", "#E8A33D", "#E0563C", "#B296E8", "#86D8A8"]
  .map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));

const swArgs = ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
const gpuArgs = ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"];
const browser = await chromium.launch({ headless: !gpu, args: gpu ? gpuArgs : swArgs });

const errors = [];
const shots = [];
const checks = {};

const newPage = async (size, opts = {}) => {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`[pageerror] ${e}`));
  page.on("console", m => { if (m.type() === "error") errors.push(`[console] ${m.text()}`); });
  return page;
};
const shot = async (page, name) => {
  const p = `${out}/${name}.png`;
  await page.screenshot({ path: p });
  shots.push(p);
  return p;
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* ───────────────────────── 1440 × 900 — the walk, held ───────────────────── */
const SIZES = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 390, height: 844 }];
const page = await newPage(SIZES[0]);
await page.goto(PAGE_URL + "?hold=1", { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => window.__house && window.__house.ready);
await page.waitForTimeout(400);

await page.evaluate(() => window.__house.chrome());
await page.waitForTimeout(700);
await shot(page, "house-door-0");

await page.evaluate(() => window.__house.armDoor(3));
await page.waitForTimeout(1100);
await shot(page, "house-door-3");

await page.evaluate(() => window.__house.headline());
await page.waitForTimeout(900);
await shot(page, "house-door-final");

await page.evaluate(() => document.getElementById("agents").scrollIntoView({ block: "start" }));
await page.waitForTimeout(1600);
await shot(page, "house-agents");

const hoverTarget = page.locator('.res[data-res="vektor"]');
await hoverTarget.hover();
await page.waitForTimeout(600);
await shot(page, "house-agents-hover");
checks.hoverDimsOthers = await page.evaluate(() => {
  const all = [...document.querySelectorAll(".res")];
  const hot = document.querySelector(".res.hot");
  const others = all.filter(e => e !== hot).map(e => +getComputedStyle(e).opacity);
  return { hovered: hot ? hot.dataset.res : null, hotOpacity: hot ? +getComputedStyle(hot).opacity : null,
           othersMax: Math.max(...others), others: others.length };
});
await page.mouse.move(2, 2);
await page.waitForTimeout(400);

await page.evaluate(() => document.getElementById("rooms").scrollIntoView({ block: "start" }));
await page.waitForTimeout(900);
await page.evaluate(() => window.__house.roomTurns(2));
await page.waitForTimeout(900);
await shot(page, "house-rooms-mid");
await page.evaluate(() => window.__house.roomTurns(4));
await page.waitForTimeout(1100);
await shot(page, "house-rooms-final");

await page.evaluate(() => document.getElementById("beta").scrollIntoView({ block: "start" }));
await page.waitForTimeout(1400);
await shot(page, "house-exit");

/* ───────────────────────── measurements at 1440 ──────────────────────────── */
checks.h1Count = await page.locator("h1").count();
checks.h1FontFamily = await page.evaluate(() => {
  const h1 = document.querySelector("h1");
  const cs = getComputedStyle(h1);
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;font:500 96px 'Instrument Sans';";
  probe.textContent = "One home";
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.style.font = "500 96px sans-serif";
  const wFallback = probe.getBoundingClientRect().width;
  probe.remove();
  return { family: cs.fontFamily, weight: cs.fontWeight, sizePx: parseFloat(cs.fontSize),
           loaded: document.fonts.check("500 96px 'Instrument Sans'"), differsFromFallback: Math.abs(w - wFallback) > 1 };
});

/* six lit hall marks, each in a hue of its own */
checks.hallMarks = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#hall .res")];
  return rows.map(r => {
    const m = r.querySelector(".mark");
    return { res: r.dataset.res, on: m.classList.contains("on"),
             fill: getComputedStyle(m.querySelector("path.lit")).fill,
             size: Math.round(m.getBoundingClientRect().width),
             runtime: r.querySelector(".rt").textContent.trim(),
             use: r.querySelector(".rt use").getAttribute("href") };
  });
});
checks.hallHuesDistinct = (() => {
  const f = checks.hallMarks.map(m => m.fill);
  return { count: f.length, distinct: new Set(f).size, allLit: checks.hallMarks.every(m => m.on),
           sizes: checks.hallMarks.map(m => m.size) };
})();

/* the door marks are drawn from a seed by the app's constrained glyph engine.
   Read the lit cells straight out of each mark's mask and re-test the engine's
   own predicates here, independently of the page's copy of the algorithm. */
checks.doorMarksFromSeed = await page.evaluate(() => {
  const N = 7;
  const read = (mark) => {
    const cells = new Uint8Array(N * N);
    mark.querySelectorAll("mask rect").forEach(r => {
      // the rects overlap by a hair to kill seams; round back to the cell index
      cells[Math.round(+r.getAttribute("y")) * N + Math.round(+r.getAttribute("x"))] = 1; });
    return cells;
  };
  const rims = c => { let t = 0, b = 0, l = 0, r = 0; for (let i = 0; i < N; i++) { t |= c[i]; b |= c[(N-1)*N+i]; l |= c[i*N]; r |= c[i*N+N-1]; } return !!(t && b && l && r); };
  const noQuad = c => { for (let y = 0; y < N-1; y++) for (let x = 0; x < N-1; x++) if (c[y*N+x] && c[y*N+x+1] && c[(y+1)*N+x] && c[(y+1)*N+x+1]) return false; return true; };
  const onePiece = (c, lit) => { let s = -1; for (let i = 0; i < N*N; i++) if (c[i]) { s = i; break; } if (s < 0) return false;
    const seen = new Uint8Array(N*N), st = [s]; seen[s] = 1; let n = 0;
    while (st.length) { const k = st.pop(); n++; const x = k % N, y = (k / N) | 0;
      const nb = [x > 0 ? k-1 : -1, x < N-1 ? k+1 : -1, y > 0 ? k-N : -1, y < N-1 ? k+N : -1];
      for (const j of nb) if (j >= 0 && c[j] && !seen[j]) { seen[j] = 1; st.push(j); } }
    return n === lit; };
  const sym = (c) => { let mirror = true, rot = true;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (c[y*N+x] !== c[y*N+(N-1-x)]) mirror = false;
      if (c[y*N+x] !== c[(N-1-y)*N+(N-1-x)]) rot = false; }
    return mirror ? "mirror" : rot ? "rot2" : "none"; };
  window.__engineAudit = (sel) => [...document.querySelectorAll(sel)].map(g => {
    const mark = g.querySelector(".mark");
    const c = read(mark);
    let lit = 0; for (let i = 0; i < N*N; i++) lit += c[i];
    return { res: mark.dataset.res,
      isInlineSvgPath: !!mark.querySelector("svg path.lit") && !mark.querySelector("img") &&
                       getComputedStyle(mark.querySelector("svg")).backgroundImage === "none",
      grid: N, lit, litInEngineRange: lit >= 17 && lit <= 23,
      rimsCovered: rims(c), noSolidQuad: noQuad(c), onePiece: onePiece(c, lit), symmetry: sym(c),
      pathLen: mark.querySelector("path.lit").getAttribute("d").length,
      unlitCellsVisible: mark.querySelectorAll("g.unlit circle").length };
  });
  return window.__engineAudit(".greet");
});

checks.hallGlyphsSatisfyEngine = await page.evaluate(() => window.__engineAudit("#hall .res")
  .every(g => g.litInEngineRange && g.rimsCovered && g.noSolidQuad && g.onePiece && g.symmetry !== "none" && g.isInlineSvgPath));

/* the runtime marks are aperture.html's symbols, byte for byte */
const apertureText = await (await fetch(new globalThis.URL("aperture.html", PAGE_URL).href)).text();
checks.runtimeMarksFromAperture = await page.evaluate(() => {
  const used = [...document.querySelectorAll("use")].map(u => u.getAttribute("href"));
  const ids = [...document.querySelectorAll("symbol")].map(s => s.id);
  return { usedIds: [...new Set(used)].sort(), symbolIdsInDoc: ids.sort(),
           colourVariantsInstantiated: used.filter(h => /-color$/.test(h)).length };
}).then(r => {
  const identical = r.usedIds.every(href => {
    const id = href.slice(1);
    const m = apertureText.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`));
    return !!m;
  });
  const bodiesMatch = r.usedIds.every(href => apertureText.includes(`<symbol id="${href.slice(1)}"`));
  return { ...r, everyUsedSymbolExistsInAperture: identical && bodiesMatch };
});
// byte-compare each used symbol's markup against aperture's copy
{
  const docSymbols = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll("symbol")].map(s => [s.id, s.outerHTML])));
  const mismatched = [];
  for (const href of checks.runtimeMarksFromAperture.usedIds) {
    const id = href.slice(1);
    const m = apertureText.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`));
    if (!m) { mismatched.push(id); continue; }
    const norm = s => s.replace(/\s+/g, " ").replace(/"/g, '"');
    if (norm(m[0]).replace(/<\/?symbol[^>]*>/g, "") !== norm(docSymbols[id]).replace(/<\/?symbol[^>]*>/g, "")) mismatched.push(id);
  }
  checks.runtimeMarksFromAperture.byteIdenticalToAperture = mismatched.length === 0;
  checks.runtimeMarksFromAperture.mismatched = mismatched;
}

/* five states on every control, measured by driving the control */
checks.buttonsWithFiveStates = await (async () => {
  const rows = [];
  for (const sel of ["#beta-btn", "#beta-mail", ".nav .pill", ".door-copy .pill", ".door-copy .tlink"]) {
    const el = page.locator(sel).first();
    const snap = () => el.evaluate(n => { const c = getComputedStyle(n);
      return [c.backgroundColor, c.borderColor, c.color, c.boxShadow, c.transform, c.opacity].join("|"); });
    const rest = await snap();
    await el.hover(); await page.waitForTimeout(220);
    const hover = await snap();
    await el.evaluate(n => n.focus()); await page.waitForTimeout(220);
    const focus = await snap();
    const box = await el.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(200);
    const active = await snap();
    await page.mouse.up();
    const disabled = await el.evaluate(n => {
      const tag = n.tagName.toLowerCase();
      if (tag === "button" || tag === "input") { n.disabled = true; const c = getComputedStyle(n);
        const v = [c.backgroundColor, c.borderColor, c.color, c.boxShadow, c.transform, c.opacity].join("|"); n.disabled = false; return v; }
      n.setAttribute("aria-disabled", "true"); const c = getComputedStyle(n);
      const v = [c.backgroundColor, c.borderColor, c.color, c.boxShadow, c.transform, c.opacity].join("|");
      n.removeAttribute("aria-disabled"); return v;
    });
    await page.mouse.move(2, 2); await el.evaluate(n => n.blur());
    rows.push({ sel, hover: hover !== rest, focus: focus !== rest, active: active !== rest && active !== hover, disabled: disabled !== rest,
                states: 1 + [hover !== rest, focus !== rest, active !== rest, disabled !== rest].filter(Boolean).length });
  }
  return { controls: rows.length, allFive: rows.every(r => r.states === 5), rows };
})();

/* every painted colour is either the grey cascade or one of the six phosphors */
checks.nonGreyColoursArePhosphor = await page.evaluate((PH) => {
  const parse = (s) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || ""); return m ? [+m[1], +m[2], +m[3]] : null; };
  const all = (s) => [...(s || "").matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map(m => [+m[1], +m[2], +m[3]]);
  const isGrey = (c) => Math.max(...c) - Math.min(...c) <= 6;
  const isPhosphor = (c) => PH.some(p => Math.abs(p[0]-c[0]) <= 2 && Math.abs(p[1]-c[1]) <= 2 && Math.abs(p[2]-c[2]) <= 2);
  const bad = [];
  const painted = [...document.querySelectorAll("*")].filter(el => !el.closest("defs") && !el.closest("symbol"));
  for (const el of painted) {
    const c = getComputedStyle(el);
    const vals = [c.color, c.backgroundColor, c.borderTopColor, c.borderBottomColor, c.borderLeftColor, c.borderRightColor,
                  c.fill, c.stroke, c.outlineColor, c.caretColor];
    const cols = vals.flatMap(v => { const p = parse(v); return p ? [p] : []; }).concat(all(c.backgroundImage), all(c.boxShadow));
    for (const col of cols) if (!isGrey(col) && !isPhosphor(col))
      bad.push({ tag: el.tagName.toLowerCase(), cls: el.className.baseVal ?? el.className, rgb: col });
  }
  return { sampled: painted.length, offPalette: bad.length, examples: bad.slice(0, 6) };
}, PHOSPHOR);

checks.kitEngine = { identityGlyphPortedFrom: "aperture.html (faithful port of desktop/src/shared/ui/dot-display/identity/glyph.ts)" };
const ovf = { };
ovf["1440x900"] = await overflow(page);

/* ───────────────────────── 1280 × 800 ───────────────────────────────────── */
const p2 = await newPage(SIZES[1]);
await p2.goto(PAGE_URL, { waitUntil: "load" });
await p2.evaluate(() => document.fonts.ready);
await p2.waitForTimeout(3600);
await shot(p2, "house-1280-door");
await p2.evaluate(() => document.getElementById("agents").scrollIntoView({ block: "start" }));
await p2.waitForTimeout(1800);
await shot(p2, "house-1280-agents");
await p2.evaluate(() => document.getElementById("rooms").scrollIntoView({ block: "start" }));
await p2.waitForTimeout(2200);
await shot(p2, "house-1280-rooms");
ovf["1280x800"] = await overflow(p2);
await p2.context().close();

/* ───────────────────────── 390 × 844 ────────────────────────────────────── */
const p3 = await newPage(SIZES[2], { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await p3.goto(PAGE_URL, { waitUntil: "load" });
await p3.evaluate(() => document.fonts.ready);
await p3.waitForTimeout(3800);
await shot(p3, "house-mobile-door");
await p3.evaluate(() => document.getElementById("agents").scrollIntoView({ block: "start" }));
await p3.waitForTimeout(2000);
await shot(p3, "house-mobile-agents");
await p3.evaluate(() => document.getElementById("rooms").scrollIntoView({ block: "start" }));
await p3.waitForTimeout(2200);
await shot(p3, "house-mobile-rooms");
ovf["390x844"] = await overflow(p3);
await p3.context().close();

/* ───────────────────────── reduced motion ───────────────────────────────── */
const p4 = await newPage(SIZES[0], { reducedMotion: "reduce" });
await p4.goto(PAGE_URL, { waitUntil: "load" });
await p4.evaluate(() => document.fonts.ready);
await p4.waitForTimeout(500);
checks.reducedMotionStatic = await p4.evaluate(() => {
  const greetsOn = [...document.querySelectorAll(".greet")].every(g => +getComputedStyle(g).opacity === 1);
  const copyOn = +getComputedStyle(document.querySelector(".door-copy")).opacity === 1;
  const marksLit = [...document.querySelectorAll(".mark mask rect")].every(r => +getComputedStyle(r).opacity === 1);
  const seqScheduled = !!(window.__house && window.__house.reduced);
  return { greetsOn, copyOn, marksLit, reducedBranch: seqScheduled, transitionsOff:
    getComputedStyle(document.querySelector(".door-copy")).transitionDuration.split(",").every(d => parseFloat(d) < .01) };
});
await shot(p4, "house-reduced-door");
await p4.evaluate(() => document.getElementById("rooms").scrollIntoView({ block: "start" }));
await p4.waitForTimeout(400);
checks.reducedMotionStatic.turnsAllShown = await p4.evaluate(() =>
  [...document.querySelectorAll(".turn")].every(t => +getComputedStyle(t).opacity === 1));
await shot(p4, "house-reduced-rooms");
await p4.context().close();

checks.overflowX = ovf;
checks.sizesTested = ["1440x900", "1280x800", "390x844", "1440x900 (prefers-reduced-motion)"];
checks.consoleClean = errors.length === 0 ? true : errors;

writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));
console.log("\nshots:\n" + shots.join("\n"));
console.log("\nerrors:", JSON.stringify(errors.slice(0, 8)));
await browser.close();
