import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-39, agent fingerprints (docs/luca/BETA14_RELEASE.md): each agent's
 * print grown once from its seed, drawn in the rail's own ink at 18 and in
 * black lacquer at 64 and 128, alive at rest, quicker while it works, exactly
 * still under Reduce Motion, and always itself again. The harness is
 * `?lab=fingerprint` (src/testing/fingerprintLab.tsx). Screenshots land in
 * WP39_SHOTS, measurements in WP39_SHOTS/measures; WP39_STUDY names the
 * study's built page, to shoot it beside ours.
 */

const SHOTS = process.env.WP39_SHOTS ?? "test-results/shell-fingerprint";
const STUDY = process.env.WP39_STUDY;
const NAMES = ["Luca", "Vektor", "Ziggy", "Mara", "Sol"] as const;

type Mode = "dark" | "light";
type Snapshot = {
  floatTargets: boolean;
  still: boolean;
  frames: number;
  growth: {
    key: string;
    kind: string;
    path: "gpu" | "cpu" | "cache";
    startedAt: number;
    ms: number;
    workMs: number;
  }[];
  prints: { key: string; kind: string; state: string }[];
  marks: {
    id: number;
    key: string;
    variant: string;
    visible: boolean;
    ready: boolean;
    renders: number;
  }[];
};
type Diff = { changed: number; total: number; meanAbs: number };

const errors: string[] = [];

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1280, height: 860 },
});
test.describe.configure({ timeout: 150_000 });

/** Pixel tools in the page: grab every print's canvas, compare two grabs. */
function installProbes() {
  type Grab = Record<string, { w: number; h: number; data: Uint8ClampedArray }>;
  const w = window as unknown as {
    __fpGrabs: Record<string, Grab>;
    __fpGrab: (name: string) => number;
    __fpDiff: (a: string, b: string) => Record<string, unknown>;
    __fpTone: (name: string, id: string) => unknown;
    __fpStrip: (names: string[], id: string, scale: number) => string;
  };
  w.__fpGrabs = {};
  w.__fpGrab = (name) => {
    const out: Grab = {};
    for (const c of document.querySelectorAll<HTMLCanvasElement>(
      "canvas[data-agent-fingerprint]",
    )) {
      const ctx = c.getContext("2d");
      if (!ctx || !c.dataset.fingerprintMark) continue;
      out[c.dataset.fingerprintMark] = {
        w: c.width,
        h: c.height,
        data: ctx.getImageData(0, 0, c.width, c.height).data.slice(),
      };
    }
    w.__fpGrabs[name] = out;
    return Object.keys(out).length;
  };
  w.__fpDiff = (a, b) => {
    const A = w.__fpGrabs[a];
    const B = w.__fpGrabs[b];
    const out: Record<string, unknown> = {};
    for (const id of Object.keys(A)) {
      const x = A[id].data;
      const y = B[id]?.data;
      if (!y || y.length !== x.length) {
        out[id] = null;
        continue;
      }
      let changed = 0;
      let abs = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d =
          Math.abs(x[i] - y[i]) +
          Math.abs(x[i + 1] - y[i + 1]) +
          Math.abs(x[i + 2] - y[i + 2]) +
          Math.abs(x[i + 3] - y[i + 3]);
        if (d) changed++;
        abs += d;
      }
      out[id] = { changed, total: x.length / 4, meanAbs: abs / (x.length / 4) };
    }
    return out;
  };
  /** Coverage, brightness and the bright pixels' centroid of one grab. */
  w.__fpTone = (name, id) => {
    const g = w.__fpGrabs[name][id];
    let cover = 0;
    let lum = 0;
    let bright = 0;
    let bx = 0;
    let by = 0;
    for (let i = 0; i < g.data.length; i += 4) {
      const a = g.data[i + 3];
      if (!a) continue;
      cover++;
      const l =
        (0.2126 * g.data[i] + 0.7152 * g.data[i + 1] + 0.0722 * g.data[i + 2]) /
        255;
      lum += l;
      if (l > 0.5) {
        const p = i / 4;
        bright++;
        bx += p % g.w;
        by += Math.floor(p / g.w);
      }
    }
    return {
      cover: cover / (g.data.length / 4),
      meanLum: cover ? lum / cover : 0,
      bright,
      centroid: bright ? [bx / bright / g.w, by / bright / g.h] : null,
    };
  };
  w.__fpStrip = (names, id, scale) => {
    const first = w.__fpGrabs[names[0]][id];
    const gap = 8;
    const strip = document.createElement("canvas");
    strip.width = (first.w * scale + gap) * names.length + gap;
    strip.height = first.h * scale + 2 * gap;
    const ctx = strip.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#0c0c0d";
    ctx.fillRect(0, 0, strip.width, strip.height);
    ctx.imageSmoothingEnabled = false;
    names.forEach((name, i) => {
      const g = w.__fpGrabs[name][id];
      const one = document.createElement("canvas");
      one.width = g.w;
      one.height = g.h;
      one.getContext("2d")?.putImageData(new ImageData(g.data, g.w, g.h), 0, 0);
      ctx.drawImage(
        one,
        gap + i * (g.w * scale + gap),
        gap,
        g.w * scale,
        g.h * scale,
      );
    });
    return strip.toDataURL("image/png");
  };
}

