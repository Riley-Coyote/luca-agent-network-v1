import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-12, one card (docs/luca/rail-system/SHELL_BUILD.md; SHELL_SPEC.md, "The
 * card", amended 2026-10-26). The rail and what it opens lie on one card,
 * drawn once beneath them and never moved; half a point of ink at 8% divides
 * them; closing the rail folds it into the card. Measured against the spec
 * and the shell study's `cards: "one"` drawing, in Black, Liquid Glass and the
 * frosted fallback, dark and light; the flag off is compared by hash with the
 * base build.
 *
 * SHELL_SHOTS: where the screenshots and checks.json go (else the test's
 * output folder). SHELL_BASE_URL: the base build for the flag-off hashes
 * (default http://127.0.0.1:4300); unreachable, that check is "not run".
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PLACES = 44;
const RAIL = 220;
const LIP = 36;
const EDGE = 6;

test.use({ deviceScaleFactor: 2 });
// In order, one worker; a failure doesn't stop the rest, and each test adds
// its checks to the same checks.json.
test.describe.configure({ mode: "default" });

type Box = { x: number; y: number; w: number; h: number };
type Frame = "black" | "liquid" | "frosted";
type Mode = "dark" | "light";

const checks: Record<string, unknown> = {};

function shotsDir() {
  const dir =
    process.env.SHELL_SHOTS ?? test.info().project.outputDir ?? "test-results";
  mkdirSync(dir, { recursive: true });
  return dir;
}

function saveChecks() {
  const file = path.join(shotsDir(), "checks.json");
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    saved = {};
  }
  writeFileSync(file, `${JSON.stringify({ ...saved, ...checks }, null, 2)}\n`);
}

function savedChecks(): Record<string, unknown> {
  try {
    return JSON.parse(
      readFileSync(path.join(shotsDir(), "checks.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

async function open(
  page: Page,
  {
    frame = "black",
    mode = "dark",
    flag = true,
    origin = "",
    route = `/#/channels/${GENERAL}`,
    size = { width: 1440, height: 900 },
    reducedMotion = "no-preference",
  }: {
    frame?: Frame;
    mode?: Mode;
    flag?: boolean;
    origin?: string;
    route?: string;
    size?: { width: number; height: number };
    reducedMotion?: "reduce" | "no-preference";
  } = {},
) {
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[console] ${message.text()}`);
  });
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: mode, reducedMotion });
  if (frame !== "black") {
    // Stands in for Tauri, and for PolyphonicGlass.swift under Liquid Glass:
    // it announces itself and keeps every message the page sends it.
    await page.addInitScript((liquid) => {
      const glass = window as typeof window & {
        __GLASS_MESSAGES__?: unknown[];
        __POLYPHONIC_NATIVE_GLASS__?: number;
        isTauri?: boolean;
        webkit?: unknown;
      };
      glass.isTauri = true;
      window.localStorage.setItem("polyphonic-frame", "glass");
      if (!liquid) return;
      glass.__GLASS_MESSAGES__ = [];
      glass.webkit = {
        messageHandlers: {
          polyphonicGlass: {
            postMessage: (body: unknown) =>
              glass.__GLASS_MESSAGES__?.push(JSON.parse(JSON.stringify(body))),
          },
        },
      };
      glass.__POLYPHONIC_NATIVE_GLASS__ = 1;
    }, frame === "liquid");
  }
  await installMockBridge(page);
  // After the bridge's own seed, so this one decides the frame and palette.
  await page.addInitScript(
    ({ key, on, light }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (light) {
        localStorage.setItem("buzz-theme", "paper");
        localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: flag, light: mode === "light" },
  );
  await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
  if (frame !== "black") {
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-luca-frame-glass"),
          ),
        { timeout: 20_000 },
      )
      .toBe(frame);
  }
  if (frame !== "black") {
    // A desktop behind the clear page: the study's skies
    // (shellStudy.css:80-89 at night, 1282-1287 by day).
    await page.addStyleTag({
      content: `
      :root:root[data-luca-frame-glass].dark {
        background:
          radial-gradient(60% 50% at 78% 82%, rgb(242 170 104 / 0.85), transparent 70%),
          radial-gradient(40% 35% at 18% 70%, rgb(126 104 168 / 0.7), transparent 70%),
          linear-gradient(180deg, #16223f 0%, #2d3561 38%, #8c5a74 68%, #e19a6b 100%) !important;
      }
      :root:root[data-luca-frame-glass]:not(.dark) {
        background:
          radial-gradient(60% 50% at 78% 82%, rgb(246 214 170 / 0.7), transparent 70%),
          radial-gradient(40% 35% at 18% 70%, rgb(196 186 226 / 0.6), transparent 70%),
          linear-gradient(180deg, #8fb3d9 0%, #b9cfe6 40%, #e3dccf 75%, #f0d6b8 100%) !important;
      }`,
    });
  }
}

async function openGeneral(page: Page, options: Parameters<typeof open>[1]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await open(page, options);
    try {
      await page
        .getByText("Hey team — checking in.")
        .first()
        .waitFor({ timeout: 20_000 });
      break;
    } catch (error) {
      // A blank first load on a busy machine: load again.
      if (attempt === 2) throw error;
      page.removeAllListeners("pageerror");
      page.removeAllListeners("console");
    }
  }
  await settle(page);
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await waitForAnimations(page);
  await page.waitForTimeout(250);
}

async function shot(page: Page, name: string, files: string[]) {
  await settle(page);
  const file = path.join(shotsDir(), `${name}.png`);
  await page.screenshot({ path: file });
  files.push(file);
  return file;
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** Everything the one card's measures rest on, read at once. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const box = (element: Element | null) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const one = document.querySelector("[data-luca-one-card]");
    const row = document.querySelector(
      "[data-luca-frame-row]:not([hidden])",
    ) as HTMLElement | null;
    const panel = document.querySelector(
      '[data-frame] > :is([data-testid="app-sidebar"], [data-luca-settings-list])',
    );
    const rail = panel?.querySelector('[data-sidebar="sidebar"]') ?? null;
    // What the rail opens: the surface that is itself the content, or the
    // clear plane holding it, less the plane's point of room.
    const surface = document.querySelector(
      "[data-luca-frame-row] :is([data-luca-floor-host], [data-luca-settings-card-host]) > :is([data-luca-conversation-surface], [data-buzz-content-plane])",
    );
    const surfaceBox = box(surface);
    const plane =
      surface?.matches("[data-buzz-content-plane]") ||
      surface?.querySelector("[data-luca-workspace-floor]") != null;
    const content = surfaceBox
      ? plane
        ? {
            x: surfaceBox.x + 1,
            y: surfaceBox.y + 1,
            w: surfaceBox.w - 2,
            h: surfaceBox.h - 2,
          }
        : surfaceBox
      : null;
    const paint = (element: Element | null) => {
      if (!element) return null;
      const s = getComputedStyle(element);
      return {
        background: s.backgroundColor,
        image: s.backgroundImage === "none" ? "none" : "image",
        shadow: s.boxShadow,
        radius: s.borderRadius,
      };
    };
    const panes = [
      ...document.querySelectorAll(
        '[data-testid="conversation-workspace-grid"] > [data-luca-card]',
      ),
    ];
    const rights = [
      ...document.querySelectorAll("[data-luca-right-cards] [data-luca-card]"),
    ].filter((card) => card.getBoundingClientRect().width > 0);
    const shadows = [
      ...document.querySelectorAll("[data-luca-frame-shadow]"),
    ].map((span) => ({
      ...box(span),
      display: getComputedStyle(span.parentElement as Element).display,
      opacity: getComputedStyle(span).opacity,
    }));
    const lipCard = document.querySelector(".luca-lip-card");
    const name = document.querySelector('[data-testid="shell-lip-name"]');
    const glass = (
      window as typeof window & {
        __GLASS_MESSAGES__?: Array<Record<string, unknown>>;
      }
    ).__GLASS_MESSAGES__;
    const frames = (glass ?? []).filter((m) => m.type === "frame");
    const hairline = panel
      ? getComputedStyle(panel, "::after").boxShadow
      : null;
    return {
      W: document.documentElement.clientWidth,
      H: document.documentElement.clientHeight,
      row: box(row),
      one: box(one),
      onePaint: paint(one),
      panel: box(panel),
      panelVisibility: panel ? getComputedStyle(panel).visibility : null,
      rail: box(rail),
      railPaint: paint(rail),
      hairline,
      content,
      surfacePaint: paint(surface),
      inset: paint(
        document.querySelector(
          "[data-luca-frame-row] > :is(main[data-buzz-glass-inset], [data-luca-settings-card-host])",
        ),
      ),
      panes: panes.map((pane) => ({ ...box(pane), ...paint(pane) })),
      rights: rights.map((card) => ({ ...box(card), ...paint(card) })),
      shadows,
      lipCard: box(lipCard),
      name: box(name),
      lastGlassCard: frames.length
        ? (frames[frames.length - 1].card as Box & { r: number })
        : null,
      ink: getComputedStyle(document.documentElement)
        .getPropertyValue("--mn-ink")
        .trim(),
    };
  });

type Measured = Awaited<ReturnType<typeof measure>>;

const near = (a: number | undefined | null, b: number, slack = 0.51) =>
  a != null && Math.abs(a - b) <= slack;

/** The one card in its place: from the places' edge to `right` from the
 *  window's right, top flush with the lip, 6 above the bottom, corners 10. */
function cardInPlace(m: Measured, right = EDGE) {
  const one = m.one;
  return Boolean(
    one &&
      one.x === PLACES &&
      one.y === LIP &&
      near(m.W - (one.x + one.w), right) &&
      near(m.H - (one.y + one.h), EDGE) &&
      m.onePaint?.radius === "10px",
  );
}

/** Nothing lying on the card paints a surface, grain or edge of its own. */
function columnsClear(m: Measured) {
  const clear = (paint: Measured["railPaint"]) =>
    paint != null &&
    paint.background === "rgba(0, 0, 0, 0)" &&
    paint.image === "none";
  return {
    rail: clear(m.railPaint) && m.railPaint?.shadow === "none",
    content: clear(m.surfacePaint) && m.surfacePaint?.shadow === "none",
    inset: m.inset?.background === "rgba(0, 0, 0, 0)",
    panes: m.panes.every(
      (pane) =>
        pane.background === "rgba(0, 0, 0, 0)" &&
        pane.image === "none" &&
        // A pane's only line is the hairline at a seam (inset, ink 8%).
        (pane.shadow === "none" || /inset/.test(pane.shadow ?? "")),
    ),
  };
}

/** The device pixels of one row across a vertical seam at `x` points. */
async function rowPixels(file: string, page: Page, x: number, ys: number[]) {
  const png = readFileSync(file).toString("base64");
  return page.evaluate(
    async ({ png, x, ys }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) return [];
      context.drawImage(image, 0, 0);
      return ys.map((y) => {
        const from = Math.round(x * 2) - 6;
        const data = context.getImageData(from, Math.round(y * 2), 12, 1).data;
        const row: number[][] = [];
        for (let i = 0; i < 12; i++) {
          row.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
        }
        return { from, row };
      });
    },
    { png, x, ys },
  );
}

/** One device pixel of ink at 8% over the card's surface, nothing beside
 *  it: the line is the only pixel off the surface, and it is the blend. */
function hairlineOk(
  samples: { from: number; row: number[][] }[],
  device: number,
  ink: string,
  /** An opaque line's own colour (the panes' dividers, ink mixed into the
   *  surface token), instead of ink at 8% over the pixels beside it. */
  opaque?: number[],
) {
  const [h, s, l] = ink.split(/\s+/).map((part) => Number.parseFloat(part));
  // The ink in RGB (hsl → rgb).
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const hp = h / 60;
  const xx = c * (1 - Math.abs((hp % 2) - 1));
  const m = l / 100 - c / 2;
  const [r1, g1, b1] =
    hp < 1
      ? [c, xx, 0]
      : hp < 2
        ? [xx, c, 0]
        : hp < 3
          ? [0, c, xx]
          : hp < 4
            ? [0, xx, c]
            : hp < 5
              ? [xx, 0, c]
              : [c, 0, xx];
  const inkRgb = [r1 + m, g1 + m, b1 + m].map((v) => v * 255);
  return samples.map(({ from, row }) => {
    const at = device - from;
    const line = row[at];
    const sides = [...row.slice(0, at - 1), ...row.slice(at + 2)];
    const surface = sides.reduce(
      (sum, px) => sum.map((v, i) => v + px[i] / sides.length),
      [0, 0, 0],
    );
    const expected =
      opaque ?? surface.map((v, i) => v + 0.08 * (inkRgb[i] - v));
    const lineDelta = Math.max(
      ...line.map((v, i) => Math.abs(v - expected[i])),
    );
    const neighbours = [row[at - 1], row[at + 1]].map((px) =>
      Math.max(...px.map((v, i) => Math.abs(v - surface[i]))),
    );
    const sideSpread = Math.max(
      ...sides.map((px) =>
        Math.max(...px.map((v, i) => Math.abs(v - surface[i]))),
      ),
    );
    return {
      line,
      expected: expected.map((v) => Math.round(v)),
      surface: surface.map((v) => Math.round(v)),
      line_delta: Math.round(lineDelta * 10) / 10,
      neighbours: neighbours.map((v) => Math.round(v * 10) / 10),
      side_spread: Math.round(sideSpread * 10) / 10,
      ok: lineDelta <= 3 && neighbours.every((v) => v <= 4) && sideSpread <= 4,
    };
  });
}

/** Whether the base build is being served. */
const reachable = (url: string) =>
  fetch(url)
    .then((response) => response.ok)
    .catch(() => false);

test.afterEach(() => saveChecks());

// ── Black, dark: Chats, the hairline, the lip ───────────────────────────

test("one card, Black, dark: Chats", async ({ page }) => {
  const files: string[] = [];
  await openGeneral(page, {});
  await page.mouse.move(900, 600);
  const file = await shot(page, "one-dark", files);
  const m = await measure(page);
  const clear = columnsClear(m);
  const seam = hairlineOk(
    await rowPixels(file, page, PLACES + RAIL, [200, 450, 700]),
    (PLACES + RAIL) * 2 - 1,
    m.ink,
  );
  checks.one_dark = {
    one: m.one,
    in_place: cardInPlace(m),
    rail_right: m.panel ? m.panel.x + m.panel.w : null,
    content_left: m.content?.x,
    edge: m.onePaint?.shadow,
    clear,
    hairline_css: m.hairline,
    seam,
  };
  checks.lip_axis = {
    lip_card_left: m.lipCard?.x,
    name_centre: m.name ? m.name.x + m.name.w / 2 : null,
    content_centre: m.content ? m.content.x + m.content.w / 2 : null,
    ok:
      m.lipCard?.x === PLACES + RAIL &&
      m.name != null &&
      m.content != null &&
      near(m.name.x + m.name.w / 2, m.content.x + m.content.w / 2, 1),
  };
  // No edge light inside the card: just under its top edge, across the rail
  // and the content, no pixel stands above the surface but the hairline's.
  const under = await page.evaluate(
    async ({ png, y }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) return [];
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, y, image.width, 1).data;
      const out: number[] = [];
      for (let x = 0; x < image.width; x++) out.push(data[x * 4]);
      return out;
    },
    { png: readFileSync(file).toString("base64"), y: (LIP + 3) * 2 },
  );
  const inside = under.slice(PLACES * 2 + 24, (m.W - EDGE) * 2 - 24);
  const surface = inside[40];
  const bright = inside
    .map((v, i) => ({ x: (PLACES * 2 + 24 + i) / 2, v }))
    .filter(({ v }) => v > surface + 6);
  checks.one_shadow_dark = {
    one_card_edge: m.onePaint?.shadow,
    bright_inside_under_top: bright,
    shadows_layer: m.shadows.length,
    ok:
      (m.onePaint?.shadow ?? "none") !== "none" &&
      bright.every(({ x }) => Math.abs(x - (PLACES + RAIL)) <= 0.5) &&
      m.shadows.every((s) => s.display === "none"),
  };
  expect(cardInPlace(m)).toBe(true);
  expect(Object.values(clear).every(Boolean)).toBe(true);
  expect(m.panel && m.panel.x + m.panel.w).toBe(m.content?.x);
  expect(seam.every((s) => s.ok)).toBe(true);
  checks.files_dark = files;
});

// ── every place ─────────────────────────────────────────────────────────

test("one card in every place", async ({ page }) => {
  const files: string[] = [];
  await openGeneral(page, {});
  const places: Record<string, unknown> = {};
  const visit = async (
    place: string,
    testId: string,
    ready: () => Promise<void>,
    name?: string,
  ) => {
    await page.getByTestId(testId).click();
    await ready();
    await page.waitForTimeout(600);
    await settle(page);
    await page.mouse.move(900, 600);
    if (name) await shot(page, name, files);
    const m = await measure(page);
    const clear = columnsClear(m);
    places[place] = {
      one: m.one,
      in_place: cardInPlace(m),
      rail_right: m.panel ? m.panel.x + m.panel.w : null,
      content: m.content,
      clear,
      ok:
        cardInPlace(m) &&
        Object.values(clear).every(Boolean) &&
        m.panel != null &&
        m.content != null &&
        near(m.panel.x + m.panel.w, m.content.x, 0.01),
    };
  };
  await visit(
    "agents",
    "open-agents-view",
    async () => {
      await page.waitForURL(/agents/, { timeout: 20_000 });
    },
    "one-agents",
  );
  await visit("activity", "open-activity-view", async () => {
    await page.waitForURL(/pulse|activity/, { timeout: 20_000 });
  });
  await visit("library", "open-artifacts-view", async () => {
    await page.waitForURL(/artifacts|library/, { timeout: 20_000 });
  });
  await visit("chats", "shell-place-conversations", async () => {
    await page.waitForURL(/channels/, { timeout: 20_000 });
  });
  // New conversation is the Chats rail's + now (NAVIGATION.md), not a place.
  await visit("new_conversation", "rail-new-conversation", async () => {
    await expect(page.getByTestId("new-message-body")).toBeVisible({
      timeout: 20_000,
    });
  });
  await visit(
    "settings",
    "open-settings-view",
    async () => {
      await expect(page.getByTestId("settings-view")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator("[data-luca-one-card]")).toBeVisible();
    },
    "one-settings",
  );
  checks.one_card_every_place = {
    ...places,
    ok: Object.values(places).every((p) => (p as { ok: boolean }).ok),
  };
  checks.files_places = files;
  expect(
    Object.entries(places)
      .filter(([, p]) => !(p as { ok: boolean }).ok)
      .map(([k]) => k),
  ).toEqual([]);
});

// ── the fold ────────────────────────────────────────────────────────────

test("closing the rail folds it into the card", async ({ page }) => {
  const files: string[] = [];
  await openGeneral(page, {});
  await page.mouse.move(900, 600);
  // Every frame of the slide: the card's box and corners, the rail's right
  // edge and the content's left.
  const trace = page.evaluate(
    () =>
      new Promise<
        Array<{
          t: number;
          one: string;
          radius: string;
          rail: number;
          content: number;
        }>
      >((resolve) => {
        const frames: Array<{
          t: number;
          one: string;
          radius: string;
          rail: number;
          content: number;
        }> = [];
        const one = document.querySelector("[data-luca-one-card]") as Element;
        const panel = document.querySelector(
          '[data-frame] > [data-testid="app-sidebar"]',
        ) as Element;
        const plane = document.querySelector(
          "[data-luca-floor-host] > [data-luca-conversation-surface]",
        ) as Element;
        const start = performance.now();
        const step = () => {
          const o = one.getBoundingClientRect();
          const p = panel.getBoundingClientRect();
          const c = plane.getBoundingClientRect();
          frames.push({
            t: Math.round(performance.now() - start),
            one: `${o.x},${o.y},${o.width},${o.height}`,
            radius: getComputedStyle(one).borderRadius,
            rail: p.x + p.width,
            content: c.x + 1,
          });
          if (performance.now() - start < 800) requestAnimationFrame(step);
          else resolve(frames);
        };
        requestAnimationFrame(step);
        (
          document.querySelector(
            '[data-testid="shell-lip-toggle"]',
          ) as HTMLElement
        ).click();
      }),
  );
  const frames = await trace;
  const moving = frames.filter(
    (f) => f.rail > PLACES + 0.5 && f.rail < PLACES + RAIL - 0.5,
  );
  const firstOne = frames[0].one;
  checks.fold_keeps_corner = {
    frames: frames.length,
    frames_mid_slide: moving.length,
    card_boxes: [...new Set(frames.map((f) => f.one))],
    radii: [...new Set(frames.map((f) => f.radius))],
    max_rail_content_delta: Math.max(
      ...frames.map((f) => Math.abs(f.rail - f.content)),
    ),
    end_content_left: frames[frames.length - 1].content,
    ok:
      moving.length >= 5 &&
      frames.every((f) => f.one === firstOne && f.radius === "10px") &&
      frames.every((f) => Math.abs(f.rail - f.content) <= 0.5) &&
      near(frames[frames.length - 1].content, PLACES, 0.01),
  };
  await settle(page);
  await page.waitForTimeout(300);
  await shot(page, "one-rail-closed", files);
  const closed = await measure(page);
  checks.rail_closed = {
    one: closed.one,
    in_place: cardInPlace(closed),
    content_left: closed.content?.x,
    panel_visibility: closed.panelVisibility,
    lip_card_left: closed.lipCard?.x,
  };
  // Mid-slide, held still: open the rail and stop every transition halfway.
  await page.getByTestId("shell-lip-toggle").click();
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 160;
    }
  });
  const file = path.join(shotsDir(), "one-closing.png");
  await page.screenshot({ path: file });
  files.push(file);
  const mid = await measure(page);
  checks.mid_slide = {
    rail_right: mid.panel ? mid.panel.x + mid.panel.w : null,
    content_left: mid.content?.x,
    one: mid.one,
    ok:
      cardInPlace(mid) &&
      mid.panel != null &&
      mid.content != null &&
      mid.panel.x + mid.panel.w > PLACES + 10 &&
      mid.panel.x + mid.panel.w < PLACES + RAIL - 10 &&
      near(mid.panel.x + mid.panel.w, mid.content.x),
  };
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.play();
  });
  await settle(page);
  checks.files_fold = files;
  expect((checks.fold_keeps_corner as { ok: boolean }).ok).toBe(true);
  expect((checks.mid_slide as { ok: boolean }).ok).toBe(true);
});

test("Reduce Motion: the fold is instant", async ({ page }) => {
  await openGeneral(page, { reducedMotion: "reduce" });
  const after = await page.evaluate(
    () =>
      new Promise<{ rail: number; content: number }>((resolve) => {
        (
          document.querySelector(
            '[data-testid="shell-lip-toggle"]',
          ) as HTMLElement
        ).click();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const p = document
              .querySelector('[data-frame] > [data-testid="app-sidebar"]')
              ?.getBoundingClientRect();
            const c = document
              .querySelector(
                "[data-luca-floor-host] > [data-luca-conversation-surface]",
              )
              ?.getBoundingClientRect();
            resolve({
              rail: p ? p.x + p.width : -1,
              content: c ? c.x + 1 : -1,
            });
          }),
        );
      }),
  );
  checks.reduce_motion = {
    ...after,
    ok: near(after.rail, PLACES, 0.01) && near(after.content, PLACES, 0.01),
  };
  expect((checks.reduce_motion as { ok: boolean }).ok).toBe(true);
});

// ── panes, the right card ───────────────────────────────────────────────

test("panes share the card; the right cards stand apart", async ({ page }) => {
  const files: string[] = [];
  await openGeneral(page, {});
  await page.getByTestId("workspace-layout-menu").click();
  await page.getByTestId("workspace-preset-columns-2").click();
  const second = page.getByTestId("workspace-pane-slot-2");
  await expect(second).toBeVisible();
  await second.click({ position: { x: 200, y: 300 } });
  await expect(second).toHaveAttribute("data-focused", "true");
  await page
    .locator('[data-testid="app-sidebar"] [data-channel-id]')
    .filter({ hasText: "welcome-everyone" })
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.mouse.move(900, 600);
  const file = await shot(page, "one-panes", files);
  const m = await measure(page);
  const [left, right] = m.panes;
  const seamX = left ? left.x + left.w : 0;
  const seam =
    left && right
      ? hairlineOk(
          await rowPixels(file, page, seamX, [300, 600]),
          Math.round(seamX * 2) - 1,
          m.ink,
          // The dividers are opaque, so a crossing keeps one tone: the
          // hairline's ink mixed into the surface (shell-frame.css).
          await page.evaluate(() => {
            const probe = document.createElement("div");
            probe.style.color =
              "color-mix(in srgb, hsl(var(--mn-ink)) 8%, hsl(var(--mn-surface)))";
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            const parts = color.match(/[\d.]+/g)?.map(Number) ?? [];
            // color(srgb r g b) in 0..1, or rgb(r, g, b) in 0..255.
            return color.startsWith("color(")
              ? parts.slice(0, 3).map((v) => v * 255)
              : parts.slice(0, 3);
          }),
        )
      : [];
  const gridGap = await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector(
          '[data-testid="conversation-workspace-grid"]',
        ) as Element,
      ).columnGap,
  );
  checks.panes_share_card = {
    panes: m.panes,
    grid_gap: gridGap,
    seam_x: seamX,
    seam,
    in_place: cardInPlace(m),
    ok:
      m.panes.length === 2 &&
      gridGap === "0px" &&
      near(left.x + left.w, right.x, 0.01) &&
      columnsClear(m).panes &&
      seam.every((s) => s.ok) &&
      cardInPlace(m),
  };
  expect((checks.panes_share_card as { ok: boolean }).ok).toBe(true);

  // Back to one pane, and the conversation's details on the right.
  await page.getByTestId("workspace-layout-menu").click();
  await page.getByTestId("workspace-preset-single").click();
  await page
    .getByRole("button", { name: "Open conversation details", exact: true })
    .click();
  await expect(
    page.locator("[data-luca-right-cards] [data-luca-card]").first(),
  ).toBeVisible();
  await page.waitForTimeout(700);
  await page.mouse.move(700, 600);
  await shot(page, "one-right-card", files);
  const r = await measure(page);
  const card = r.rights[0];
  checks.right_cards_apart = {
    one: r.one,
    right: card,
    gap: card && r.one ? card.x - (r.one.x + r.one.w) : null,
    right_edge: card ? r.W - (card.x + card.w) : null,
    content_right: r.content ? r.content.x + r.content.w : null,
    name_centre: r.name ? r.name.x + r.name.w / 2 : null,
    ok:
      card != null &&
      r.one != null &&
      near(card.x - (r.one.x + r.one.w), 4) &&
      near(r.W - (card.x + card.w), EDGE) &&
      card.y === LIP &&
      (card.shadow ?? "none") !== "none" &&
      r.content != null &&
      near(r.content.x + r.content.w, r.one.x + r.one.w) &&
      r.name != null &&
      near(r.name.x + r.name.w / 2, r.content.x + r.content.w / 2, 1),
  };
  checks.files_panes = files;
  expect((checks.right_cards_apart as { ok: boolean }).ok).toBe(true);
});

// ── the narrow window, the sheet, the peek ──────────────────────────────

test("the narrow window, the sheet and the peek", async ({ page }) => {
  const files: string[] = [];
  await openGeneral(page, { size: { width: 800, height: 500 } });
  await page.mouse.move(600, 300);
  await shot(page, "one-narrow", files);
  const narrow = await measure(page);
  // The peek: the rail closed, the pointer at its edge.
  await page.getByTestId("shell-lip-toggle").click();
  await settle(page);
  await page.waitForTimeout(400);
  await page.dispatchEvent("[data-frame]", "mouseover");
  await page.waitForTimeout(700);
  await settle(page);
  await shot(page, "one-peek", files);
  const peek = await measure(page);
  // The sheet, under 768.
  await page.setViewportSize({ width: 760, height: 500 });
  await page.waitForTimeout(600);
  await page.getByTestId("shell-lip-toggle").click();
  const sheet = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, "one-narrow-sheet", files);
  const sheetPaint = await sheet.evaluate((element) => {
    const s = getComputedStyle(element);
    const r = element.getBoundingClientRect();
    return {
      x: r.x,
      w: r.width,
      background: s.backgroundColor,
    };
  });
  const behind = await measure(page);
  checks.sheet_and_peek = {
    narrow: {
      one: narrow.one,
      in_place: cardInPlace(narrow),
      content_left: narrow.content?.x,
      content_width: narrow.content?.w,
    },
    peek: {
      panel: peek.panel,
      rail_paint: peek.railPaint,
      hairline: peek.hairline,
      content_left: peek.content?.x,
    },
    sheet: sheetPaint,
    behind_sheet: { one: behind.one, in_place: cardInPlace(behind) },
    ok:
      cardInPlace(narrow) &&
      narrow.content?.x === PLACES + RAIL &&
      near(narrow.content?.w, 800 - PLACES - RAIL - EDGE) &&
      peek.panel?.w === RAIL &&
      peek.railPaint?.background !== "rgba(0, 0, 0, 0)" &&
      peek.railPaint?.radius === "10px" &&
      peek.content?.x === PLACES &&
      sheetPaint.w > 0 &&
      sheetPaint.background !== "rgba(0, 0, 0, 0)" &&
      cardInPlace(behind),
  };
  checks.files_narrow = files;
  expect((checks.sheet_and_peek as { ok: boolean }).ok).toBe(true);
});

// ── every frame and mode ────────────────────────────────────────────────

const FRAMES: Array<{ frame: Frame; mode: Mode; name: string }> = [
  { frame: "black", mode: "light", name: "one-light" },
  { frame: "liquid", mode: "dark", name: "one-glass-dark" },
  { frame: "liquid", mode: "light", name: "one-glass-light" },
  { frame: "frosted", mode: "dark", name: "one-frosted-dark" },
  { frame: "frosted", mode: "light", name: "one-frosted-light" },
];

const frameChecks: Record<string, unknown> = {};

for (const { frame, mode, name } of FRAMES) {
  test(`one card: ${frame}, ${mode}`, async ({ page }) => {
    const files: string[] = [];
    await openGeneral(page, { frame, mode });
    await page.mouse.move(900, 600);
    await page.waitForTimeout(400);
    const file = await shot(page, name, files);
    const m = await measure(page);
    const clear = columnsClear(m);
    const seam = hairlineOk(
      await rowPixels(file, page, PLACES + RAIL, [300, 700]),
      (PLACES + RAIL) * 2 - 1,
      m.ink,
    );
    const visibleShadows = m.shadows.filter((s) => s.display !== "none");
    const one = m.one as Box;
    const shadowOk =
      mode === "light"
        ? visibleShadows.length === 1 &&
          near(visibleShadows[0].x, one.x, 0.01) &&
          near(visibleShadows[0].w, one.w, 0.01) &&
          near(visibleShadows[0].h, one.h, 0.01) &&
          m.onePaint?.shadow === "none"
        : visibleShadows.length === 0 &&
          (m.onePaint?.shadow ?? "none") !== "none";
    const glassOk =
      frame !== "liquid" ||
      (m.lastGlassCard != null &&
        near(m.lastGlassCard.x, one.x, 0.01) &&
        near(m.lastGlassCard.w, one.w, 0.01) &&
        near(m.lastGlassCard.h, one.h, 0.01) &&
        m.lastGlassCard.r === 10);
    frameChecks[`${frame}_${mode}`] = {
      in_place: cardInPlace(m),
      clear,
      one_edge: m.onePaint?.shadow,
      shadows: visibleShadows,
      glass_card: m.lastGlassCard,
      seam,
      ok:
        cardInPlace(m) &&
        Object.values(clear).every(Boolean) &&
        shadowOk &&
        glassOk &&
        seam.every((s) => s.ok),
    };
    const publish = () => {
      checks.frames_and_modes = {
        ...((savedChecks().frames_and_modes ?? {}) as Record<string, unknown>),
        ...frameChecks,
      };
    };
    publish();
    expect
      .soft(
        (frameChecks[`${frame}_${mode}`] as { ok: boolean }).ok,
        JSON.stringify(frameChecks[`${frame}_${mode}`]),
      )
      .toBe(true);

    if (mode === "light") {
      // A right card's shadow joins the one card's on the floor: two, apart.
      await page
        .getByRole("button", { name: "Open conversation details", exact: true })
        .click();
      await page.waitForTimeout(800);
      await settle(page);
      const r = await measure(page);
      const shadows = r.shadows.filter((s) => s.display !== "none");
      frameChecks[`${frame}_${mode}_right_card`] = {
        shadows,
        one: r.one,
        ok:
          shadows.length === 2 &&
          r.one != null &&
          shadows.some((s) => near(s.w, (r.one as Box).w, 0.01)),
      };
    }
    if (frame === "liquid") {
      // The glass is told about the one card as the rail folds into it: the
      // same box, frame after frame.
      await page.evaluate(() => {
        (
          window as typeof window & { __GLASS_MESSAGES__?: unknown[] }
        ).__GLASS_MESSAGES__ = [];
      });
      await page.getByTestId("shell-lip-toggle").click();
      await page.waitForTimeout(800);
      const reported = await page.evaluate(() =>
        (
          (
            window as typeof window & {
              __GLASS_MESSAGES__?: Array<Record<string, unknown>>;
            }
          ).__GLASS_MESSAGES__ ?? []
        )
          .filter((message) => message.type === "frame")
          .map((message) => JSON.stringify(message.card)),
      );
      frameChecks[`${frame}_${mode}_fold_reports`] = {
        cards: [...new Set(reported)],
        ok: new Set(reported).size <= 1,
      };
    }
    publish();
  });
}

test("glass and shadows count the one card", () => {
  const saved = savedChecks();
  const frames = (saved.frames_and_modes ?? {}) as Record<string, unknown>;
  const dark = saved.one_dark as { seam?: Array<{ ok: boolean }> } | undefined;
  const values = Object.entries(frames);
  checks.glass_and_shadows = {
    ok:
      values.length > 0 &&
      values.every(([, value]) => (value as { ok: boolean }).ok),
  };
  checks.hairline_pixels = {
    dark: dark?.seam,
    ok:
      (dark?.seam ?? []).length > 0 &&
      (dark?.seam ?? []).every((s) => s.ok) &&
      Object.values(frames).every(
        (v) =>
          !(v as { seam?: unknown }).seam ||
          ((v as { seam: Array<{ ok: boolean }> }).seam ?? []).every(
            (s) => s.ok,
          ),
      ),
  };
  saveChecks();
});

// ── the flag off ────────────────────────────────────────────────────────

test("flag off: identical to the base", async ({ browser }) => {
  test.setTimeout(300_000);
  if (!(await reachable(BASE_URL))) {
    checks.flag_off_identical = { ok: null, note: `not run: ${BASE_URL}` };
    test.skip(true, "base build not served");
    return;
  }
  const views: Array<{ name: string; mode: Mode; route: string }> = [
    { name: "general-dark", mode: "dark", route: `/#/channels/${GENERAL}` },
    { name: "general-light", mode: "light", route: `/#/channels/${GENERAL}` },
    { name: "settings-dark", mode: "dark", route: "/#/settings" },
    { name: "library-dark", mode: "dark", route: "/#/artifacts" },
  ];
  const results: Record<string, unknown> = {};
  for (const view of views) {
    const hashes: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      hashes.length = 0;
      for (const origin of [BASE_URL, ""]) {
        const context = await browser.newContext({
          baseURL: test.info().project.use.baseURL,
          deviceScaleFactor: 2,
        });
        // Both builds start their clocks at the same minute, and the
        // residents' eyes hold still under Reduce Motion, so the two
        // captures can match by hash (as shell-frame.spec.ts does).
        await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
        const page = await context.newPage();
        await open(page, {
          flag: false,
          mode: view.mode,
          origin,
          route: view.route,
          reducedMotion: "reduce",
        });
        if (view.route.includes("artifacts")) {
          await expect(page.getByTestId("artifact-library-screen")).toBeVisible(
            {
              timeout: 20_000,
            },
          );
        } else if (view.route.includes("channels")) {
          await page
            .getByText("Hey team — checking in.")
            .first()
            .waitFor({ timeout: 20_000 });
        } else {
          await expect(page.getByTestId("settings-view")).toBeVisible({
            timeout: 20_000,
          });
        }
        await page.waitForTimeout(1200);
        await page.mouse.move(1, 1);
        await settle(page);
        const file = path.join(
          shotsDir(),
          `flag-off-${view.name}-${origin ? "base" : "ours"}.png`,
        );
        await page.screenshot({ path: file });
        hashes.push(sha(file));
        await context.close();
      }
      if (hashes[0] === hashes[1]) break;
    }
    results[view.name] = { base: hashes[0], ours: hashes[1] };
  }
  checks.flag_off_identical = {
    ...results,
    ok: Object.values(results).every(
      (r) =>
        (r as { base: string; ours: string }).base ===
        (r as { ours: string }).ours,
    ),
  };
  saveChecks();
  expect((checks.flag_off_identical as { ok: boolean }).ok).toBe(true);
});
