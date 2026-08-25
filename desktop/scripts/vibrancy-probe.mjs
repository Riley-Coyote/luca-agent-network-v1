#!/usr/bin/env node
/**
 * vibrancy-probe.mjs — measure ink contrast against a real screenshot.
 *
 * Gate 2 of the glass-shell build asks a question no token can answer: once
 * the vibrancy floor has dimmed and blurred whatever the desktop happens to
 * be showing, is the ink still legible on top of it? The floor's rendered
 * color is not the floor's declared color — it is the wallpaper, pushed
 * through a blur and a luminosity blend — so its contrast has to be measured
 * on the pixels that actually shipped, not computed from the palette.
 *
 * Given a PNG, a region of it, and an ink color, this prints the WCAG 2.x
 * contrast ratio of that ink over the region's mean color.
 *
 *   node desktop/scripts/vibrancy-probe.mjs --png shot.png \
 *     --clip 0,0,480,320 --ink '#a6a5a1' --label floor
 *
 * The sampling is ported from design-lab/verify-panes.mjs: the PNG is decoded
 * inside a headless Chromium page via canvas, so there is no image-decoding
 * dependency to install. Playwright is resolved against desktop/package.json,
 * which lets this run from any cwd.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "..", "package.json"));
const { chromium } = require("@playwright/test");

const USAGE =
  "usage: vibrancy-probe.mjs --png <path> --clip x,y,w,h --ink <#hex> [--label <name>]";

/** Print the reason a run cannot produce a number, then leave with code 2. */
function bail(message) {
  console.error(`vibrancy-probe: ${message}\n${USAGE}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const pngPath = arg("png");
const clipArg = arg("clip");
const inkArg = arg("ink");
const label = arg("label") ?? "probe";

if (!pngPath) bail("--png is required");
if (!clipArg) bail("--clip is required");
if (!inkArg) bail("--ink is required");
if (!fs.existsSync(pngPath)) bail(`no such file: ${pngPath}`);

const clipParts = clipArg.split(",").map((n) => Number(n.trim()));
if (clipParts.length !== 4 || clipParts.some((n) => !Number.isFinite(n))) {
  bail(`--clip must be four numbers "x,y,w,h", got "${clipArg}"`);
}
const [clipX, clipY, clipW, clipH] = clipParts;
if (clipW <= 0 || clipH <= 0) bail("--clip width and height must be positive");

const inkHex = inkArg.trim().replace(/^#/, "");
if (!/^[0-9a-fA-F]{6}$/.test(inkHex)) {
  bail(`--ink must be a six-digit hex color, got "${inkArg}"`);
}

/** WCAG relative luminance of an 8-bit sRGB triple. */
const luminance = ([r, g, b]) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const hexToRgb = (h) =>
  [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));

/** WCAG contrast ratio between two sRGB triples, lighter over darker. */
const contrastRatio = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const base64 = fs.readFileSync(pngPath).toString("base64");

  // Decode in-browser and average the clip. Reports an error rather than a
  // mean when the requested region falls outside the image — a silently
  // clamped clip would give a confident number for pixels nobody asked about.
  const sample = await page.evaluate(
    async ({ b64, x, y, w, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      if (x < 0 || y < 0 || x + w > img.width || y + h > img.height) {
        return { error: `image is ${img.width}x${img.height}` };
      }
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(x, y, w, h).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      return { mean: [r / n, g / n, b / n] };
    },
    { b64: base64, x: clipX, y: clipY, w: clipW, h: clipH },
  );

  if (sample.error) {
    bail(`--clip ${clipArg} falls outside the PNG (${sample.error})`);
  }

  // The ratio is computed from the unrounded mean; the printed triple is
  // rounded because rgb() is conventionally integral.
  const ratio = contrastRatio(hexToRgb(inkHex), sample.mean);
  const [r, g, b] = sample.mean.map((v) => Math.round(v));
  console.log(
    `${label}: mean rgb(${r},${g},${b}) · ratio ${ratio.toFixed(2)}:1`,
  );
} finally {
  await browser.close();
}
