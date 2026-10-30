import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * The frame by day (docs/luca/rail-system/SHELL_BUILD.md, WP-06): Paper's
 * floor, the cards' shadows on it, no outlines, the frame's words, a chosen
 * option standing up, the composer, Send and search, other light palettes;
 * dark and the flag off unchanged, by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks go (else the test's output
 * folder). SHELL_STUDY_URL: the shell study's page, built from
 * scripts/shell-lab.template.html (the reference for the shadows' pixels);
 * unreachable, the comparison is reported as not run. SHELL_BASE_URL: the
 * base build for the flag-off comparison (default 127.0.0.1:4300).
 * SHELL_START_URL: this branch's own starting point, for dark with the flag
 * on and a second flag-off comparison.
 */

const STUDY_URL = process.env.SHELL_STUDY_URL ?? "";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const START_URL = process.env.SHELL_START_URL ?? "";
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };
type Rgb = [number, number, number];

const RAIL_CARD = '[data-testid="app-sidebar"] [data-sidebar="sidebar"]';
const CONVERSATION_CARD =
  '[data-testid="conversation-workspace-grid"] [data-luca-card]';
const SETTINGS_CARD =
  "[data-luca-settings-card-host] > [data-luca-conversation-surface]";
/** The one card beneath the rail and what it opens (WP-12): the card that
 *  casts the shadow, in every place. */
const ONE_CARD = "[data-luca-one-card]";
const ROUTE_CARD =
  "[data-luca-floor-host] > [data-luca-conversation-surface]:not(:has([data-luca-workspace-floor]))";

// Each spec writes to its own folder under SHELL_SHOTS, so its hash checks
// compare its own shots and no other spec's (WP-28, Decided 6).
const SHELL_SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "shell-light")
  : undefined;

function shotsDir(fallback: string) {
  const dir = SHELL_SHOTS ?? fallback;
  mkdirSync(dir, { recursive: true });
  return dir;
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const reachable = (url: string) =>
  url
    ? fetch(url)
        .then((response) => response.ok)
        .catch(() => false)
    : Promise.resolve(false);

async function openApp(
  page: Page,
  {
    frame = true,
    scheme = "light",
    theme = "paper",
    origin = "",
    size = { width: 1440, height: 900 },
  }: {
    frame?: boolean;
    scheme?: "light" | "dark";
    theme?: string;
    origin?: string;
    size?: { width: number; height: number };
  } = {},
) {
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[console] ${message.text()}`);
  });
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme });
  await installMockBridge(page);
  // After the bridge's own seed, so this one decides the frame and palette.
  await page.addInitScript(
    ({ key, on, theme }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (theme) {
        localStorage.setItem("buzz-theme", theme);
        localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frame, theme },
  );
  await page.goto(`${origin}/?e2e=mock`);
}

async function openGeneral(page: Page, { frame = true } = {}) {
  if (!frame) {
    await page.getByTestId("channel-general").click({ timeout: 20_000 });
    await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible({
      timeout: 20_000,
    });
    return;
  }
  await page.waitForSelector('[data-testid="app-sidebar"] [data-channel-id]', {
    timeout: 20_000,
  });
  await expect(async () => {
    await page.evaluate((id) => {
      location.hash = `#/channels/${id}`;
    }, GENERAL_CHANNEL_ID);
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible({
    timeout: 20_000,
  });
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

async function shot(page: Page, dir: string, name: string) {
  await page.mouse.move(1, 899);
  await page.waitForTimeout(600);
  await settle(page);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

/** A token resolved to the rgb the page paints it as. */
async function tokenRgb(page: Page, value: string): Promise<Rgb> {
  return page.evaluate((v) => {
    const probe = document.createElement("i");
    probe.style.color = v;
    document.body.append(probe);
    const parts = getComputedStyle(probe).color.match(/[\d.]+/g) ?? [];
    probe.remove();
    return parts.slice(0, 3).map(Number) as [number, number, number];
  }, value);
}

/** Pixels of a screenshot, in device pixels, read back in the page. */
async function pixels(page: Page, file: string, points: [number, number][]) {
  const b64 = readFileSync(file).toString("base64");
  return page.evaluate(
    async ({ b64, points }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) return [];
      context.drawImage(bitmap, 0, 0);
      return points.map(([x, y]) => {
        const d = context.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      });
    },
    { b64, points },
  );
}

const grey = (rgb: Rgb) => Math.round((rgb[0] + rgb[1] + rgb[2]) / 3);
const near = (a: Rgb, b: Rgb, tolerance = 2) =>
  a.every((value, index) => Math.abs(value - b[index]) <= tolerance);

/**
 * The light that falls around the conversation card, in device pixels: the
 * twelve rows under its bottom edge, the gap between the rail's card and it,
 * and the twelve columns right of it, each at the card's middle. The study
 * is drawn at the same grid, so the two can be compared pixel for pixel.
 */
function profilePoints(card: Box, rail: Box | null, scale = 2) {
  const midX = Math.round((card.x + card.w / 2) * scale);
  const midY = Math.round((card.y + card.h / 2) * scale);
  const bottom = Math.round((card.y + card.h) * scale);
  const right = Math.round((card.x + card.w) * scale);
  const below: [number, number][] = [];
  const beside: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    below.push([midX, bottom + i]);
    beside.push([right + i, midY]);
  }
  const gap: [number, number][] = [];
  if (rail) {
    const from = Math.round((rail.x + rail.w) * scale);
    const to = Math.round(card.x * scale);
    for (let x = from; x < to; x++) gap.push([x, midY]);
  }
  return { below, beside, gap };
}

async function profile(page: Page, file: string, card: Box, rail: Box | null) {
  const points = profilePoints(card, rail);
  const [below, beside, gap] = await Promise.all([
    pixels(page, file, points.below),
    pixels(page, file, points.beside),
    pixels(page, file, points.gap),
  ]);
  return {
    below: below.map(grey),
    beside: beside.map(grey),
    gap: gap.map(grey),
  };
}

