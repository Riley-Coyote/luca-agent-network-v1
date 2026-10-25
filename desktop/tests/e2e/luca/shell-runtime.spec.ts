import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * The runtime sessions card (docs/luca/rail-system/SHELL_BUILD.md, WP-08c;
 * SHELL_SPEC.md, "The rail" and Decided 12). Under the frame the runtime
 * sessions column is a card of its own between the rail's and the
 * conversation's: 22 rem, the cards' material, edge and corners, top flush
 * with the lip, 6 above the bottom, 4 from each card; it opens and closes on
 * the rail's motion and the lip follows the conversation's card. The flag
 * off draws exactly the base build, by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks.json go (else the test's
 * output folder). SHELL_BASE_URL: the base build (default
 * http://127.0.0.1:4300); unreachable, the comparison is reported as not run.
 * SHELL_HEAD_URL: the branch's starting point built with the frame (default
 * http://127.0.0.1:4384), for the narrow sheet "as today".
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
/** The branch's own starting point, built with the frame (the base above
 *  predates it), for "as today" under the flag. */
const HEAD_URL = process.env.SHELL_HEAD_URL ?? "http://127.0.0.1:4384";
const LIP = 36;
const EDGE = 6;
const GAP = 4;
const PLACES = 44;
const RAIL = 220;
const CARD_WIDTH = 22 * 16;
const SLIDE_MS = 460;

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };
const checks: Record<string, unknown> = {};
let dir = "";

function shotsDir(fallback: string) {
  const out = process.env.SHELL_SHOTS ?? fallback;
  mkdirSync(out, { recursive: true });
  return out;
}