async function boot(
  page: Page,
  {
    mode = "dark",
    query = "",
    reduce = false,
  }: { mode?: Mode; query?: string; reduce?: boolean } = {},
) {
  page.on("pageerror", (error) => errors.push(`PAGE ERROR ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  await page.emulateMedia({
    reducedMotion: reduce ? "reduce" : "no-preference",
  });
  await installMockBridge(page);
  await page.addInitScript(
    ({ key, light }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = true;
      localStorage.setItem(key, JSON.stringify(overrides));
      localStorage.setItem("buzz-theme", light ? "paper" : "default");
      localStorage.setItem("buzz-follow-system", "false");
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light: mode === "light" },
  );
  await page.addInitScript(installProbes);
  await expect(async () => {
    await page.goto(`/?lab=fingerprint${query}`);
    await expect(page.getByTestId("fingerprint-lab")).toBeVisible({
      timeout: 15_000,
    });
  }).toPass({ timeout: 60_000 });
  await waitReady(page);
}

/** Every print on screen grown (or read back) and drawn. */
async function waitReady(page: Page, timeout = 60_000) {
  await page.waitForFunction(
    () => {
      const fp = (
        window as unknown as {
          __LUCA_FINGERPRINTS__?: { snapshot(): Snapshot };
        }
      ).__LUCA_FINGERPRINTS__;
      if (!fp) return false;
      const s = fp.snapshot();
      return (
        s.marks.length > 0 &&
        s.marks.filter((m) => m.visible).every((m) => m.ready && m.renders > 0)
      );
    },
    undefined,
    { timeout },
  );
  await page.waitForTimeout(400);
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() =>
    (
      window as unknown as { __LUCA_FINGERPRINTS__: { snapshot(): Snapshot } }
    ).__LUCA_FINGERPRINTS__.snapshot(),
  );
}

const grab = (page: Page, name: string) =>
  page.evaluate(
    (n) => (window as unknown as { __fpGrab(n: string): number }).__fpGrab(n),
    name,
  );
const diff = (page: Page, a: string, b: string) =>
  page.evaluate(
    ([x, y]) =>
      (
        window as unknown as {
          __fpDiff(a: string, b: string): Record<string, Diff | null>;
        }
      ).__fpDiff(x, y),
    [a, b] as const,
  );
const tone = (page: Page, name: string, id: string) =>
  page.evaluate(
    ([n, i]) =>
      (
        window as unknown as {
          __fpTone(
            n: string,
            i: string,
          ): {
            cover: number;
            meanLum: number;
            bright: number;
            centroid: [number, number] | null;
          };
        }
      ).__fpTone(n, i),
    [name, id] as const,
  );

async function markId(locator: Locator) {
  const id = await locator
    .locator("canvas[data-agent-fingerprint]")
    .first()
    .getAttribute("data-fingerprint-mark");
  expect(id).toBeTruthy();
  return id as string;
}

function sha(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function shoot(locator: Locator, name: string) {
  await waitForAnimations(locator.page());
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await locator.screenshot({ path });
  return { path, sha: sha(path) };
}

/** A real-size shot shown 3×, nearest neighbour, so each pixel can be read. */
async function enlarge(page: Page, source: string, name: string, scale = 3) {
  const data = readFileSync(source).toString("base64");
  const url = await page.evaluate(
    async ([png, k]) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const c = document.createElement("canvas");
      c.width = image.width * k;
      c.height = image.height * k;
      const ctx = c.getContext("2d");
      if (!ctx) return "";
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    },
    [data, scale] as const,
  );
  const path = `${SHOTS}/${name}.png`;
  writeFileSync(path, Buffer.from(url.split(",")[1], "base64"));
  return { path, sha: sha(path) };
}

function writeDataUrl(url: string, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  writeFileSync(path, Buffer.from(url.split(",")[1], "base64"));
  return { path, sha: sha(path) };
}

test.afterEach(() => {
  const testInfo = test.info();
  measure(`console-${testInfo.title.slice(0, 24).replace(/\W+/g, "-")}`, [
    ...errors,
  ]);
  errors.length = 0;
});

test("the dark rail at real size, a 64 head and five 128 prints, one of each kind", async ({
  page,
}) => {
  await boot(page);
  const s = await snapshot(page);
  const kinds = await page
    .locator("[data-testid^='fp-spec-']")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")));
  expect(new Set(kinds).size).toBe(5);

  const rail = page.getByTestId("fp-rail");
  const railShot = await shoot(rail, "rail-dark");
  const box = await rail.boundingBox();
  // The rows' faces, cropped: Chats and Agents (left 80 px of the rail).
  const crop = await page.screenshot({
    clip: {
      x: box?.x ?? 0,
      y: box?.y ?? 0,
      width: 120,
      height: box?.height ?? 0,
    },
    path: `${SHOTS}/rail-dark-crop.png`,
  });
  expect(crop.length).toBeGreaterThan(0);
  const crop3 = await enlarge(
    page,
    `${SHOTS}/rail-dark-crop.png`,
    "rail-dark-crop-3x",
  );
  const head = await shoot(page.getByTestId("fp-head"), "head-64-dark");
  const plate = await shoot(page.getByTestId("fp-plate"), "plate-128-dark");

  // Every print on screen draws something: ink where the ridges are, clear
  // around the oval.
  await grab(page, "now");
  const tones: Record<string, unknown> = {};
  for (const name of NAMES) {
    tones[`rail-${name}`] = await tone(
      page,
      "now",
      await markId(page.getByTestId(`fp-row-${name}`)),
    );
    tones[`spec-${name}`] = await tone(
      page,
      "now",
      await markId(page.getByTestId(`fp-spec-${name}`)),
    );
  }
  for (const t of Object.values(tones) as { cover: number }[]) {
    expect(t.cover).toBeGreaterThan(0.2);
    expect(t.cover).toBeLessThan(0.8);
  }
  measure("rail-dark", {
    kinds: Object.fromEntries(NAMES.map((n, i) => [n, kinds[i]])),
    tones,
    floatTargets: s.floatTargets,
    growth: s.growth,
    shots: { railShot, crop3, head, plate },
  });
});

test("the light rail takes its ink from the face's own colour", async ({
  page,
}) => {
  await boot(page, { mode: "light" });
  const railShot = await shoot(page.getByTestId("fp-rail"), "rail-light");
  const box = await page.getByTestId("fp-rail").boundingBox();
  await page.screenshot({
    clip: {
      x: box?.x ?? 0,
      y: box?.y ?? 0,
      width: 120,
      height: box?.height ?? 0,
    },
    path: `${SHOTS}/rail-light-crop.png`,
  });
  const crop3 = await enlarge(
    page,
    `${SHOTS}/rail-light-crop.png`,
    "rail-light-crop-3x",
  );
  await shoot(page.getByTestId("fp-plate"), "plate-128-light");
  await grab(page, "light");
  const id = await markId(page.getByTestId("fp-row-Vektor"));
  const restTone = await tone(page, "light", id);
  const faceColor = await page
    .getByTestId("fp-row-Vektor")
    .locator(".luca-rail-face")
    .evaluate((el) => getComputedStyle(el).color);
  // The selected row's ink is the rail's own ink, darker than a resting row's.
  const lucaTone = await tone(
    page,
    "light",
    await markId(page.getByTestId("fp-row-Luca")),
  );
  const lucaColor = await page
    .getByTestId("fp-row-Luca")
    .locator(".luca-rail-face")
    .evaluate((el) => getComputedStyle(el).color);
  // Hover a resting row: its face's colour changes, and so does its print.
  await page.getByTestId("fp-row-Vektor").hover();
  await page.waitForTimeout(600);
  await grab(page, "hover");
  const hoverColor = await page
    .getByTestId("fp-row-Vektor")
    .locator(".luca-rail-face")
    .evaluate((el) => getComputedStyle(el).color);
  const hoverTone = await tone(page, "hover", id);
  expect(restTone.meanLum).toBeLessThan(0.5);
  expect(hoverColor).not.toBe(faceColor);
  expect(hoverTone.meanLum).toBeLessThan(restTone.meanLum);
  measure("rail-light", {
    faceColor,
    restTone,
    lucaColor,
    lucaTone,
    hoverColor,
    hoverTone,
    shots: { railShot, crop3 },
  });
});

test("at rest each print moves: a frame strip", async ({ page }) => {
  await boot(page);
  const id = await markId(page.getByTestId("fp-head"));
  const railId = await markId(page.getByTestId("fp-row-Mara"));
  const names: string[] = [];
  for (let i = 0; i < 8; i++) {
    names.push(`f${i}`);
    await grab(page, `f${i}`);
    await page.waitForTimeout(800);
  }
  const steps = [];
  for (let i = 1; i < names.length; i++) {
    const d = await diff(page, names[i - 1], names[i]);
    steps.push({ head: d[id], rail: d[railId] });
  }
  for (const step of steps) {
    expect(step.head?.changed ?? 0).toBeGreaterThan(0);
    expect(step.rail?.changed ?? 0).toBeGreaterThan(0);
  }
  const url = await page.evaluate(
    ([n, i]) =>
      (
        window as unknown as {
          __fpStrip(n: string[], i: string, s: number): string;
        }
      ).__fpStrip(n, i, 2),
    [names, id] as const,
  );
  const strip = writeDataUrl(url, "rest-strip-head-64");
  const railUrl = await page.evaluate(
    ([n, i]) =>
      (
        window as unknown as {
          __fpStrip(n: string[], i: string, s: number): string;
        }
      ).__fpStrip(n, i, 6),
    [names, railId] as const,
  );
  const railStrip = writeDataUrl(railUrl, "rest-strip-rail-18");
  measure("rest-motion", { intervalMs: 800, steps, strip, railStrip });
});

test("working beside resting: the wave quickens and the print brightens", async ({
  page,
}) => {
  await boot(page);
  const working = await markId(page.getByTestId("fp-spec-Luca"));
  const resting = await markId(page.getByTestId("fp-spec-Vektor"));

  // The print brightens: one print, Luca's, resting and then working. The
  // pointer holds its light straight above (it would drift at rest), and
  // six frames over 1.5 s average out the breath and the wave.
  const lucaCanvas = page.getByTestId("fp-spec-Luca").locator("canvas");
  const lb = await lucaCanvas.boundingBox();
  if (!lb) throw new Error("no Luca box");
  await page.mouse.move(lb.x + lb.width / 2, lb.y + 1);
  await page.waitForTimeout(1000);
  const averageLum = async (prefix: string) => {
    let sum = 0;
    for (let i = 0; i < 6; i++) {
      await grab(page, `${prefix}${i}`);
      sum += (await tone(page, `${prefix}${i}`, working)).meanLum;
      await page.waitForTimeout(250);
    }
    return sum / 6;
  };
  const lumResting = await averageLum("lr");
  // The harness's own switch, by keyboard, so the pointer stays put.
  await page.getByTestId("fp-working-Luca").press("Enter");
  await expect(page.getByTestId("fp-working-Luca")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The ease up is 0.5 s; 2.5 s is past 99%.
  await page.waitForTimeout(2500);
  const lumWorking = await averageLum("lw");
  // The shader's level step for a large print: 0.84 to 0.98, a sixth more
  // light. Body and rim don't scale, so ask for at least half of it.
  const levelStep = 0.14 / 0.84;
  expect(lumWorking).toBeGreaterThan(lumResting * (1 + levelStep / 2));
  await page.mouse.move(2, 2);

  // The wave quickens: frame-to-frame change, working Luca beside resting
  // Vektor (a working print's change dwarfs any print's resting drift).
  await page.waitForTimeout(1000);
  const windows = [];
  for (let i = 0; i < 6; i++) {
    await grab(page, `a${i}`);
    await page.waitForTimeout(250);
    await grab(page, `b${i}`);
    const d = await diff(page, `a${i}`, `b${i}`);
    windows.push({ working: d[working], resting: d[resting] });
  }
  const mean = (k: "working" | "resting") =>
    windows.reduce((s, w) => s + (w[k]?.meanAbs ?? 0), 0) / windows.length;
  expect(mean("working")).toBeGreaterThan(mean("resting"));
  const pair = await page.evaluate(
    ([w, r]) =>
      (
        window as unknown as {
          __fpStrip(n: string[], i: string, s: number): string;
        }
      ).__fpStrip(["b5"], w, 1) +
      "|" +
      (
        window as unknown as {
          __fpStrip(n: string[], i: string, s: number): string;
        }
      ).__fpStrip(["b5"], r, 1),
    [working, resting] as const,
  );
  const [w, r] = pair.split("|");
  const shots = {
    working: writeDataUrl(w, "working-luca-128"),
    resting: writeDataUrl(r, "resting-vektor-128"),
    plate: await shoot(page.getByTestId("fp-plate"), "plate-working-luca"),
  };

  // A voice in the room: a ring of light runs out across the prints. Luca
  // rests first, so the speaker's own ring is measured against its rest.
  await page.getByTestId("fp-working-Luca").click();
  await page.waitForTimeout(4000);
  const speaker = working;
  const sample = async (prefix: string) => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      await grab(page, `${prefix}${i}`);
      out.push((await tone(page, `${prefix}${i}`, speaker)).bright);
      await page.waitForTimeout(90);
    }
    return out;
  };
  const before = await sample("pre");
  await page.getByTestId("fp-speak").click();
  const after = await sample("ring");
  const ringShot = await shoot(page.getByTestId("fp-plate"), "plate-ring");
  const ringStrip = writeDataUrl(
    await page.evaluate(
      ([i]) =>
        (
          window as unknown as {
            __fpStrip(n: string[], i: string, s: number): string;
          }
        ).__fpStrip(
          [
            "pre7",
            "ring0",
            "ring1",
            "ring2",
            "ring3",
            "ring4",
            "ring5",
            "ring6",
          ],
          i,
          1,
        ),
      [speaker] as const,
    ),
    "ring-strip-luca-128",
  );
  expect(Math.max(...after)).toBeGreaterThan(Math.max(...before) * 1.1);

  // The pointer moves the light: point left, then right, of a print.
  const spec = page.getByTestId("fp-spec-Vektor").locator("canvas");
  const sb = await spec.boundingBox();
  if (!sb) throw new Error("no spec box");
  await page.mouse.move(sb.x + 2, sb.y + sb.height / 2);
  await page.waitForTimeout(700);
  await grab(page, "left");
  await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2);
  await page.waitForTimeout(700);
  await grab(page, "right");
  const left = await tone(page, "left", resting);
  const right = await tone(page, "right", resting);
  expect(left.centroid?.[0] ?? 1).toBeLessThan(right.centroid?.[0] ?? 0);
  measure("working-motion", {
    windowMs: 250,
    windows,
    meanAbs: { working: mean("working"), resting: mean("resting") },
    brightness: {
      print: "Luca, 128",
      resting: lumResting,
      working: lumWorking,
      ratio: lumWorking / lumResting,
      required: 1 + levelStep / 2,
    },
    ring: { brightBefore: before, brightAfter: after, ringShot, ringStrip },
    pointer: { left: left.centroid, right: right.centroid },
    shots,
  });
});

test("Reduce Motion holds every print exactly still", async ({ page }) => {
  await boot(page, { reduce: true, query: "&working=Luca" });
  await page.waitForTimeout(800);
  const count = await grab(page, "s0");
  const f0 = (await snapshot(page)).frames;
  await page.waitForTimeout(3000);
  await grab(page, "s1");
  const f1 = (await snapshot(page)).frames;
  const d = await diff(page, "s0", "s1");
  const changed = Object.values(d).reduce((s, v) => s + (v?.changed ?? 0), 0);
  const total = Object.values(d).reduce((s, v) => s + (v?.total ?? 0), 0);
  expect(count).toBeGreaterThanOrEqual(11);
  expect(changed).toBe(0);
  const shot = await shoot(page.getByTestId("fp-plate"), "plate-reduce-motion");
  measure("still-reduce-motion", {
    marks: count,
    pixels: total,
    changed,
    framesDuringThreeSeconds: f1 - f0,
    shot,
  });
});

test("identity: after 60 s of motion a print is exactly its rest frame", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await boot(page, { reduce: true });
  await page.waitForTimeout(600);
  await grab(page, "rest");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const t0 = Date.now();
  await page.waitForTimeout(1500);
  await grab(page, "moving");
  // Work, a voice, the pointer: everything that moves a print.
  await page.getByTestId("fp-working-Luca").click();
  await page.getByTestId("fp-working-Mara").click();
  await page.waitForTimeout(15_000);
  await page.getByTestId("fp-speak").click();
  await page.getByTestId("fp-spec-Sol").hover();
  await page.waitForTimeout(15_000);
  await page.getByTestId("fp-working-Luca").click();
  await page.getByTestId("fp-working-Mara").click();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(Math.max(0, 60_000 - (Date.now() - t0)));
  const movedFor = Date.now() - t0;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(800);
  await grab(page, "after");
  const moving = await diff(page, "rest", "moving");
  const after = await diff(page, "rest", "after");
  const movingChanged = Object.values(moving).reduce(
    (s, v) => s + (v?.changed ?? 0),
    0,
  );
  const afterChanged = Object.values(after).reduce(
    (s, v) => s + (v?.changed ?? 0),
    0,
  );
  expect(movingChanged).toBeGreaterThan(0);
  expect(afterChanged).toBe(0);
  measure("identity", { movedForMs: movedFor, movingChanged, afterChanged });
});

test("growth on the GPU, once: a reload reads every print back", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: [number, number][] };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__longTasks.push([e.startTime, e.duration]);
      }
    }).observe({ type: "longtask", buffered: true });
  });
  await boot(page);
  const first = await snapshot(page);
  const grown = first.growth.filter((g) => g.path === "gpu");
  expect(first.floatTargets).toBe(true);
  expect(grown.length).toBe(5);
  // Long tasks (over 50 ms) on the main thread while a print grew.
  const longTasks = await page.evaluate(
    () =>
      (window as unknown as { __longTasks: [number, number][] }).__longTasks,
  );
  const during = longTasks.filter(([start, d]) =>
    grown.some((g) => start < g.startedAt + g.ms && start + d > g.startedAt),
  );
  await grab(page, "fresh");
  const freshIds = await page
    .locator("canvas[data-agent-fingerprint]")
    .evaluateAll((els) => els.length);
  // The static server can reset a connection under load: try the load again.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("fingerprint-lab")).toBeVisible({
      timeout: 15_000,
    });
  }).toPass({ timeout: 60_000 });
  await waitReady(page);
  const second = await snapshot(page);
  expect(second.growth.every((g) => g.path === "cache")).toBe(true);
  expect(second.growth.length).toBe(5);
  measure("growth-gpu", {
    longTasksDuringGrowth: during,
    grown: first.growth,
    reload: second.growth,
    canvases: freshIds,
  });
});

test("without float targets, prints grow on the CPU in a worker", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    const get = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name: string) {
      if (name === "EXT_color_buffer_float") return null;
      return get.call(this, name);
    } as typeof get;
  });
  await boot(page);
  await waitReady(page, 120_000);
  const s = await snapshot(page);
  expect(s.floatTargets).toBe(false);
  expect(s.growth.filter((g) => g.path === "cpu").length).toBe(5);
  const plate = await shoot(page.getByTestId("fp-plate"), "plate-128-cpu");
  measure("growth-cpu", { growth: s.growth, plate });
});

test("off screen a print does no work; a hidden document pauses them all", async ({
  page,
}) => {
  await boot(page);
  await page.waitForTimeout(1000);
  const before = await snapshot(page);
  const off = before.marks.find((m) => !m.visible);
  const on = before.marks.find((m) => m.visible && m.variant === "rail");
  expect(off).toBeTruthy();
  await page.waitForTimeout(2000);
  const after = await snapshot(page);
  const offAfter = after.marks.find((m) => m.id === off?.id);
  const onAfter = after.marks.find((m) => m.id === on?.id);
  expect(offAfter?.renders).toBe(off?.renders);
  expect((onAfter?.renders ?? 0) - (on?.renders ?? 0)).toBeGreaterThan(10);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  const h0 = (await snapshot(page)).frames;
  await page.waitForTimeout(1500);
  const h1 = (await snapshot(page)).frames;
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1000);
  const h2 = (await snapshot(page)).frames;
  expect(h1 - h0).toBe(0);
  expect(h2 - h1).toBeGreaterThan(10);
  measure("idle", {
    offscreen: { before: off, after: offAfter },
    onscreen: { before: on, after: onAfter },
    hidden: { framesWhileHidden: h1 - h0, framesAfterReturn: h2 - h1 },
  });
});

test("with no WebGL 2 at all, today's agent mark", async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (kind === "webgl2") return null;
      return (get as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof get;
  });
  page.on("pageerror", (error) => errors.push(`PAGE ERROR ${error.message}`));
  await installMockBridge(page);
  await expect(async () => {
    await page.goto("/?lab=fingerprint");
    await expect(page.getByTestId("fingerprint-lab")).toBeVisible({
      timeout: 15_000,
    });
  }).toPass({ timeout: 60_000 });
  await expect(page.locator("svg[data-agent-mark]")).toHaveCount(12);
  await expect(page.locator("canvas[data-agent-fingerprint]")).toHaveCount(0);
  const rail = await shoot(
    page.getByTestId("fp-rail"),
    "rail-fallback-agent-mark",
  );
  measure("fallback-no-webgl", { agentMarks: 12, rail });
});

test("the study's page beside ours", async ({ page }) => {
  test.skip(!STUDY || !existsSync(STUDY), "WP39_STUDY names the study page");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`file://${STUDY}`);
  await page.waitForTimeout(2500);
  const rails = await shoot(page.locator("#rails"), "study-rails");
  const plate = await shoot(page.locator("#plate"), "study-plate");
  const head = await shoot(page.locator("#card"), "study-head");
  measure("study", { rails, plate, head });
});