const maxDiff = (a: number[], b: number[]) =>
  a.length === b.length
    ? Math.max(0, ...a.map((value, index) => Math.abs(value - b[index])))
    : Number.POSITIVE_INFINITY;

/** The study in light, Paper, at a size: its screenshot and its profile. */
async function studyProfile(
  browser: Browser,
  dir: string,
  size: { width: number; height: number },
) {
  if (!(await reachable(STUDY_URL))) return null;
  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: 2,
    viewport: size,
  });
  const page = await context.newPage();
  await page.goto(
    `${STUDY_URL}?experience=shell&mode=light&frame=solid&cards=one`,
    {
      timeout: 30_000,
    },
  );
  await page.waitForSelector(".shell-card", { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const file = path.join(dir, `study-light-${size.width}x${size.height}.png`);
  await page.screenshot({ path: file });
  const card = await box(page, ".shell-card");
  const rail = await box(page, ".shell-rail");
  const result =
    card && rail
      ? { file, card, rail, profile: await profile(page, file, card, rail) }
      : null;
  await context.close();
  return result;
}

/** What paints a card's edge: its own shadow and border. */
async function edges(page: Page, selector: string) {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      border: `${style.borderTopWidth} ${style.borderTopColor}`,
      background: style.backgroundColor,
    };
  }, selector);
}

const noEdge = (edge: Awaited<ReturnType<typeof edges>>) =>
  !!edge &&
  edge.boxShadow === "none" &&
  (edge.border.startsWith("0px") || edge.border.endsWith("rgba(0, 0, 0, 0)"));

/** The shadow layer: shown, one shadow per card, each where its card is. */
async function shadowLayer(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(
      "[data-luca-frame-shadows]",
    );
    if (!layer) return null;
    return {
      display: getComputedStyle(layer).display,
      shadows: [
        ...layer.querySelectorAll<HTMLElement>("[data-luca-frame-shadow]"),
      ].map((shadow) => {
        const r = shadow.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          opacity: Number(getComputedStyle(shadow).opacity),
          boxShadow: getComputedStyle(shadow).boxShadow,
        };
      }),
    };
  });
}

type Layer = NonNullable<Awaited<ReturnType<typeof shadowLayer>>>;

const casts = (layer: Layer | null, card: Box | null) =>
  !!layer &&
  !!card &&
  layer.shadows.some(
    (shadow) =>
      Math.abs(shadow.x - card.x) < 0.5 &&
      Math.abs(shadow.y - card.y) < 0.5 &&
      Math.abs(shadow.w - card.w) < 0.5 &&
      Math.abs(shadow.h - card.h) < 0.5 &&
      shadow.opacity === 1,
  );

const PAPER_SHADOW =
  "rgba(21, 22, 27, 0.06) 0px 1px 2px 0px, rgba(21, 22, 27, 0.14) 0px 12px 32px -8px";

/** The floor where nothing stands: the places column's foot, the lip's
 *  middle, and the 4 between the cards at the top (above their shadows). */
function floorPoints(card: Box) {
  // The window's left floor, the lip over the card, and the places'
  // column just short of the one card's left edge (one card, WP-12: there
  // is no floor between the rail and the conversation any more).
  return [
    [10, 1200],
    [Math.round((card.x + card.w / 2) * 2), 6],
    [Math.round((44 - 2) * 2), 74],
  ] as [number, number][];
}

/** A card's inside, just within its top and left edges: no white lit top,
 *  no ring. */
function insidePoints(card: Box) {
  const x = Math.round((card.x + card.w / 2) * 2);
  const y = Math.round((card.y + card.h / 2) * 2);
  return [
    [x, Math.round(card.y * 2)],
    [x, Math.round(card.y * 2) + 1],
    [Math.round(card.x * 2), y],
    [Math.round(card.x * 2) + 1, y],
  ] as [number, number][];
}

async function colour(page: Page, selector: string) {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    return element ? getComputedStyle(element).color : null;
  }, selector);
}

/** A css colour as the page resolves it. */
async function resolved(page: Page, value: string) {
  return page.evaluate((v) => {
    const probe = document.createElement("i");
    probe.style.color = v;
    document.body.append(probe);
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
  }, value);
}

/** WCAG contrast of a css colour (blended over the ground if it has alpha)
 *  against an opaque ground. */
function contrast(css: string | null, ground: Rgb) {
  const parts = css?.match(/[\d.]+/g)?.map(Number) ?? [];
  if (parts.length < 3) return 0;
  const alpha = parts[3] ?? 1;
  const text = [0, 1, 2].map(
    (i) => parts[i] * alpha + ground[i] * (1 - alpha),
  ) as Rgb;
  const luminance = (rgb: Rgb) => {
    const [r, g, b] = rgb.map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high, low] = [luminance(text), luminance(ground)].sort(
    (a, b) => b - a,
  );
  return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
}

/** Puts keyboard focus on an element by Tab, so :focus-visible holds, and
 *  reads what it draws. */
async function keyboardFocus(page: Page, selector: string) {
  const target = page.locator(selector).first();
  await target.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  return target.evaluate((element) => ({
    id: element.getAttribute("data-testid"),
    focused: document.activeElement === element,
    focusVisible: element.matches(":focus-visible"),
    boxShadow: getComputedStyle(element).boxShadow,
    outline: getComputedStyle(element).outlineStyle,
  }));
}

/** A background the shell computes, read the way an element's own is. */
async function backgroundOf(page: Page, css: string) {
  return page.evaluate((value) => {
    const probe = document.createElement("i");
    probe.style.backgroundColor = value;
    document.body.append(probe);
    const result = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return result;
  }, css);
}

