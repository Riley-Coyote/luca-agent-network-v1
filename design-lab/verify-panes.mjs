#!/usr/bin/env node
/**
 * verify-panes.mjs — per-pass verification for panes-and-widgets.html.
 *
 * Shoots the scene matrix at dpr 2, gates on screenshot distinctness, reports
 * every running animation (and asserts none are ambient under forced
 * reduced-motion), walks keyboard focus, and probes the vibrancy floor's
 * luminance against its own token — the invariant behind the luminosity
 * blend: the wallpaper may move the floor's hue, never its lightness.
 *
 *   node design-lab/verify-panes.mjs --pass 0            # full matrix
 *   node design-lab/verify-panes.mjs --pass 3 --only default,lift
 *
 * Shots land in design-lab/audit/polish-shots/pass-N/ with a manifest.json
 * (hashes + probe numbers). If pass-(N-1) exists, changed/unchanged shots are
 * listed so intentional diffs can be reviewed by eye. Playwright is resolved
 * from the desktop package, so this runs from any cwd.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "..", "desktop", "package.json"));
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const PASS = arg("pass", "0");
const ONLY = arg("only", "").split(",").filter(Boolean);

const PAGE = pathToFileURL(path.join(HERE, "panes-and-widgets.html")).href;
const OUT = path.join(HERE, "audit", "polish-shots", `pass-${PASS}`);
const PREV = path.join(HERE, "audit", "polish-shots", `pass-${Number(PASS) - 1}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const THEMES = ["inverse", "slate", "smoke", "paper"];
/** Scene → { q: URL params, prep: async page steps before the shot } */
const SCENES = {
  default: { q: "" },
  tile: { q: "&tile=1" },
  place: { q: "&place=1" },
  lift: { q: "&lift=1" },
  laws: { q: "&laws=1" },
  "wall-dusk": { q: "&wall=dusk" },
  "wall-quiet": { q: "&wall=quiet" },
  "drawer-closed": {
    q: "",
    prep: async (page) => {
      await page.click("#close-drawer");
      await page.waitForTimeout(450);
    },
  },
};

const luminance = ([r, g, b]) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const hexToRgb = (h) => {
  h = h.trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(650); // entrances + toast timers past their spring
}

/** Mean RGB of a clip region, decoded in-browser so no PNG dependency. */
async function sampleClip(page, probePage, clip) {
  const buf = await page.screenshot({ clip });
  return probePage.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, n = d.length / 4;
    let rr = 0, gg = 0, bb = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
      rr += d[i] * d[i]; gg += d[i + 1] * d[i + 1]; bb += d[i + 2] * d[i + 2];
    }
    const mean = [r / n, g / n, b / n];
    const varSum =
      rr / n - mean[0] ** 2 + (gg / n - mean[1] ** 2) + (bb / n - mean[2] ** 2);
    return { mean, noise: Math.sqrt(Math.max(0, varSum)) };
  }, buf.toString("base64"));
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const anims = document.getAnimations({ subtree: true }).map((a) => ({
      name: a.animationName ?? a.constructor.name,
      infinite:
        a.effect?.getTiming?.().iterations === Infinity ? true : false,
    }));
    return {
      overflowX:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      animations: anims.length,
      ambient: anims.filter((a) => a.infinite).map((a) => a.name),
      floorToken: getComputedStyle(document.documentElement)
        .getPropertyValue("--floor")
        .trim(),
      appRect: (() => {
        const r = document.getElementById("app").getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })(),
    };
  });
}