async function openApp(
  page: Page,
  {
    frame,
    origin = "",
    route = "#/agents",
    size = { width: 1440, height: 900 },
    reducedMotion = "no-preference",
    colorScheme = "dark",
  }: {
    frame: boolean;
    origin?: string;
    route?: string;
    size?: { width: number; height: number };
    reducedMotion?: "reduce" | "no-preference";
    colorScheme?: "dark" | "light";
  },
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme, reducedMotion });
  await installMockBridge(page);
  if (colorScheme === "light") {
    await page.addInitScript(() =>
      window.localStorage.setItem("buzz-theme", "paper"),
    );
  }
  // After the bridge's own seed, so this one decides the frame.
  await page.addInitScript(
    ({ key, on }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      localStorage.setItem(key, JSON.stringify(overrides));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frame },
  );
  // The first load can be slow while the machine is busy: one retry past a
  // blank page.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(`${origin}/?e2e=mock${route}`);
    try {
      await expect(
        page.locator("[data-runtime-connection-key]").first(),
      ).toBeVisible({
        timeout: 20000,
      });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

/** Opens the first runtime's sessions: from the Agents page under the frame
 *  (Runtimes lives there), from the rail without it. */
async function openRuntime(page: Page) {
  await page.locator("[data-runtime-connection-key]").first().click();
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await waitForAnimations(page);
}

async function shot(page: Page, name: string) {
  await settle(page);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

const RUNTIME = "[data-luca-runtime-card]";
const RAIL_CARD = '[data-frame] [data-sidebar="sidebar"]';

/** The conversation's card: the surface, its content box (its point of
 *  padding holds the edge light, as ShellLip reads it). */
async function conversationCard(page: Page): Promise<Box | null> {
  return page.evaluate(() => {
    const card = document.querySelector("[data-buzz-content-surface]");
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function geometry(page: Page) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const runtime = await box(page, RUNTIME);
  const rail = await box(page, RAIL_CARD);
  const card = await conversationCard(page);
  const lip = await box(page, ".luca-lip-card");
  const back = await box(page, '[data-testid="global-back"]');
  const name = await box(page, '[data-testid="shell-lip-name"]');
  const style = await page.evaluate(
    ({ runtimeSelector, railSelector }) => {
      const read = (s: string) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const c = getComputedStyle(e);
        return {
          background: c.backgroundColor,
          image: c.backgroundImage.slice(0, 40),
          radius: c.borderTopLeftRadius,
          shadow: c.boxShadow,
          border: c.borderRightWidth,
        };
      };
      return { runtime: read(runtimeSelector), rail: read(railSelector) };
    },
    { runtimeSelector: RUNTIME, railSelector: RAIL_CARD },
  );
  return { viewport, runtime, rail, card, lip, back, name, style };
}

type Sample = {
  t: number;
  runtimeX: number | null;
  runtimeW: number | null;
  /** The card's right margin (its 4 to the conversation's, sliding too). */
  runtimeGap: number | null;
  /** Whether the click that starts the motion has landed. */
  clicked: boolean;
  cardX: number | null;
  lipX: number | null;
};

/** Every frame for `ms` after `start`: the runtime card, the conversation
 *  card's left, the lip's part over it. */
async function trace(page: Page, start: () => Promise<void>, ms = 700) {
  await page.evaluate((duration) => {
    const samples: Sample[] = [];
    (window as unknown as { __trace: Sample[] }).__trace = samples;
    const t0 = performance.now();
    let clicked = false;
    document.addEventListener(
      "click",
      () => {
        clicked = true;
      },
      { capture: true, once: true },
    );
    const step = () => {
      const runtime = document.querySelector("[data-luca-runtime-card]");
      const card = document.querySelector("[data-buzz-content-surface]");
      const lip = document.querySelector(".luca-lip-card");
      const r = runtime?.getBoundingClientRect();
      samples.push({
        t: Math.round(performance.now() - t0),
        runtimeX: r ? r.x : null,
        runtimeW: r ? r.width : null,
        runtimeGap: runtime
          ? Number.parseFloat(getComputedStyle(runtime).marginRight)
          : null,
        clicked,
        cardX: card ? card.getBoundingClientRect().x : null,
        lipX: lip ? lip.getBoundingClientRect().x : null,
      });
      if (performance.now() - t0 < duration) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, ms);
  await start();
  await page.waitForTimeout(ms + 150);
  return page.evaluate(
    () => (window as unknown as { __trace: Sample[] }).__trace,
  );
}

test.beforeAll(() => {
  dir = shotsDir(test.info().outputDir);
});

test.afterAll(() => {
  writeFileSync(path.join(dir, "checks.json"), JSON.stringify(checks, null, 2));
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 800, height: 500 },
]) {
  test(`column-open ${size.width}: a card between the rail's and the conversation's`, async ({
    page,
  }) => {
    await openApp(page, { frame: true, size });
    await openRuntime(page);
    await expect(page.locator(RUNTIME)).toHaveAttribute(
      "data-luca-runtime-card",
      "open",
    );
    await page.waitForTimeout(SLIDE_MS + 200);
    const file = await shot(page, `column-open-${size.width}`);
    const g = await geometry(page);
    const runtime = g.runtime as Box;
    const rail = g.rail as Box;
    const card = g.card as Box;
    // The smallest window: the rail's card steps aside for it (SHELL_SPEC.md,
    // "Smallest window"), so it stands 4 from the places instead.
    const railStepsAside = size.width < 1000;
    const gaps = {
      railToRuntime: railStepsAside
        ? runtime.x - PLACES
        : runtime.x - (rail.x + rail.w),
      runtimeToCard: card.x - (runtime.x + runtime.w),
      runtimeTopToLip: runtime.y - LIP,
      runtimeBottom: size.height - (runtime.y + runtime.h),
    };
    const geometryOk =
      runtime.w === CARD_WIDTH &&
      runtime.x === (railStepsAside ? PLACES + GAP : PLACES + RAIL + GAP) &&
      (railStepsAside ? rail.w === 0 : rail.w === RAIL) &&
      runtime.y === LIP &&
      g.style.runtime?.radius === "10px" &&
      g.style.runtime?.background === g.style.rail?.background &&
      g.style.runtime?.shadow === g.style.rail?.shadow &&
      g.style.runtime?.image === g.style.rail?.image &&
      g.style.runtime?.border === "0px";
    const gapsOk =
      gaps.railToRuntime === GAP &&
      gaps.runtimeToCard === GAP &&
      gaps.runtimeTopToLip === 0 &&
      gaps.runtimeBottom === EDGE &&
      size.width - (card.x + card.w) === EDGE;
    const lip = g.lip as Box;
    const back = g.back as Box;
    const name = g.name as Box;
    const lipFollows = {
      lipLeft: lip.x,
      cardLeft: card.x,
      back: back.x,
      backExpected: Math.max(card.x + 6, 112),
      nameCentre: name.x + name.w / 2,
      cardAxis: card.x + card.w / 2,
    };
    checks[`column_open_${size.width}`] = {
      shot: file,
      railStepsAside,
      runtime,
      rail,
      card,
      gaps,
      style: g.style,
      lipFollows,
      geometryOk,
      gapsOk,
    };
    expect(geometryOk).toBe(true);
    expect(gapsOk).toBe(true);
    expect(Math.abs(lip.x - card.x)).toBeLessThan(0.5);
    expect(back.x).toBe(lipFollows.backExpected);
    expect(Math.abs(lipFollows.nameCentre - lipFollows.cardAxis)).toBeLessThan(
      1,
    );
  });
}

test("column-open light: Paper, the same material as the rail's card", async ({
  page,
}) => {
  await openApp(page, { frame: true, colorScheme: "light" });
  await openRuntime(page);
  await page.waitForTimeout(SLIDE_MS + 200);
  const file = await shot(page, "column-open-light");
  const g = await geometry(page);
  const same =
    g.style.runtime?.background === g.style.rail?.background &&
    g.style.runtime?.shadow === g.style.rail?.shadow &&
    g.style.runtime?.radius === "10px";
  checks.column_open_light = { shot: file, style: g.style, ok: same };
  expect(same).toBe(true);
});

test("rail-closed: the card sits 4 from the places, the conversation's 4 past it", async ({
  page,
}) => {
  await openApp(page, { frame: true });
  await openRuntime(page);
  await page.waitForTimeout(SLIDE_MS + 200);
  const samples = await trace(page, () =>
    page.getByTestId("shell-lip-toggle").click(),
  );
  await page.waitForTimeout(200);
  const file = await shot(page, "rail-closed");
  const runtime = (await box(page, RUNTIME)) as Box;
  const card = (await conversationCard(page)) as Box;
  const lip = (await box(page, ".luca-lip-card")) as Box;
  const back = (await box(page, '[data-testid="global-back"]')) as Box;
  const moving = samples.filter(
    (s) => s.runtimeX !== null && s.runtimeX > PLACES + GAP && s.runtimeX < 268,
  ).length;
  const follow = Math.max(
    ...samples.map((s) =>
      s.runtimeX === null || s.runtimeW === null || s.cardX === null
        ? 0
        : Math.abs(s.cardX - (s.runtimeX + s.runtimeW + (s.runtimeGap ?? 0))),
    ),
  );
  checks.rail_closed = {
    shot: file,
    runtime,
    card,
    lip,
    back,
    placesToRuntime: runtime.x - PLACES,
    runtimeToCard: card.x - (runtime.x + runtime.w),
    framesInMotion: moving,
    cardFollowsRuntimeMaxDelta: follow,
    ok:
      runtime.x === PLACES + GAP &&
      card.x === runtime.x + runtime.w + GAP &&
      Math.abs(lip.x - card.x) < 0.5 &&
      back.x === Math.max(card.x + 6, 112),
  };
  writeFileSync(
    path.join(dir, "trace-rail-close.json"),
    JSON.stringify(samples, null, 1),
  );
  expect(runtime.x).toBe(PLACES + GAP);
  expect(card.x).toBe(runtime.x + runtime.w + GAP);
  expect(Math.abs(lip.x - card.x)).toBeLessThan(0.5);
  expect(moving).toBeGreaterThan(5);
  expect(follow).toBeLessThan(1);

  // And open again, with the rail closed: it comes from the places' edge.
  await page.getByRole("button", { name: /^Close .* sessions$/ }).click();
  await page.waitForTimeout(SLIDE_MS + 200);
  await expect(page.locator(RUNTIME)).toHaveCount(0);
});

test("motion: opens and closes on the rail's slide; the lip follows the card", async ({
  page,
}) => {
  await openApp(page, { frame: true });
  const opening = await trace(page, () => openRuntime(page));
  await page.waitForTimeout(100);
  const closing = await trace(page, () =>
    page.getByRole("button", { name: /^Close .* sessions$/ }).click(),
  );
  writeFileSync(
    path.join(dir, "trace-open.json"),
    JSON.stringify(opening, null, 1),
  );
  writeFileSync(
    path.join(dir, "trace-close.json"),
    JSON.stringify(closing, null, 1),
  );
  const summarise = (samples: Sample[], opening: boolean) => {
    const present = samples.filter((s) => s.runtimeW !== null);
    const partial = present.filter(
      (s) => (s.runtimeW ?? 0) > 1 && (s.runtimeW ?? 0) < CARD_WIDTH - 1,
    );
    const first = partial[0];
    const last = partial[partial.length - 1];
    const widths = present.map((s) => s.runtimeW ?? 0);
    const monotonic = widths.every((w, i) =>
      i === 0
        ? true
        : opening
          ? w >= widths[i - 1] - 0.01
          : w <= widths[i - 1] + 0.01,
    );
    const cardFollow = Math.max(
      0,
      ...present.map((s) =>
        s.cardX === null || s.runtimeX === null || s.runtimeW === null
          ? 0
          : Math.abs(s.cardX - (s.runtimeX + s.runtimeW + (s.runtimeGap ?? 0))),
      ),
    );
    const lipDelta = samples.map((s) =>
      s.cardX === null || s.lipX === null ? 0 : Math.abs(s.lipX - s.cardX),
    );
    const lipLagFrames = lipDelta.filter((d) => d > 2).length;
    return {
      frames: samples.length,
      framesInMotion: partial.length,
      motionSpanMs: first && last ? last.t - first.t : 0,
      monotonic,
      cardFollowsRuntimeMaxDelta: Math.round(cardFollow * 100) / 100,
      lipMaxDelta: Math.round(Math.max(...lipDelta) * 100) / 100,
      lipFramesOver2px: lipLagFrames,
      endsAt: samples[samples.length - 1],
    };
  };
  const open = summarise(opening, true);
  await expect(page.locator(RUNTIME)).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = "#/agents";
  });
  await expect(
    page.locator("[data-runtime-connection-key]").first(),
  ).toBeVisible({ timeout: 20000 });
  await openRuntime(page);
  await page.waitForTimeout(SLIDE_MS + 100);
  const transition = await page.evaluate((selector) => {
    const card = document.querySelector(selector);
    const style = card ? getComputedStyle(card) : null;
    return {
      duration: style?.transitionDuration,
      curve: style?.transitionTimingFunction,
      property: style?.transitionProperty,
    };
  }, RUNTIME);
  await page.getByRole("button", { name: /^Close .* sessions$/ }).click();
  const close = summarise(closing, false);
  await expect(page.locator(RUNTIME)).toHaveCount(0);

  // Reduce Motion: instant both ways.
  const reduced = await page.context().newPage();
  await openApp(reduced, { frame: true, reducedMotion: "reduce" });
  const reducedOpen = await trace(reduced, () => openRuntime(reduced), 300);
  const reducedClose = await trace(
    reduced,
    () => reduced.getByRole("button", { name: /^Close .* sessions$/ }).click(),
    300,
  );
  const reducedPartial = [...reducedOpen, ...reducedClose].filter(
    (s) => s.runtimeW !== null && s.runtimeW > 1 && s.runtimeW < CARD_WIDTH - 1,
  ).length;
  const closedImmediately =
    reducedClose.filter((s) => s.clicked && s.runtimeW !== null).length <= 1;
  await reduced.close();

  checks.motion = {
    transition,
    open,
    close,
    reducedMotion: { partialFrames: reducedPartial, closedImmediately },
    ok:
      open.framesInMotion > 10 &&
      close.framesInMotion > 10 &&
      open.monotonic &&
      close.monotonic &&
      open.cardFollowsRuntimeMaxDelta < 1 &&
      close.cardFollowsRuntimeMaxDelta < 1 &&
      reducedPartial === 0 &&
      closedImmediately,
  };
  checks.lip_follows = {
    ...(checks.lip_follows as object),
    openLipMaxDelta: open.lipMaxDelta,
    openLipFramesOver2px: open.lipFramesOver2px,
    closeLipMaxDelta: close.lipMaxDelta,
    closeLipFramesOver2px: close.lipFramesOver2px,
  };
  expect(open.framesInMotion).toBeGreaterThan(10);
  expect(close.framesInMotion).toBeGreaterThan(10);
  expect(open.monotonic && close.monotonic).toBe(true);
  expect(open.motionSpanMs).toBeLessThan(520);
  expect(close.motionSpanMs).toBeLessThan(520);
  expect(transition).toEqual({
    duration: "0.46s, 0.46s",
    curve: "cubic-bezier(0.32, 0.72, 0, 1), cubic-bezier(0.32, 0.72, 0, 1)",
    property: "width, margin",
  });
  expect(open.cardFollowsRuntimeMaxDelta).toBeLessThan(1);
  expect(close.cardFollowsRuntimeMaxDelta).toBeLessThan(1);
  expect(reducedPartial).toBe(0);
  expect(closedImmediately).toBe(true);
});

test("open from the Agents page: the slide starts once New conversation has painted", async ({
  page,
}) => {
  await openApp(page, { frame: true });
  await page.waitForTimeout(500);
  const samples = await trace(page, () => openRuntime(page), 900);
  writeFileSync(
    path.join(dir, "trace-open-from-agents.json"),
    JSON.stringify(samples, null, 1),
  );
  const mounted = samples.findIndex((s) => s.runtimeW !== null);
  const moving = samples.findIndex(
    (s) => s.runtimeW !== null && s.runtimeW > 0.5,
  );
  const firstShare =
    (samples[moving].runtimeW ?? 0) /
    CARD_WIDTH; /* from nothing: the frame before it is at 0 */
  let maxGapFirst150 = 0;
  let maxShare = 0;
  for (let i = moving; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (b.t - samples[moving].t <= 150) {
      maxGapFirst150 = Math.max(maxGapFirst150, b.t - a.t);
    }
    if (a.runtimeW !== null && b.runtimeW !== null) {
      maxShare = Math.max(maxShare, (b.runtimeW - a.runtimeW) / CARD_WIDTH);
    }
  }
  const lipOff = Math.max(
    ...samples.map((s) =>
      s.cardX === null || s.lipX === null ? 0 : Math.abs(s.lipX - s.cardX),
    ),
  );
  checks.open_from_agents = {
    mountedAt: samples[mounted].t,
    firstMovingAt: samples[moving].t,
    framesHeldAtNothing: moving - mounted,
    gapBeforeFirstMovingFrame: samples[moving].t - samples[moving - 1].t,
    firstMovingFrameShare: Math.round(firstShare * 1000) / 1000,
    maxFrameShare: Math.round(maxShare * 1000) / 1000,
    maxFrameGapFirst150Ms: maxGapFirst150,
    lipMaxOffConversationCard: Math.round(lipOff * 100) / 100,
    endsAt: samples[samples.length - 1].runtimeW,
  };
  expect(moving - mounted).toBeGreaterThan(0);
  expect(firstShare).toBeLessThanOrEqual(0.2);
  // Started on a steady frame, not across the route's long one.
  expect(samples[moving].t - samples[moving - 1].t).toBeLessThan(34);
  expect(maxGapFirst150).toBeLessThan(50);
  expect(lipOff).toBeLessThan(1);
  expect(samples[samples.length - 1].runtimeW).toBe(CARD_WIDTH);
});

test("text zoom: back, forward and the name keep to the conversation card", async ({
  page,
}) => {
  await openApp(page, { frame: true });
  await openRuntime(page);
  await page.waitForTimeout(SLIDE_MS + 300);
  const steps: Record<string, unknown>[] = [];
  const read = async (label: string) => {
    const card = (await conversationCard(page)) as Box;
    const runtime = (await box(page, RUNTIME)) as Box;
    const lip = (await box(page, ".luca-lip-card")) as Box;
    const back = (await box(page, '[data-testid="global-back"]')) as Box;
    const name = (await box(page, '[data-testid="shell-lip-name"]')) as Box;
    const font = await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    );
    const step = {
      label,
      font,
      runtimeW: runtime.w,
      cardX: card.x,
      lipOff: Math.round((lip.x - card.x) * 100) / 100,
      backOff: Math.round((back.x - Math.max(card.x + 6, 112)) * 100) / 100,
      nameOff:
        Math.round((name.x + name.w / 2 - (card.x + card.w / 2)) * 100) / 100,
    };
    steps.push(step);
    return step;
  };
  await read("100%");
  await page.keyboard.press("Meta+Equal");
  await page.waitForTimeout(SLIDE_MS + 300);
  await read("110%");
  await shot(page, "zoom-110-open");
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Meta+Equal");
  await page.waitForTimeout(SLIDE_MS + 300);
  await read("150%");
  await shot(page, "zoom-150-open");
  await page.keyboard.press("Meta+0");
  await page.waitForTimeout(SLIDE_MS + 300);
  await read("Meta+0");
  checks.text_zoom = { steps };
  for (const step of steps) {
    expect(Math.abs(step.lipOff as number)).toBeLessThan(0.5);
    expect(Math.abs(step.backOff as number)).toBeLessThan(0.5);
    expect(Math.abs(step.nameOff as number)).toBeLessThan(1);
  }
  expect(steps.map((step) => step.font)).toEqual([
    "16px",
    "17.6px",
    "24px",
    "16px",
  ]);
});

test("smallest window: the rail steps aside for the card and comes back with it", async ({
  page,
}) => {
  await openApp(page, { frame: true, size: { width: 800, height: 500 } });
  const railState = () =>
    page.evaluate(() =>
      document.querySelector("[data-frame]")?.getAttribute("data-state"),
    );
  const before = await railState();
  await openRuntime(page);
  await page.waitForTimeout(SLIDE_MS + 300);
  const open = {
    rail: await railState(),
    runtime: (await box(page, RUNTIME)) as Box,
    card: (await conversationCard(page)) as Box,
    name: (await box(page, '[data-testid="shell-lip-name"]')) as Box,
  };
  // The open state is column-open-800's shot.
  await page.getByRole("button", { name: /^Close .* sessions$/ }).click();
  await page.waitForTimeout(SLIDE_MS + 300);
  const closed = {
    rail: await railState(),
    card: (await conversationCard(page)) as Box,
  };
  const closedFile = await shot(page, "smallest-closed-800");
  // The owner opening the rail again while the card is open is kept.
  await page.evaluate(() => {
    window.location.hash = "#/agents";
  });
  await expect(
    page.locator("[data-runtime-connection-key]").first(),
  ).toBeVisible({ timeout: 20000 });
  await openRuntime(page);
  await page.waitForTimeout(SLIDE_MS + 300);
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(SLIDE_MS + 300);
  await page.setViewportSize({ width: 801, height: 500 });
  await page.waitForTimeout(300);
  const kept = await railState();
  const keptFile = await shot(page, "smallest-owner-reopened-800");
  checks.smallest_window = {
    openShot: path.join(dir, "column-open-800.png"),
    ownerReopenedShot: keptFile,
    closedShot: closedFile,
    before,
    open,
    conversationCardWidth: open.card.w,
    closed,
    ownerReopenedKept: kept,
    ok:
      before === "expanded" &&
      open.rail === "collapsed" &&
      open.card.w >= 24 * 16 &&
      open.name.w > 0 &&
      closed.rail === "expanded" &&
      kept === "expanded",
  };
  expect(before).toBe("expanded");
  expect(open.rail).toBe("collapsed");
  expect(open.runtime.x).toBe(PLACES + GAP);
  expect(open.card.w).toBeGreaterThanOrEqual(24 * 16);
  expect(open.name.w).toBeGreaterThan(0);
  expect(closed.rail).toBe("expanded");
  expect(closed.card.x).toBe(PLACES + RAIL + GAP);
  expect(kept).toBe("expanded");
});

test("by day on the glass: the card is in the shell's card list, its shadow on the floor", async ({
  page,
}) => {
  await openApp(page, { frame: true, colorScheme: "light" });
  // The frosted glass, which the mock can draw once it is told it is the app.
  await page.addInitScript(() => {
    window.localStorage.setItem("polyphonic-frame", "glass");
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
  await page.reload();
  await expect(
    page.locator("[data-runtime-connection-key]").first(),
  ).toBeVisible({ timeout: 20000 });
  await openRuntime(page);
  await page.waitForTimeout(SLIDE_MS + 300);
  const file = await shot(page, "day-glass-open");
  const day = await page.evaluate(() => {
    const shadows = [
      ...document.querySelectorAll<HTMLElement>("[data-luca-frame-shadow]"),
    ].map((s) => ({
      left: s.style.left,
      width: s.style.width,
      opacity: s.style.opacity,
    }));
    const card = document.querySelector("[data-luca-runtime-card]");
    return {
      glass: document.documentElement.getAttribute("data-luca-frame-glass"),
      shadows,
      runtimeBoxShadow: card ? getComputedStyle(card).boxShadow : null,
    };
  });
  checks.day_card_list = { shot: file, ...day };
  expect(day.glass).toBe("frosted");
  expect(day.shadows).toContainEqual({
    left: "268px",
    width: "352px",
    opacity: "1",
  });
  expect(day.shadows).toHaveLength(3);
  expect(day.runtimeBoxShadow).toBe("none");
});

test("narrow: under 768 it is a sheet, as today", async ({ browser, page }) => {
  await openApp(page, { frame: true, size: { width: 700, height: 600 } });
  await openRuntime(page);
  const sheet = page.getByTestId("runtime-sessions-panel-mobile");
  await expect(sheet).toBeVisible();
  const file = await shot(page, "narrow");
  const cards = await page.locator(RUNTIME).count();
  const sheetBox = await sheet.boundingBox();
  // As today: the branch's starting point, frame on, the same way.
  let reachable = true;
  try {
    reachable = (await fetch(HEAD_URL)).ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    checks.narrow = {
      shot: file,
      sheet: sheetBox,
      framedCards: cards,
      asToday: { ran: false, reason: `${HEAD_URL} unreachable` },
      ok: cards === 0,
    };
    expect(cards).toBe(0);
    return;
  }
  const baseContext = await browser.newContext({ deviceScaleFactor: 2 });
  const base = await baseContext.newPage();
  await openApp(base, {
    frame: true,
    origin: HEAD_URL,
    size: { width: 700, height: 600 },
  });
  await openRuntime(base);
  await expect(base.getByTestId("runtime-sessions-panel-mobile")).toBeVisible();
  await settle(base);
  const baseFile = path.join(dir, "narrow-base.png");
  await base.screenshot({ path: baseFile });
  const baseSheet = await base
    .getByTestId("runtime-sessions-panel-mobile")
    .boundingBox();
  await baseContext.close();
  checks.narrow = {
    shot: file,
    baseShot: baseFile,
    sheet: sheetBox,
    baseSheet,
    sameAsBase: sha(file) === sha(baseFile),
    framedCards: cards,
    ok: cards === 0 && JSON.stringify(sheetBox) === JSON.stringify(baseSheet),
  };
  expect(cards).toBe(0);
  expect(sheetBox).toEqual(baseSheet);
});

test("flag off: the column draws exactly the base build", async ({
  browser,
}) => {
  let reachable = true;
  try {
    const response = await fetch(BASE_URL);
    reachable = response.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    checks.flag_off_identical = {
      ran: false,
      reason: `${BASE_URL} unreachable`,
    };
    test.skip(true, "base build unreachable");
    return;
  }
  const pairs: Record<string, { ours: string; base: string; same: boolean }> =
    {};
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    for (const [label, origin] of [
      ["ours", ""],
      ["base", BASE_URL],
    ] as const) {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await openApp(page, { frame: false, origin, route: "", size });
      await openRuntime(page);
      await expect(page.getByTestId("runtime-sessions-panel")).toBeVisible();
      await page.mouse.move(size.width - 2, size.height - 2);
      await shot(page, `flag-off-open-${size.width}-${label}`);
      await page.getByRole("button", { name: /^Close .* sessions$/ }).click();
      await expect(page.getByTestId("runtime-sessions-panel")).toHaveCount(0);
      await page.mouse.move(size.width - 2, size.height - 2);
      await shot(page, `flag-off-closed-${size.width}-${label}`);
      await context.close();
    }
    for (const state of ["open", "closed"]) {
      const ours = path.join(dir, `flag-off-${state}-${size.width}-ours.png`);
      const base = path.join(dir, `flag-off-${state}-${size.width}-base.png`);
      pairs[`${state}-${size.width}`] = {
        ours: sha(ours),
        base: sha(base),
        same: sha(ours) === sha(base),
      };
    }
  }
  const same = Object.values(pairs).every((pair) => pair.same);
  checks.flag_off_identical = { ran: true, pairs, ok: same };
  expect(same).toBe(true);
});