async function inkAt(page: Page, alpha: number) {
  return page.evaluate((a) => {
    const probe = document.createElement("i");
    probe.style.color = `hsl(var(--mn-ink) / ${a})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, alpha);
}

test("Paper by day, 1440 × 900", async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];
  const study = await studyProfile(browser, dir, { width: 1440, height: 900 });

  await openApp(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-frame",
    "solid",
    { timeout: 20_000 },
  );
  await openGeneral(page);
  const conversation = await shot(page, dir, "conversation");
  files.push(conversation);
  const DAY_PILL = '[data-testid="message-timeline-day-divider"] > p';
  const dayPill = await edges(page, DAY_PILL);
  const dayPillBox = await box(page, DAY_PILL);

  const recess = await tokenRgb(page, "hsl(var(--mn-recess))");
  const floor = await tokenRgb(page, "hsl(var(--mn-floor))");
  const surface = await tokenRgb(page, "hsl(var(--mn-surface))");
  // The rail's tone on the card by day (WP-34, Decided 7): the paper's
  // recess at 15% over the surface.
  const railTone = surface.map((value, index) =>
    Math.round(value * 0.85 + recess[index] * 0.15),
  ) as Rgb;
  const rail = await box(page, RAIL_CARD);
  const card = await box(page, CONVERSATION_CARD);
  expect(rail && card).toBeTruthy();
  if (!rail || !card) return;

  // ── the floor ────────────────────────────────────────────────────
  const floorPixels = await pixels(page, conversation, floorPoints(card));
  const cardPixels = await pixels(page, conversation, [
    [Math.round((rail.x + rail.w / 2) * 2), 1400],
    [Math.round((card.x + card.w - 40) * 2), 1400],
  ]);
  const rootBackground = await page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  );
  checks.floor_recess = {
    recess,
    palette_floor: floor,
    surface,
    root_background: rootBackground,
    floor_pixels: floorPixels,
    card_pixels: cardPixels,
    rail_tone: railTone,
    ok:
      floorPixels.every((pixel) => near(pixel, recess)) &&
      near(cardPixels[0], railTone) &&
      near(cardPixels[1], surface),
  };

  // ── no outlines ───────────────────────────────────────────────────
  const railEdge = await edges(page, RAIL_CARD);
  const cardEdge = await edges(page, CONVERSATION_CARD);
  const inside = await pixels(page, conversation, [
    ...insidePoints(rail),
    ...insidePoints(card),
  ]);

  // ── the shadows ───────────────────────────────────────────────────
  const layer = await shadowLayer(page);
  const oneCard = await box(page, ONE_CARD);
  const ours = await profile(page, conversation, card, rail);
  const studyDiff = study
    ? {
        below: maxDiff(ours.below, study.profile.below),
        beside: maxDiff(ours.beside, study.profile.beside),
        gap: maxDiff(ours.gap, study.profile.gap),
      }
    : "not run";

  // ── the frame's words ─────────────────────────────────────────────
  const ink = await inkAt(page, 1);
  const muted = await inkAt(page, 0.84);
  const faint = await inkAt(page, 0.66);
  const words = {
    lip_name: await colour(page, '[data-testid="shell-lip-name"]'),
    lip_toggle: await colour(page, '[data-testid="shell-lip-toggle"]'),
    lip_forward_disabled: await colour(page, '[data-testid="global-forward"]'),
    lip_details: await colour(page, '[data-testid="shell-lip-details"]'),
    place: await colour(page, '[data-testid="open-artifacts-view"]'),
    place_current: await colour(
      page,
      '[data-testid="shell-place-conversations"]',
    ),
    section_label: await colour(
      page,
      "[data-shell-rail] .luca-rail-section-head",
    ),
  };
  // The section labels are the card's words, not the frame's: the palette's
  // own faint, tuned for contrast on its own surface.
  const cardFaint = await resolved(page, "hsl(var(--mn-ink-faint))");
  const forwardDisabled = await page.getByTestId("global-forward").isDisabled();
  checks.frame_words = {
    expected: { ink, muted, faint, section_label: cardFaint },
    measured: words,
    section_label_contrast: contrast(words.section_label, surface),
    ok:
      words.lip_name === ink &&
      words.lip_toggle === muted &&
      words.lip_details === muted &&
      (!forwardDisabled || words.lip_forward_disabled === faint) &&
      words.place === muted &&
      words.place_current === ink &&
      words.section_label === cardFaint &&
      contrast(words.section_label, surface) >= 4.5,
  };

  // ── where you are, by day ─────────────────────────────────────────
  const plate = await inkAt(page, 0.075);
  // Where you are is the places' sliding mark (WP-03), not the tile itself.
  const placeCurrent = await edges(
    page,
    '[data-testid="shell-places"] .luca-mark--place',
  );
  const railPill = await edges(page, "[data-frame] .luca-rail-glass");
  const railPillRim = await page.evaluate(() => {
    const pill = document.querySelector("[data-frame] .luca-rail-glass");
    return pill
      ? [
          getComputedStyle(pill, "::before").display,
          getComputedStyle(pill, "::after").display,
        ]
      : null;
  });

  // ── the composer and Send ─────────────────────────────────────────
  // At rest: the conversation focuses its composer as it opens.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(200);
  const composer = await edges(page, '[data-testid="message-composer"]');
  const send = await edges(page, '[data-testid="send-message"]');
  const sendDisabled = await page.getByTestId("send-message").isDisabled();
  await page.getByTestId("message-input").click();
  const composerFocused = await edges(page, '[data-testid="message-composer"]');
  await page.keyboard.type("Hello");
  // The disc arms on a transition (composer-states.css); read it settled,
  // not part-way (on the GPU the read lands at about 40% of the way).
  await waitForAnimations(page);
  const sendArmed = await edges(page, '[data-testid="send-message"]');
  const act = await tokenRgb(page, "hsl(var(--mn-act))");
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.locator("body").click({ position: { x: 700, y: 500 } });
  files.push(await shot(page, dir, "composer-armed-cleared"));

  // ── search ────────────────────────────────────────────────────────
  await page
    .getByTestId("shell-place-search")
    .locator("button")
    .first()
    .click();
  await expect(page.getByTestId("search-results")).toBeVisible({
    timeout: 10_000,
  });
  const SEARCH_CHOSEN = '[data-testid="search-results"] [aria-selected="true"]';
  await expect(page.locator(SEARCH_CHOSEN).first()).toBeVisible({
    timeout: 10_000,
  });
  const searchShot = await shot(page, dir, "search");
  files.push(searchShot);
  const searchChosen = await edges(page, SEARCH_CHOSEN);
  const searchChosenBox = await box(page, SEARCH_CHOSEN);
  const searchPanelBox = await box(page, '[data-testid="search-results"]');
  const searchChosenPixels =
    searchChosenBox && searchPanelBox
      ? await pixels(page, searchShot, [
          [
            Math.round((searchChosenBox.x + searchChosenBox.w - 6) * 2),
            Math.round((searchChosenBox.y + 4) * 2),
          ],
          [
            Math.round((searchPanelBox.x + searchPanelBox.w - 6) * 2),
            Math.round((searchPanelBox.y + searchPanelBox.h - 6) * 2),
          ],
        ])
      : [];
  const scrim = await edges(page, '[data-testid="dialog-overlay"]');
  const searchPanel = await edges(page, '[data-testid="search-results"]');
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search-results")).toHaveCount(0);

  const studyValues = {
    // The composer by day: a step darker than the paper, nothing drawn round
    // it at rest or in focus (Riley, 2026-10-27 and 28); Send at rest a quiet
    // disc of ink on it.
    composer_background: await backgroundOf(
      page,
      "color-mix(in srgb, hsl(var(--mn-surface)) 94%, hsl(var(--mn-ink)))",
    ),
    composer_shadow: "none",
    composer_focus_shadow: "none",
    send_background: await inkAt(page, 0.07),
    send_shadow: "none",
    scrim: await inkAt(page, 0.1),
    search_shadow: `${await inkAt(page, 0.1)} 0px 0px 0px 0.5px, ${await inkAt(page, 0.28)} 0px 24px 64px -12px`,
    search_chosen: await inkAt(page, 0.08),
  };
  const surfaceCss = `rgb(${surface.join(", ")})`;
  checks.composer_send_search = {
    expected: studyValues,
    composer,
    composer_focused: composerFocused,
    send_disarmed: { disabled: sendDisabled, ...send },
    send_armed: { ...sendArmed, act },
    scrim,
    search_panel: searchPanel,
    search_chosen: searchChosen,
    search_chosen_vs_panel_pixels: searchChosenPixels,
    ok:
      composer?.background === studyValues.composer_background &&
      composer?.boxShadow === studyValues.composer_shadow &&
      composerFocused?.boxShadow === studyValues.composer_focus_shadow &&
      sendDisabled &&
      send?.background === studyValues.send_background &&
      send?.boxShadow === studyValues.send_shadow &&
      sendArmed?.background === `rgb(${act.join(", ")})` &&
      scrim?.background === studyValues.scrim &&
      searchPanel?.boxShadow === studyValues.search_shadow &&
      searchChosen?.background === studyValues.search_chosen &&
      searchChosenPixels.length === 2 &&
      grey(searchChosenPixels[1]) - grey(searchChosenPixels[0]) >= 12,
  };

  // ── the rail closing: the one card's shadow holds still (WP-12) ──
  const fade = await page.evaluate(
    () =>
      new Promise<number[][]>((resolve) => {
        const samples: number[][] = [];
        const start = performance.now();
        (
          document.querySelector(
            '[data-testid="shell-lip-toggle"]',
          ) as HTMLElement
        ).click();
        const step = () => {
          const t = performance.now() - start;
          const card = document
            .querySelector(
              '[data-testid="app-sidebar"] [data-sidebar="sidebar"]',
            )
            ?.getBoundingClientRect();
          const shadows = [
            ...document.querySelectorAll<HTMLElement>(
              "[data-luca-frame-shadow]",
            ),
          ].map((shadow) => shadow.getBoundingClientRect());
          // The rail's shadow starts at the places' edge and is never wider
          // than its card (the conversation card's starts there too once
          // the rail is closed, at its full width).
          const railShadow = [
            ...document.querySelectorAll<HTMLElement>(
              "[data-luca-frame-shadow]",
            ),
          ].find((shadow) => {
            const r = shadow.getBoundingClientRect();
            return Math.abs(r.x - 44) < 0.5 && r.width <= 220.5;
          });
          samples.push([
            Math.round(t),
            card?.width ?? 0,
            railShadow ? railShadow.getBoundingClientRect().width : -1,
            railShadow ? Number(getComputedStyle(railShadow).opacity) : -1,
            shadows.length,
          ]);
          if (t < 700) requestAnimationFrame(step);
          else resolve(samples);
        };
        requestAnimationFrame(step);
      }),
  );
  const railClosed = await shot(page, dir, "rail-closed");
  files.push(railClosed);
  const closedLayer = await shadowLayer(page);
  const closedCard = await box(page, CONVERSATION_CARD);
  // The rail lies on the one card and casts nothing: the shadow under the
  // places' edge is the one card's, its full width and strength in every
  // frame, the only one, while the rail narrows to nothing.
  const closedOne = await box(page, ONE_CARD);
  const full = fade.filter(([, , width]) => width >= 0);
  checks.rail_shadow_fade = {
    samples: fade.length,
    first: fade[0],
    mid: fade[Math.floor(fade.length / 2)],
    last: fade.at(-1),
    rail_casts_nothing: fade.every(([, , width]) => width === -1),
    one_shadow_every_frame: fade.every(([, , , , count]) => count === 1),
    closed_shadows: closedLayer?.shadows.length,
    closed_card_casts: casts(closedLayer, closedOne),
    conversation_card: closedCard,
    ok:
      fade.length > 3 &&
      full.length === 0 &&
      fade.every(([, , , , count]) => count === 1) &&
      closedLayer?.shadows.length === 1 &&
      casts(closedLayer, closedOne),
  };
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(700);

  // ── a right card ──────────────────────────────────────────────────
  await page.getByTestId("shell-lip-details").click();
  const rightCardSelector = "[data-luca-right-cards] [data-luca-card]";
  await expect(page.locator(rightCardSelector).first()).toBeVisible({
    timeout: 10_000,
  });
  const rightShot = await shot(page, dir, "right-card");
  files.push(rightShot);
  const rightCard = await box(page, rightCardSelector);
  const rightEdge = await edges(page, rightCardSelector);
  const rightLayer = await shadowLayer(page);
  const rightInside = rightCard
    ? await pixels(page, rightShot, insidePoints(rightCard))
    : [];
  const rightBelow = rightCard
    ? await pixels(page, rightShot, [
        [
          Math.round((rightCard.x + rightCard.w / 2) * 2),
          Math.round((rightCard.y + rightCard.h) * 2) + 1,
        ],
      ])
    : [];
  await page.getByTestId("shell-lip-details").click();

  // ── a place: Library ──────────────────────────────────────────────
  await page.getByTestId("open-artifacts-view").click();
  await expect(page.getByTestId("artifact-library-screen")).toBeVisible({
    timeout: 20_000,
  });
  const library = await shot(page, dir, "library");
  files.push(library);
  const placeCard = await box(page, ROUTE_CARD);
  const libraryOne = await box(page, ONE_CARD);
  const placeEdge = await edges(page, ROUTE_CARD);
  const libraryLayer = await shadowLayer(page);
  const libraryFloor = placeCard
    ? await pixels(page, library, floorPoints(placeCard))
    : [];
  const placeInside = placeCard
    ? await pixels(page, library, insidePoints(placeCard))
    : [];

  // ── Settings → Appearance ─────────────────────────────────────────
  await page.getByTestId("open-settings-view").click();
  await page.getByTestId("settings-nav-appearance").click({ timeout: 20_000 });
  await expect(page.getByTestId("settings-panel-appearance")).toBeVisible({
    timeout: 20_000,
  });
  const settings = await shot(page, dir, "settings-appearance");
  files.push(settings);
  const listCard = await box(
    page,
    '[data-luca-settings-list] [data-sidebar="sidebar"]',
  );
  const panelsCard = await box(page, SETTINGS_CARD);
  const settingsOne = await box(page, ONE_CARD);
  const settingsLayer = await shadowLayer(page);
  const settingsFloor = panelsCard
    ? await pixels(page, settings, floorPoints(panelsCard))
    : [];
  // Settings' list wears the rail's sliding mark on its current row
  // (WP-09a), so the plate is the mark, and the row paints none of its own.
  // The mark's springs are no CSS animation: wait for it to come to rest
  // and dry (marks.ts: a moving plate is darker by its --wet).
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .querySelector<HTMLElement>(
                '[data-testid="shell-settings-marks"] > .luca-mark:last-child',
              )
              ?.style.getPropertyValue("--wet") ?? null,
        ),
      { timeout: 10_000 },
    )
    .toBe("0.000");
  const settingsRowCurrent = await edges(
    page,
    '[data-testid="shell-settings-marks"] > .luca-mark:last-child',
  );
  const settingsRowOwn = await edges(page, ".luca-settings-row[data-current]");
  const groupLabel = await colour(page, ".luca-settings-group-head");
  const modeRow = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-luca-settings-frame] [data-testid^="appearance-mode-"]',
      ),
    ].map((button) => ({
      id: button.getAttribute("data-testid"),
      pressed: button.getAttribute("aria-pressed") === "true",
      background: getComputedStyle(button).backgroundColor,
      boxShadow: getComputedStyle(button).boxShadow,
      border: getComputedStyle(button).borderTopColor,
    })),
  );
  await page
    .locator(
      '[data-luca-settings-frame] [data-testid^="appearance-mode-"]:not([aria-pressed="true"])',
    )
    .first()
    .hover();
  await page.waitForTimeout(250);
  const modeHover = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(
      '[data-luca-settings-frame] [data-testid^="appearance-mode-"]:not([aria-pressed="true"])',
    );
    return button ? getComputedStyle(button).backgroundColor : null;
  });
  // Taken with the pointer still on the unchosen option (shot() moves it).
  await settle(page);
  const modeHoverShot = path.join(dir, "settings-mode-hover.png");
  await page.screenshot({ path: modeHoverShot });
  files.push(modeHoverShot);
  const segments = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-luca-settings-frame] fieldset.rounded-full > button[aria-pressed="true"]',
      ),
    ].map((button) => ({
      id: button.getAttribute("data-testid"),
      background: getComputedStyle(button).backgroundColor,
      boxShadow: getComputedStyle(button).boxShadow,
      track: getComputedStyle(button.parentElement as HTMLElement)
        .backgroundColor,
    })),
  );
  // The segments further down the panel, in view.
  await page
    .getByTestId("message-text-default")
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);
  files.push(await shot(page, dir, "settings-appearance-segments"));

  // A chosen option keeps its keyboard ring in front of its paper.
  const chosenSelectors = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-luca-settings-frame] :is(fieldset.rounded-full > button, [data-testid^="appearance-mode-"])[aria-pressed="true"]',
      ),
    ]
      .map((button) => button.getAttribute("data-testid"))
      .filter((id): id is string => !!id),
  );
  const focusRings = [];
  for (const id of chosenSelectors) {
    focusRings.push(await keyboardFocus(page, `[data-testid="${id}"]`));
  }
  // The picture: the Mode row's chosen Light, focused by keyboard (in a
  // browser the Frame row is a statement, not a control: WP-05b).
  await page
    .locator('[data-testid="appearance-mode-light"]')
    .scrollIntoViewIfNeeded();
  await keyboardFocus(page, '[data-testid="appearance-mode-light"]');
  files.push(await shot(page, dir, "settings-chosen-focused"));
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

  // Under the glass by day (set by hand: a headless browser has no real
  // glass), Settings' card host clears like every other floor layer.
  const glassSettingsHost = await page.evaluate(async () => {
    const root = document.documentElement;
    const before = root.getAttribute("data-luca-frame-glass");
    root.setAttribute("data-luca-frame-glass", "liquid");
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const host = document.querySelector("[data-luca-settings-card-host]");
    const result = {
      root: getComputedStyle(root).backgroundColor,
      host: host ? getComputedStyle(host).backgroundColor : null,
    };
    if (before === null) root.removeAttribute("data-luca-frame-glass");
    else root.setAttribute("data-luca-frame-glass", before);
    return result;
  });
  checks.glass_settings_host = {
    ...glassSettingsHost,
    ok:
      glassSettingsHost.root === "rgba(0, 0, 0, 0)" &&
      glassSettingsHost.host === "rgba(0, 0, 0, 0)",
  };

  const track = await inkAt(page, 0.06);
  // The solid composer removed Send's shadow, not the selected Settings
  // segment's paper elevation (shell-light.css). Keep these independent.
  const selectionShadow = `${await inkAt(page, 0.22)} 0px 0.5px 1px 0px, ${await inkAt(page, 0.1)} 0px 1px 3px 0px`;
  checks.chosen_stands_up = {
    selection_shadow: selectionShadow,
    plate,
    place_current: placeCurrent,
    rail_current_pill: railPill,
    rail_pill_rim: railPillRim,
    settings_row_current: settingsRowCurrent,
    settings_row_own: settingsRowOwn,
    segments,
    mode_row: modeRow,
    mode_unchosen_hover: modeHover,
    focus_rings: focusRings,
    ok:
      placeCurrent?.background === plate &&
      placeCurrent.boxShadow === "none" &&
      (!railPill ||
        (railPill.background === plate &&
          railPill.boxShadow === "none" &&
          railPillRim?.every((display) => display === "none"))) &&
      settingsRowCurrent?.background === plate &&
      settingsRowCurrent.boxShadow === "none" &&
      settingsRowOwn?.background === "rgba(0, 0, 0, 0)" &&
      segments.length >= 3 &&
      segments.every(
        (segment) =>
          segment.background === surfaceCss &&
          segment.boxShadow.endsWith(selectionShadow) &&
          !segment.boxShadow.includes("0px 0px 0px 2px") &&
          segment.track === track,
      ) &&
      modeRow.length === 3 &&
      modeRow.every(
        (mode) =>
          mode.border === "rgba(0, 0, 0, 0)" &&
          (!mode.pressed ||
            (mode.background === surfaceCss &&
              mode.boxShadow.endsWith(selectionShadow))),
      ) &&
      modeHover === track &&
      focusRings.length >= 4 &&
      focusRings.every(
        (ring) =>
          ring.focused &&
          ring.focusVisible &&
          /0px 0px 0px 2px/.test(ring.boxShadow) &&
          ring.boxShadow.endsWith(selectionShadow),
      ),
  };

  checks.settings_group_label = {
    colour: groupLabel,
    expected: cardFaint,
    contrast: contrast(groupLabel, surface),
    ok: groupLabel === cardFaint && contrast(groupLabel, surface) >= 4.5,
  };
  const dayPillPixels = dayPillBox
    ? await pixels(page, conversation, [
        [
          Math.round((dayPillBox.x + dayPillBox.w / 2) * 2),
          Math.round(dayPillBox.y * 2) - 1,
        ],
        [
          Math.round((dayPillBox.x + dayPillBox.w / 2) * 2),
          Math.round(dayPillBox.y * 2),
        ],
        [
          Math.round((dayPillBox.x + dayPillBox.w / 2) * 2),
          Math.round(dayPillBox.y * 2) + 1,
        ],
        [
          Math.round((dayPillBox.x + dayPillBox.w / 2) * 2),
          Math.round(dayPillBox.y * 2) + 3,
        ],
      ])
    : [];
  const dayPillShadow = `${await inkAt(page, 0.1)} 0px 1px 2px 0px, ${await inkAt(page, 0.12)} 0px 4px 12px -2px`;
  checks.no_outlines = {
    day_pill: { ...dayPill, expected: dayPillShadow, pixels: dayPillPixels },
    rail: railEdge,
    conversation: cardEdge,
    right_card: rightEdge,
    place_card: placeEdge,
    inside_pixels: {
      conversation: inside,
      right_card: rightInside,
      place_card: placeInside,
      surface,
    },
    ok:
      noEdge(railEdge) &&
      noEdge(cardEdge) &&
      noEdge(rightEdge) &&
      noEdge(placeEdge) &&
      dayPill?.boxShadow === dayPillShadow &&
      dayPillPixels.length === 4 &&
      // no white lit top: the row just inside is no brighter than the pill
      grey(dayPillPixels[2]) <= grey(dayPillPixels[3]) + 1 &&
      // The rail's four points carry its tone; everything else is the
      // surface.
      inside.slice(0, 4).every((pixel) => near(pixel, railTone)) &&
      [...inside.slice(4), ...rightInside, ...placeInside].every((pixel) =>
        near(pixel, surface),
      ),
  };

  checks.card_shadows = {
    layer: layer
      ? { display: layer.display, count: layer.shadows.length }
      : null,
    paper_values: layer?.shadows[0]?.boxShadow,
    // One card (WP-12): the rail and the conversation lie on it, and it
    // casts the one shadow; in Library and in Settings too.
    one_card_casts: casts(layer, oneCard),
    rail_casts: casts(layer, rail),
    conversation_casts: casts(layer, card),
    right_card_casts: casts(rightLayer, rightCard),
    right_card_pixel_below: rightBelow,
    place_card_casts: casts(libraryLayer, libraryOne),
    library_floor: libraryFloor,
    settings_list_casts: casts(settingsLayer, listCard),
    settings_one_card_casts: casts(settingsLayer, settingsOne),
    settings_floor: settingsFloor,
    profile_ours: ours,
    profile_study: study?.profile ?? "not run",
    max_grey_diff_vs_study: studyDiff,
    ok:
      layer?.display === "block" &&
      layer.shadows.every((shadow) => shadow.boxShadow === PAPER_SHADOW) &&
      layer.shadows.length === 1 &&
      casts(layer, oneCard) &&
      !casts(layer, rail) &&
      !casts(layer, card) &&
      casts(rightLayer, rightCard) &&
      rightBelow.every((pixel) => grey(pixel) < grey(recess) - 4) &&
      casts(libraryLayer, libraryOne) &&
      !casts(settingsLayer, listCard) &&
      casts(settingsLayer, settingsOne) &&
      settingsLayer?.shadows.length === 1 &&
      [...libraryFloor, ...settingsFloor].every((pixel) =>
        near(pixel, recess),
      ) &&
      ours.below[0] < grey(recess) - 10 &&
      (typeof studyDiff === "string" ||
        Math.max(studyDiff.below, studyDiff.beside, studyDiff.gap) <= 4),
  };

  checks.screenshots = files.map((file) => ({ file, sha256: sha(file) }));
  if (study) checks.study_shot = study.file;
  writeFileSync(
    path.join(dir, "checks-paper.json"),
    JSON.stringify(checks, null, 2),
  );
  for (const key of [
    "floor_recess",
    "no_outlines",
    "card_shadows",
    "rail_shadow_fade",
    "frame_words",
    "chosen_stands_up",
    "composer_send_search",
    "settings_group_label",
    "glass_settings_host",
  ]) {
    expect.soft((checks[key] as { ok: boolean }).ok, key).toBe(true);
  }
});

test("Paper by day, 800 × 500", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  const size = { width: 800, height: 500 };
  const study = await studyProfile(browser, dir, size);
  await openApp(page, { size });
  await openGeneral(page);
  const file = await shot(page, dir, "conversation-800x500");
  const recess = await tokenRgb(page, "hsl(var(--mn-recess))");
  const surface = await tokenRgb(page, "hsl(var(--mn-surface))");
  // The rail's tone by day (WP-34, Decided 7), as at 1440.
  const railTone = surface.map((value, index) =>
    Math.round(value * 0.85 + recess[index] * 0.15),
  ) as Rgb;
  const rail = await box(page, RAIL_CARD);
  const card = await box(page, CONVERSATION_CARD);
  expect(rail && card).toBeTruthy();
  if (!rail || !card) return;
  const layer = await shadowLayer(page);
  const oneCard = await box(page, ONE_CARD);
  const ours = await profile(page, file, card, rail);
  const floor = await pixels(page, file, [
    [10, 900],
    [Math.round((card.x + card.w / 2) * 2), 6],
  ]);
  const inside = await pixels(page, file, [
    ...insidePoints(rail),
    ...insidePoints(card),
  ]);
  const diff = study
    ? {
        below: maxDiff(ours.below, study.profile.below),
        beside: maxDiff(ours.beside, study.profile.beside),
        gap: maxDiff(ours.gap, study.profile.gap),
      }
    : "not run";
  const result = {
    file,
    sha256: sha(file),
    card,
    floor,
    inside,
    layer: layer?.shadows.length,
    profile_ours: ours,
    profile_study: study?.profile ?? "not run",
    max_grey_diff_vs_study: diff,
    ok:
      floor.every((pixel) => near(pixel, recess)) &&
      inside.slice(0, 4).every((pixel) => near(pixel, railTone)) &&
      inside.slice(4).every((pixel) => near(pixel, surface)) &&
      layer?.shadows.length === 1 &&
      casts(layer, oneCard) &&
      (typeof diff === "string" ||
        Math.max(diff.below, diff.beside, diff.gap) <= 4),
  };
  writeFileSync(
    path.join(dir, "checks-small.json"),
    JSON.stringify({ small_window: result }, null, 2),
  );
  expect(result.ok).toBe(true);
});

test("other light palettes", async ({ page }, info) => {
  test.setTimeout(300_000);
  const dir = shotsDir(info.outputPath());
  const result: Record<string, unknown> = {};
  for (const theme of [
    "github-light",
    "catppuccin-latte",
    "solarized-light",
    "everforest-light",
    "gruvbox-light-hard",
    "github-light-high-contrast",
  ]) {
    const context = await page.context().browser()?.newContext({
      deviceScaleFactor: 2,
    });
    if (!context) continue;
    const themed = await context.newPage();
    await openApp(themed, { theme });
    await openGeneral(themed);
    const file = await shot(themed, dir, `palette-${theme}`);
    const recess = await tokenRgb(themed, "hsl(var(--mn-recess))");
    const surface = await tokenRgb(themed, "hsl(var(--mn-surface))");
    // The rail's tone by day (WP-34, Decided 7): the recess at 15%.
    const railTone = surface.map((value, index) =>
      Math.round(value * 0.85 + recess[index] * 0.15),
    ) as Rgb;
    const rail = await box(themed, RAIL_CARD);
    const card = await box(themed, CONVERSATION_CARD);
    const layer = await shadowLayer(themed);
    const oneCard = await box(themed, ONE_CARD);
    const floor = card ? await pixels(themed, file, floorPoints(card)) : [];
    const inside =
      rail && card
        ? await pixels(themed, file, [
            ...insidePoints(rail),
            ...insidePoints(card),
          ])
        : [];
    const below =
      card && rail ? (await profile(themed, file, card, rail)).below : [];
    const label = await colour(
      themed,
      "[data-shell-rail] .luca-rail-section-head",
    );
    const labelFaint = await resolved(themed, "hsl(var(--mn-ink-faint))");
    const labelContrast = contrast(label, surface);
    result[theme] = {
      file,
      recess,
      surface,
      floor,
      inside,
      below,
      section_label: label,
      section_label_contrast: labelContrast,
      ok:
        label === labelFaint &&
        labelContrast >= 4.5 &&
        floor.every((pixel) => near(pixel, recess)) &&
        inside.slice(0, 4).every((pixel) => near(pixel, railTone)) &&
        inside.slice(4).every((pixel) => near(pixel, surface)) &&
        layer?.shadows.length === 1 &&
        casts(layer, oneCard) &&
        below[0] < grey(recess) - 6,
    };
    await context.close();
  }
  writeFileSync(
    path.join(dir, "checks-palettes.json"),
    JSON.stringify({ other_palettes: result }, null, 2),
  );
  for (const [theme, value] of Object.entries(result)) {
    expect.soft((value as { ok: boolean }).ok, theme).toBe(true);
  }
});

/** Captures a build's conversation, Library and Settings → Appearance with
 *  its clock held at one minute and Reduce Motion on, so two builds can be
 *  compared by hash. */
async function captureForHash(
  browser: Browser,
  dir: string,
  origin: string,
  label: string,
  { frame, scheme }: { frame: boolean; scheme: "light" | "dark" },
) {
  // A busy machine sometimes leaves a load blank or drops a lazy screen's
  // chunk: the whole capture is tried again in a fresh context, up to three
  // times, before anything is called broken.
  for (let attempt = 1; ; attempt++) {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    try {
      await context.clock.install({ time: new Date("2026-10-25T09:30:00") });
      const page = await context.newPage();
      // Light is Paper; dark is the app's own default palette.
      const theme = scheme === "light" ? "paper" : "";
      await openApp(page, { frame, scheme, theme, origin });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await openGeneral(page, { frame });
      const prefix = `${frame ? "flag-on" : "flag-off"}-${scheme}`;
      const conversation = await shot(
        page,
        dir,
        `${prefix}-conversation${label}`,
      );
      await page.getByTestId("open-artifacts-view").click();
      await expect(page.getByTestId("artifact-library-screen")).toBeVisible({
        timeout: 20_000,
      });
      const library = await shot(page, dir, `${prefix}-library${label}`);
      await page.getByTestId("open-settings-view").click();
      if (frame) {
        await page.getByTestId("settings-nav-appearance").click({
          timeout: 20_000,
        });
        await expect(page.getByTestId("settings-panel-appearance")).toBeVisible(
          { timeout: 20_000 },
        );
      } else {
        await expect(
          page.getByRole("heading", { name: "Profile", exact: true }),
        ).toBeVisible({ timeout: 20_000 });
      }
      const settings = await shot(page, dir, `${prefix}-settings${label}`);
      return { conversation, library, settings };
    } catch (error) {
      if (attempt >= 3) throw error;
      console.log(`[retry] ${origin} ${scheme}: ${String(error).slice(0, 80)}`);
    } finally {
      await context.close();
    }
  }
}

async function compare(
  browser: Browser,
  dir: string,
  ourOrigin: string,
  baseOrigin: string,
  options: { frame: boolean; scheme: "light" | "dark" },
  label: string,
) {
  const ours = await captureForHash(browser, dir, ourOrigin, "", options);
  const base = await captureForHash(browser, dir, baseOrigin, label, options);
  const result: Record<string, unknown> = {};
  for (const key of ["conversation", "library", "settings"] as const) {
    result[key] = {
      ours: sha(ours[key]),
      base: sha(base[key]),
      identical: sha(ours[key]) === sha(base[key]),
    };
  }
  return result;
}

const allIdentical = (result: Record<string, unknown>) =>
  Object.values(result).every(
    (value) => (value as { identical: boolean }).identical,
  );

test("dark with the flag on is unchanged", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const dir = shotsDir(info.outputPath());
  test.skip(
    !(await reachable(START_URL)),
    `this branch's start not reachable at ${START_URL || "(unset)"}`,
  );
  const result = await compare(
    browser,
    dir,
    info.project.use.baseURL ?? "",
    START_URL,
    { frame: true, scheme: "dark" },
    "-start",
  );
  writeFileSync(
    path.join(dir, "checks-dark.json"),
    JSON.stringify({ dark_unchanged: { against: START_URL, result } }, null, 2),
  );
  expect(allIdentical(result)).toBe(true);
});

test("the flag off draws the base exactly", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const dir = shotsDir(info.outputPath());
  const out: Record<string, unknown> = {};
  for (const [name, origin] of [
    ["base", BASE_URL],
    ["start", START_URL],
  ] as const) {
    if (!(await reachable(origin))) {
      out[name] = `not run: ${origin || "(unset)"} unreachable`;
      continue;
    }
    for (const scheme of ["light", "dark"] as const) {
      out[`${name}-${scheme}`] = {
        against: origin,
        result: await compare(
          browser,
          dir,
          info.project.use.baseURL ?? "",
          origin,
          { frame: false, scheme },
          `-${name}`,
        ),
      };
    }
  }
  writeFileSync(
    path.join(dir, "checks-flag-off.json"),
    JSON.stringify({ flag_off_identical: out }, null, 2),
  );
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") continue;
    expect
      .soft(
        allIdentical((value as { result: Record<string, unknown> }).result),
        key,
      )
      .toBe(true);
  }
});