const manifest = { pass: PASS, when: new Date().toISOString(), shots: {}, checks: [] };
const fail = [];
const note = (ok, label) => {
  manifest.checks.push({ ok, label });
  if (!ok) fail.push(label);
  console.log(`${ok ? "  ok " : "  FAIL"}  ${label}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const probePage = await ctx.newPage();

// ── scene matrix ─────────────────────────────────────────────────────
for (const [scene, def] of Object.entries(SCENES)) {
  if (ONLY.length && !ONLY.includes(scene)) continue;
  for (const theme of THEMES) {
    const variants = scene === "default" ? ["", "&glass=off"] : [""];
    for (const glassOff of variants) {
      const name = `${scene}--${theme}${glassOff ? "--opaque" : ""}`;
      await page.goto(`${PAGE}?theme=${theme}${def.q}${glassOff}`);
      await settle(page);
      if (def.prep) await def.prep(page);
      const shot = await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      const facts = await pageFacts(page);
      manifest.shots[name] = {
        sha: createHash("sha256").update(shot).digest("hex").slice(0, 16),
        animations: facts.animations,
        ambient: facts.ambient,
      };
      if (facts.overflowX > 0) note(false, `${name}: overflow-x ${facts.overflowX}px`);

      // Floor probe: an empty patch of rail, over the vibrancy material.
      if (scene === "default" && !glassOff) {
        const { appRect, floorToken } = facts;
        const clip = {
          x: appRect.x + 150,
          y: appRect.y + appRect.h * 0.62,
          width: 64,
          height: 48,
        };
        const { mean, noise } = await sampleClip(page, probePage, clip);
        const lumSample = luminance(mean);
        const lumToken = luminance(hexToRgb(floorToken));
        const delta = Math.abs(lumSample - lumToken);
        manifest.shots[name].floorProbe = {
          mean: mean.map((v) => Math.round(v)),
          token: floorToken,
          delta: +delta.toFixed(4),
          noise: +noise.toFixed(1),
        };
        if (theme === "smoke") {
          // Smoke's floor is DESIGNED to keep the backdrop's light (HIG:
          // glass "adjusts the luminosity"), so the invariant here is not
          // pinning — it is that the quietest rail ink still clears AA.
          const faint = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--ink-faint").trim());
          const ratio = (() => {
            const L1 = luminance(hexToRgb(faint)), L2 = lumSample;
            const [hi, lo] = [L1, L2].sort((a2, b2) => b2 - a2);
            return (hi + 0.05) / (lo + 0.05);
          })();
          manifest.shots[name].floorProbe.faintRatio = +ratio.toFixed(2);
          note(ratio >= 4.5, `${name}: faint ink holds AA on the smoke (${ratio.toFixed(2)}:1)`);
        } else {
          note(
            delta < 0.02,
            `${name}: floor luminance pinned to token (Δ ${delta.toFixed(4)}${noise > 12 ? ", noisy sample" : ""})`,
          );
        }
      }
    }
  }
}

// ── reduced-motion context: no ambient animation may exist ───────────
{
  const rctx = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const rpage = await rctx.newPage();
  await rpage.goto(`${PAGE}?theme=inverse`);
  await settle(rpage);
  const facts = await rpage.evaluate(() => {
    const anims = document.getAnimations({ subtree: true });
    return anims
      .filter((a) => a.effect?.getTiming?.().iterations === Infinity)
      .map((a) => a.animationName ?? "transition");
  });
  note(
    facts.length === 0,
    `reduced-motion: zero ambient animations (found: ${facts.join(", ") || "none"})`,
  );
  await rctx.close();
}

// ── focus walk ───────────────────────────────────────────────────────
{
  await page.goto(`${PAGE}?theme=inverse`);
  await settle(page);
  for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, "focus-walk--inverse.png") });
  const focused = await page.evaluate(
    () =>
      `${document.activeElement?.tagName}.${document.activeElement?.className}`.slice(0, 60),
  );
  manifest.focusWalk = focused;
  console.log(`  info  focus after 5 tabs: ${focused}`);
}

// ── distinctness gate + diff vs previous pass ────────────────────────
{
  const hashes = Object.entries(manifest.shots).map(([k, v]) => [k, v.sha]);
  const seen = new Map();
  let dupes = 0;
  for (const [k, h] of hashes) {
    if (seen.has(h)) {
      dupes++;
      note(false, `duplicate shot: ${k} == ${seen.get(h)}`);
    } else seen.set(h, k);
  }
  if (!dupes) note(true, `all ${hashes.length} scene shots distinct`);

  const prevManifest = path.join(PREV, "manifest.json");
  if (fs.existsSync(prevManifest)) {
    const prev = JSON.parse(fs.readFileSync(prevManifest, "utf8")).shots ?? {};
    const changed = hashes.filter(([k, h]) => prev[k] && prev[k].sha !== h).map(([k]) => k);
    const unchanged = hashes.filter(([k, h]) => prev[k] && prev[k].sha === h).map(([k]) => k);
    manifest.vsPrevious = { changed, unchanged };
    console.log(
      `  info  vs pass-${Number(PASS) - 1}: ${changed.length} changed, ${unchanged.length} unchanged`,
    );
  }
}

await browser.close();
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\n${fail.length ? "FAILED" : "PASSED"} — ${OUT}`);
if (fail.length) process.exit(1);
