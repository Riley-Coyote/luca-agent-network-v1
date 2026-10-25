import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * WP-08b, the status cards and their dots; the reconnecting card retires
 * (docs/luca/rail-system/SHELL_BUILD.md). The rail's footer cards sit at the
 * foot of the rail's card in its material; a closed rail says an update with
 * a dot on Settings; the reconnecting overlay never shows under the frame;
 * one source (app/shell/shellStatus.ts) for the cards and both dots; and the
 * flag off draws the base build exactly, overlay included.
 *
 * SHELL_SHOTS: where the screenshots and checks go. SHELL_BASE_URL: the base
 * build for the flag-off hashes (default http://127.0.0.1:4300).
 */

const SHOTS = process.env.SHELL_SHOTS ?? "test-results/shell-status";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const CONNECT_ERROR = "relay unreachable: could not connect to relay";
const AUTH_ERROR = "Relay authentication rejected.";
const RAIL = '[data-testid="app-sidebar"] [data-sidebar="sidebar"]';

type Mock = Parameters<typeof installMockBridge>[1];
type Box = { x: number; y: number; w: number; h: number };

test.use({ deviceScaleFactor: 2 });

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[console] ${message.text()}`);
  });
});

function dir() {
  mkdirSync(SHOTS, { recursive: true });
  return SHOTS;
}

function record(name: string, value: unknown) {
  writeFileSync(
    path.join(dir(), `checks-${name}.json`),
    JSON.stringify(value, null, 2),
  );
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

async function openApp(
  page: Page,
  {
    frame,
    mock = {},
    hash = "",
    origin = "",
    scheme = "dark",
    size = { width: 1440, height: 900 },
  }: {
    frame: boolean;
    mock?: Mock;
    hash?: string;
    origin?: string;
    scheme?: "dark" | "light";
    size?: { width: number; height: number };
  },
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme });
  await installMockBridge(page, mock);
  // Light is Paper, the frame's daytime palette.
  if (scheme === "light") {
    await page.addInitScript(() => localStorage.setItem("buzz-theme", "paper"));
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
  await page.goto(`${origin}/?e2e=mock${hash}`);
  // Generous: on a busy machine the first load is slow.
  await page.waitForSelector('[data-testid="app-sidebar"]', {
    timeout: 30_000,
  });
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await waitForAnimations(page, 2000);
}

async function shot(page: Page, name: string, clip?: Box) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await waitForAnimations(page);
  const file = path.join(dir(), `${name}.png`);
  await page.screenshot(
    clip
      ? {
          path: file,
          clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h },
        }
      : { path: file },
  );
  return file;
}

/** Drives the mock relay's state, once its own handshake has landed. */
async function setRelay(page: Page, state: string) {
  await page.waitForFunction(
    () => {
      const win = window as Window & {
        __BUZZ_E2E_GET_RELAY_CONNECTION_STATE__?: () => string;
      };
      return win.__BUZZ_E2E_GET_RELAY_CONNECTION_STATE__?.() === "connected";
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate((next) => {
    (
      window as Window & {
        __BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?: (s: string) => void;
      }
    ).__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.(next);
  }, state);
}

async function forceRelay(page: Page, state: string) {
  await page.evaluate((next) => {
    (
      window as Window & {
        __BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?: (s: string) => void;
      }
    ).__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.(next);
  }, state);
}

async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

async function railOpen(page: Page) {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-testid="app-sidebar"]');
    return rail ? getComputedStyle(rail).visibility !== "hidden" : false;
  });
}

async function closeRail(page: Page) {
  await page.getByTestId("shell-lip-toggle").click();
  await expect.poll(() => railOpen(page), { timeout: 5_000 }).toBe(false);
  await page.waitForTimeout(600);
}

async function openRail(page: Page) {
  await page.getByTestId("shell-lip-toggle").click();
  await expect.poll(() => railOpen(page), { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(600);
}

/** One footer card measured against the rail's card it sits in. */
async function cardInRail(page: Page, testId: string) {
  await settle(page);
  return page.evaluate(
    ({ id, rail }) => {
      const card = document.querySelector(`[data-testid="${id}"]`);
      const railCard = document.querySelector(rail);
      const footer = railCard?.querySelector('[data-sidebar="footer"]');
      if (!card || !railCard || !footer) return null;
      const face = card.querySelector("button") as HTMLElement;
      const c = card.getBoundingClientRect();
      const r = railCard.getBoundingClientRect();
      const style = getComputedStyle(face);
      const probe = document.createElement("div");
      probe.style.background = "var(--mn-plate)";
      railCard.appendChild(probe);
      const plate = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        in_footer: footer.contains(card),
        inside_rail_card:
          c.left >= r.left && c.right <= r.right && c.bottom <= r.bottom,
        inset: {
          left: +(c.left - r.left).toFixed(2),
          right: +(r.right - c.right).toFixed(2),
          bottom: +(r.bottom - c.bottom).toFixed(2),
        },
        top: +c.top.toFixed(2),
        background: style.backgroundColor,
        plate,
        wears_plate: style.backgroundColor === plate,
        border: style.borderTopColor,
        no_outline: style.borderTopColor === "rgba(0, 0, 0, 0)",
        shadow: style.boxShadow,
        radius: style.borderTopLeftRadius,
      };
    },
    { id: testId, rail: RAIL },
  );
}

/** The dot on the Settings tile, measured against the tile. */
async function updateDot(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    const tile = document.querySelector('[data-testid="open-settings-view"]');
    const dot = document.querySelector(
      '[data-testid="open-settings-view-update"]',
    );
    if (!tile) return null;
    if (!dot) return { shown: false, label: tile.getAttribute("aria-label") };
    const t = tile.getBoundingClientRect();
    const d = dot.getBoundingClientRect();
    const probe = document.createElement("div");
    probe.style.color = "hsl(var(--mn-signal))";
    document.body.appendChild(probe);
    const signal = getComputedStyle(probe).color;
    probe.remove();
    const background = getComputedStyle(dot).backgroundColor;
    const glyph = tile.querySelector("svg");
    return {
      shown: true,
      label: tile.getAttribute("aria-label"),
      size: { w: d.width, h: d.height },
      from_tile_right: +(t.right - d.right).toFixed(2),
      from_tile_top: +(d.top - t.top).toFixed(2),
      background,
      signal,
      is_signal: background === signal,
      gear: glyph ? getComputedStyle(glyph).color : null,
      gear_cut: glyph ? getComputedStyle(glyph).maskImage : null,
    };
  });
}

/** What the shell exports, as the places column reads it. */
async function exported(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('[data-testid="shell-places"]');
    return {
      connection_problem: nav?.hasAttribute("data-connection-problem") ?? null,
      update_available: nav?.hasAttribute("data-update-available") ?? null,
    };
  });
}

/** Anything the reconnecting overlay draws: its card, outside the rail. */
async function overlayShown(page: Page) {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-testid="app-sidebar"]');
    const cards = [
      ...document.querySelectorAll(
        '[data-testid="sidebar-relay-unreachable"], [data-testid="relay-error-overlay"]',
      ),
    ];
    return cards.some((card) => !rail?.contains(card));
  });
}

test("the status cards in the rail's card", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const checks: Record<string, unknown> = {};

  // The relay can't be reached and an update is staged: two cards.
  await openApp(page, {
    frame: true,
    mock: { channelsReadError: CONNECT_ERROR, updateAvailable: true },
  });
  await setRelay(page, "disconnected");
  await expect(page.getByTestId("sidebar-relay-unreachable")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  await page.mouse.move(1000, 500);
  const relay = await cardInRail(page, "sidebar-relay-unreachable");
  const update = await cardInRail(page, "sidebar-update-card");
  const rail = await box(page, RAIL);
  await shot(page, "cards-in-rail-relay-update");
  if (rail) {
    await shot(page, "cards-in-rail-relay-update-zoom", {
      x: rail.x - 8,
      y: rail.y + rail.h - 200,
      w: rail.w + 16,
      h: 208,
    });
  }
  // Under the pointer, the card's plate brightens a step.
  await page.getByTestId("sidebar-update-now").hover();
  await page.waitForTimeout(300);
  const hovered = await cardInRail(page, "sidebar-update-card");
  if (rail) {
    await shot(page, "cards-in-rail-hover-zoom", {
      x: rail.x - 8,
      y: rail.y + rail.h - 200,
      w: rail.w + 16,
      h: 208,
    });
  }
  await page.mouse.move(1000, 500);
  // Closed, they go with the card.
  await closeRail(page);
  const hiddenWithCard = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="sidebar-update-card"]');
    if (!card) return true;
    const r = card.getBoundingClientRect();
    return (
      getComputedStyle(card).visibility === "hidden" ||
      r.width === 0 ||
      r.right <= 44
    );
  });
  await shot(page, "cards-hidden-rail-closed");
  checks.relay_and_update = {
    rail,
    relay,
    update,
    update_hover_background: hovered?.background,
    order_ok: Boolean(relay && update && relay.top < update.top),
    hidden_with_card: hiddenWithCard,
  };

  // Paper: the same two cards, light (its own context, so its palette
  // stays its own).
  const lightContext = await browser.newContext({ deviceScaleFactor: 2 });
  const light = await lightContext.newPage();
  await openApp(light, {
    frame: true,
    scheme: "light",
    mock: { channelsReadError: CONNECT_ERROR, updateAvailable: true },
  });
  await setRelay(light, "disconnected");
  await expect(light.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect(light.getByTestId("sidebar-relay-unreachable")).toBeVisible({
    timeout: 20_000,
  });
  await light.mouse.move(1000, 500);
  checks.light = {
    relay: await cardInRail(light, "sidebar-relay-unreachable"),
    update: await cardInRail(light, "sidebar-update-card"),
  };
  await shot(light, "cards-in-rail-light");
  await lightContext.close();

  // The relay answered badly: the connection status card.
  const status = await page.context().newPage();
  await openApp(status, {
    frame: true,
    mock: { channelsReadError: AUTH_ERROR },
  });
  await expect(status.getByTestId("sidebar-connection-status")).toBeVisible({
    timeout: 20_000,
  });
  await status.mouse.move(1000, 500);
  checks.status = await cardInRail(status, "sidebar-connection-status");
  await shot(status, "cards-in-rail-status");
  await status.close();

  // A background task running (Brain connecting two sources, held open).
  const task = await page.context().newPage();
  await openApp(task, {
    frame: true,
    hash: "#/brain",
    mock: { connectedBrainConnectDelayMs: 60_000 },
  });
  await task
    .getByTestId("brain-card-repository")
    .getByRole("button", { name: "Details" })
    .click({ timeout: 20_000 });
  await task.getByRole("button", { name: "Connect sources" }).click();
  const dialog = task.getByTestId("brain-connection-dialog");
  await dialog.getByRole("button", { name: "Select all" }).click();
  await dialog.getByRole("button", { name: /Connect \d sources/ }).click();
  await task.keyboard.press("Escape");
  await expect(task.getByTestId("sidebar-background-task-card")).toBeVisible({
    timeout: 20_000,
  });
  await task.mouse.move(1000, 500);
  checks.task = await cardInRail(task, "sidebar-background-task-card");
  await shot(task, "cards-in-rail-task");
  await task.close();

  const all = [
    (checks.relay_and_update as { relay: unknown }).relay,
    (checks.relay_and_update as { update: unknown }).update,
    checks.status,
    checks.task,
  ] as ({
    in_footer: boolean;
    inside_rail_card: boolean;
    wears_plate: boolean;
    no_outline: boolean;
  } | null)[];
  checks.ok =
    all.every(
      (c) =>
        c?.in_footer && c.inside_rail_card && c.wears_plate && c.no_outline,
    ) &&
    (checks.relay_and_update as { order_ok: boolean }).order_ok &&
    (checks.relay_and_update as { hidden_with_card: boolean }).hidden_with_card;
  record("cards-in-rail", checks);
  expect(checks.ok).toBe(true);
});

test("an available update is a dot on Settings while the rail is closed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openApp(page, { frame: true, mock: { updateAvailable: true } });
  await expect(page.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  const checks: Record<string, unknown> = {};
  checks.rail_open = await updateDot(page);
  await closeRail(page);
  await page.mouse.move(1000, 500);
  checks.rail_closed = await updateDot(page);
  checks.exported = await exported(page);
  await shot(page, "update-dot");
  const tile = await box(page, '[data-testid="open-settings-view"]');
  if (tile) {
    await shot(page, "update-dot-zoom", {
      x: 0,
      y: tile.y - 40,
      w: 120,
      h: tile.h + 80,
    });
  }
  // In Settings the rail's card holds the sections, so the dot still says it.
  await page.getByTestId("open-settings-view").click();
  await expect(
    page.getByRole("heading", { name: "Profile", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(1000, 500);
  checks.in_settings = await updateDot(page);
  await shot(page, "update-dot-in-settings");
  // Back to Conversations, which opens a closed rail: the card says it,
  // the dot goes.
  await page.getByTestId("shell-place-conversations").click();
  await page.waitForSelector('[data-testid="app-sidebar"]', {
    state: "attached",
    timeout: 20_000,
  });
  await page.waitForTimeout(1000);
  if (!(await railOpen(page))) await openRail(page);
  await expect(page.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  checks.reopened = await updateDot(page);
  // One source: dismissing the card takes the dot with it.
  await page.getByTestId("sidebar-update-card").hover();
  await page.getByTestId("sidebar-update-dismiss").click();
  await expect(page.getByTestId("sidebar-update-card")).toHaveCount(0, {
    timeout: 5_000,
  });
  await closeRail(page);
  checks.dismissed_rail_closed = await updateDot(page);
  checks.dismissed_exported = await exported(page);
  record("update-dot", checks);

  type Dot = {
    shown: boolean;
    label: string;
    size?: { w: number; h: number };
    from_tile_right?: number;
    from_tile_top?: number;
    is_signal?: boolean;
  };
  const closed = checks.rail_closed as Dot;
  expect((checks.rail_open as Dot).shown).toBe(false);
  expect(closed.shown).toBe(true);
  expect(closed.label).toBe("Settings, update available");
  expect(closed.size).toEqual({ w: 6, h: 6 });
  expect(closed.from_tile_right).toBe(4);
  expect(closed.from_tile_top).toBe(4);
  expect(closed.is_signal).toBe(true);
  expect((checks.in_settings as Dot).shown).toBe(true);
  expect((checks.reopened as Dot).shown).toBe(false);
  expect((checks.dismissed_rail_closed as Dot).shown).toBe(false);
  expect((checks.dismissed_rail_closed as Dot).label).toBe("Settings");
});

test("the reconnecting card never shows under the frame", async ({ page }) => {
  test.setTimeout(90_000);
  const checks: Record<string, unknown> = {};
  await openApp(page, {
    frame: true,
    mock: { channelsReadError: CONNECT_ERROR },
  });
  await closeRail(page);
  checks.before = await exported(page);
  await setRelay(page, "disconnected");
  await page.waitForTimeout(1200);
  await page.mouse.move(1000, 500);
  checks.relay_down_rail_closed = {
    overlay: await overlayShown(page),
    exported: await exported(page),
  };
  await shot(page, "reconnecting");
  const places = await box(page, '[data-testid="shell-places"]');
  if (places) {
    await shot(page, "reconnecting-places-foot", {
      x: 0,
      y: places.y + places.h - 220,
      w: 340,
      h: 220,
    });
  }
  // Opening the rail shows its card there.
  await openRail(page);
  await expect(page.getByTestId("sidebar-relay-unreachable")).toBeVisible();
  checks.rail_open = {
    card_in_rail: await page.evaluate(() =>
      Boolean(
        document
          .querySelector('[data-testid="app-sidebar"]')
          ?.querySelector('[data-testid="sidebar-relay-unreachable"]'),
      ),
    ),
    exported: await exported(page),
  };
  await page.mouse.move(1000, 500);
  await shot(page, "reconnecting-rail-open");
  // Back: the card says "Connected", and that is no problem.
  await forceRelay(page, "connected");
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E__?: { mock?: { channelsReadError?: string } };
    };
    delete testWindow.__BUZZ_E2E__?.mock?.channelsReadError;
  });
  await expect(page.getByTestId("sidebar-relay-unreachable")).toContainText(
    "Connected",
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
  checks.reconnected = await exported(page);

  // The relay answered badly, rail closed: no fallback overlay either.
  const auth = await page.context().newPage();
  await openApp(auth, { frame: true, mock: { channelsReadError: AUTH_ERROR } });
  await closeRail(auth);
  await setRelay(auth, "disconnected");
  await auth.waitForTimeout(1200);
  checks.auth_rail_closed = {
    overlay: await overlayShown(auth),
    exported: await exported(auth),
  };
  await auth.close();
  record("reconnecting", checks);

  const down = checks.relay_down_rail_closed as {
    overlay: boolean;
    exported: { connection_problem: boolean };
  };
  expect(
    (checks.before as { connection_problem: boolean }).connection_problem,
  ).toBe(false);
  expect(down.overlay).toBe(false);
  expect(down.exported.connection_problem).toBe(true);
  expect((checks.rail_open as { card_in_rail: boolean }).card_in_rail).toBe(
    true,
  );
  expect(
    (checks.reconnected as { connection_problem: boolean }).connection_problem,
  ).toBe(false);
  const auth_ = checks.auth_rail_closed as {
    overlay: boolean;
    exported: { connection_problem: boolean };
  };
  expect(auth_.overlay).toBe(false);
  expect(auth_.exported.connection_problem).toBe(true);
});

async function captureFlagOff(browser: Browser, origin: string, label: string) {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.clock.install({ time: new Date("2026-10-25T18:30:00") });
  const files: Record<string, string> = {};
  const overlay: Record<string, boolean> = {};

  // The reconnecting card: relay down, rail closed.
  const page = await context.newPage();
  await openApp(page, {
    frame: false,
    origin,
    mock: { channelsReadError: CONNECT_ERROR },
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await setRelay(page, "disconnected");
  await expect(page.getByTestId("sidebar-relay-unreachable")).toBeVisible({
    timeout: 20_000,
  });
  // The conversation's card shows its loading state after a beat; let it
  // arrive in both builds before the picture.
  await page.waitForTimeout(2000);
  await page.mouse.move(1439, 899);
  files.relay_rail_open = await shot(page, `flag-off-relay-rail-open${label}`);
  await page.keyboard.press("Meta+s");
  await expect(page.locator('[data-testid="app-sidebar"]'))
    .toHaveAttribute("data-state", "collapsed", { timeout: 5_000 })
    .catch(() => undefined);
  await page.waitForTimeout(900);
  await page.mouse.move(1439, 899);
  overlay.shown = await overlayShown(page);
  files.relay_rail_closed = await shot(page, `flag-off-overlay${label}`);
  await page.close();

  // The update card, rail open.
  const update = await context.newPage();
  await openApp(update, {
    frame: false,
    origin,
    mock: { updateAvailable: true },
  });
  await update.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(update.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  await update.waitForTimeout(600);
  await update.mouse.move(1439, 899);
  files.update = await shot(update, `flag-off-update${label}`);
  await update.close();
  await context.close();
  return { files, overlay };
}

test("flag off draws the base build exactly, overlay and all", async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, `base build not reachable at ${BASE_URL}`);
  const ours = await captureFlagOff(
    browser,
    info.project.use.baseURL ?? "",
    "",
  );
  const base = await captureFlagOff(browser, BASE_URL, "-base");
  const result: Record<string, unknown> = {
    overlay_shown_ours: ours.overlay.shown,
    overlay_shown_base: base.overlay.shown,
  };
  for (const key of Object.keys(ours.files)) {
    result[key] = {
      ours: sha(ours.files[key]),
      base: sha(base.files[key]),
      identical: sha(ours.files[key]) === sha(base.files[key]),
    };
  }
  record("flag-off", result);
  expect(ours.overlay.shown).toBe(true);
  for (const key of Object.keys(ours.files)) {
    expect
      .soft((result[key] as { identical: boolean }).identical, key)
      .toBe(true);
  }
});

// ── the review's fixes: focus, the dot's colour and cut, the motion, the
// grid and the text scale ───────────────────────────────────────────────

const FOOT_CARDS = [
  "sidebar-connection-status",
  "sidebar-relay-unreachable",
  "sidebar-background-task-card",
  "sidebar-update-card",
];

/** WCAG contrast of two computed rgb() colours (alpha ignored). */
function contrast(a: string, b: string) {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? ["0", "0", "0"])
      .slice(0, 3)
      .map((v) => {
        const x = Number(v) / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

/** CIE76 ΔE between two computed rgb() colours (sRGB, D65). */
function labDistance(a: string, b: string) {
  const lab = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? ["0", "0", "0"])
      .slice(0, 3)
      .map((v) => {
        const x = Number(v) / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number) =>
      t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const [p, q] = [lab(a), lab(b)];
  return +Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]).toFixed(1);
}

/** Tabs until the element with this test id has keyboard focus; returns
 * how many presses it took (-1 if never) and the stops on the way. */
async function tabTo(page: Page, testId: string) {
  const walk: string[] = [];
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press("Tab");
    const here = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        id: el?.getAttribute("data-testid") ?? "",
        label:
          el?.getAttribute("aria-label") ?? el?.textContent?.slice(0, 24) ?? "",
      };
    });
    walk.push(here.id || here.label);
    if (here.id === testId) return { tabs: i + 1, walk };
  }
  return { tabs: -1, walk };
}

async function focusStyle(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      testid: el.getAttribute("data-testid"),
      label: el.getAttribute("aria-label"),
      focus_visible: el.matches(":focus-visible"),
      outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`,
      outline_offset: s.outlineOffset,
      box_shadow: s.boxShadow,
      draws_focus:
        (s.outlineStyle !== "none" &&
          parseFloat(s.outlineWidth) > 0 &&
          !s.outlineColor.endsWith(", 0)") &&
          s.outlineColor !== "transparent") ||
        (s.boxShadow !== "none" && s.boxShadow !== ""),
    };
  });
}

/** Each footer card against the rail's own grid. */
async function grid(page: Page) {
  await settle(page);
  return page.evaluate(
    ({ rail, ids }) => {
      const card = document.querySelector(rail);
      if (!card) return null;
      const r = card.getBoundingClientRect();
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) continue;
        const face = el.querySelector("button") as HTMLElement;
        const words = face.firstElementChild as HTMLElement;
        const title = words.querySelector("span") as HTMLElement;
        const icon = face.lastElementChild as HTMLElement;
        const f = face.getBoundingClientRect();
        const t = title.getBoundingClientRect();
        const w = words.getBoundingClientRect();
        const i = icon.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(title).lineHeight);
        const range = document.createRange();
        range.selectNodeContents(title);
        const lines = new Set(
          [...range.getClientRects()].map((x) => Math.round(x.top)),
        ).size;
        out[id] = {
          plate_left: +(f.left - r.left).toFixed(2),
          plate_right: +(r.right - f.right).toFixed(2),
          words_left: +(t.left - r.left).toFixed(2),
          words_column: +w.width.toFixed(2),
          icon_box: { w: +i.width.toFixed(2), h: +i.height.toFixed(2) },
          icon_centre: +(i.left + i.width / 2 - r.left).toFixed(2),
          title: title.textContent,
          title_lines: lines,
          title_line_height: lh,
          height: +f.height.toFixed(2),
          border: getComputedStyle(face).borderTopWidth,
        };
      }
      // The rail's own grid: a row plate, where its words start (section
      // labels and row names, read from the text itself), and its
      // right-hand column (small controls and the unread dots).
      const row = card.querySelector(".luca-rail-row") as HTMLElement | null;
      const rowBox = row?.getBoundingClientRect();
      const textLeft = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return +(range.getBoundingClientRect().left - r.left).toFixed(2);
      };
      const labels = [
        ...card.querySelectorAll(
          '[data-sidebar="content"] .type-eyebrow, [data-sidebar="content"] .luca-rail-row-name',
        ),
      ]
        .filter((x) => (x.textContent ?? "").trim().length > 0)
        .map(textLeft);
      const right = [
        ...card.querySelectorAll(
          '[data-sidebar="content"] button, [data-sidebar="content"] .luca-signal-dot',
        ),
      ]
        .map((x) => x.getBoundingClientRect())
        .filter((x) => x.width > 0 && x.width <= 24)
        .map((x) => +(x.left + x.width / 2 - r.left).toFixed(2));
      out.rail = {
        card: { x: r.x, w: r.width },
        row_plate: rowBox
          ? {
              left: +(rowBox.left - r.left).toFixed(2),
              right: +(r.right - rowBox.right).toFixed(2),
            }
          : null,
        label_words_left: [...new Set(labels)],
        right_column_centres: [...new Set(right)],
      };
      return out;
    },
    { rail: RAIL, ids: FOOT_CARDS },
  );
}

/** Every frame from a toggle click: the card's width and each footer card. */
async function trace(page: Page) {
  return page.evaluate(
    ({ rail, ids }) =>
      new Promise<unknown[]>((resolve) => {
        const frames: unknown[] = [];
        const start = performance.now();
        const sample = () => {
          const card = document.querySelector(rail);
          const row: Record<string, unknown> = {
            t: Math.round(performance.now() - start),
            rail_w: card ? +card.getBoundingClientRect().width.toFixed(1) : 0,
            rail_visibility: card
              ? getComputedStyle(
                  document.querySelector(
                    '[data-testid="app-sidebar"]',
                  ) as Element,
                ).visibility
              : null,
          };
          for (const id of ids) {
            const el = document.querySelector(
              `[data-testid="${id}"]`,
            ) as HTMLElement | null;
            row[id] = el
              ? {
                  opacity: getComputedStyle(el).opacity,
                  transform: getComputedStyle(el).transform,
                }
              : null;
          }
          frames.push(row);
          if (performance.now() - start < 800) requestAnimationFrame(sample);
          else resolve(frames);
        };
        (
          document.querySelector(
            '[data-testid="shell-lip-toggle"]',
          ) as HTMLElement
        ).click();
        requestAnimationFrame(sample);
      }),
    { rail: RAIL, ids: FOOT_CARDS },
  );
}

/** Decodes a PNG (base64) into RGBA, in the page. */
async function decode(page: Page, png: Buffer) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0);
    return {
      w: img.width,
      h: img.height,
      data: [...ctx.getImageData(0, 0, img.width, img.height).data],
    };
  }, png.toString("base64"));
}

/** How far the gear's ink stays from the dot: three pictures of the tile
 * (as drawn, the dot hidden, the gear hidden too), at DPR 2. */
async function dotClearance(page: Page) {
  const tile = await box(page, '[data-testid="open-settings-view"]');
  const dot = await box(page, '[data-testid="open-settings-view-update"]');
  if (!tile || !dot) return null;
  const clip = { x: tile.x, y: tile.y, width: tile.w, height: tile.h };
  const asDrawn = await page.screenshot({ clip });
  await page.evaluate(() => {
    (
      document.querySelector(
        '[data-testid="open-settings-view-update"]',
      ) as HTMLElement
    ).style.visibility = "hidden";
  });
  const noDot = await page.screenshot({ clip });
  await page.evaluate(() => {
    (
      document.querySelector(
        '[data-testid="open-settings-view"] > svg',
      ) as SVGElement
    ).style.visibility = "hidden";
  });
  const ground = await page.screenshot({ clip });
  await page.evaluate(() => {
    (
      document.querySelector(
        '[data-testid="open-settings-view-update"]',
      ) as HTMLElement
    ).style.visibility = "";
    (
      document.querySelector(
        '[data-testid="open-settings-view"] > svg',
      ) as SVGElement
    ).style.visibility = "";
  });
  const a = await decode(page, noDot);
  const g = await decode(page, ground);
  const cx = (dot.x + dot.w / 2 - tile.x) * 2;
  const cy = (dot.y + dot.h / 2 - tile.y) * 2;
  let nearest = Number.POSITIVE_INFINITY;
  for (let y = 0; y < a.h; y += 1) {
    for (let x = 0; x < a.w; x += 1) {
      const i = (y * a.w + x) * 4;
      const diff = Math.max(
        Math.abs(a.data[i] - g.data[i]),
        Math.abs(a.data[i + 1] - g.data[i + 1]),
        Math.abs(a.data[i + 2] - g.data[i + 2]),
      );
      if (diff > 8) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        nearest = Math.min(nearest, d);
      }
    }
  }
  return {
    as_drawn: asDrawn.length > 0,
    nearest_gear_ink_from_dot_centre_pt: +(nearest / 2).toFixed(2),
    gap_from_dot_edge_pt: +(nearest / 2 - dot.w / 2).toFixed(2),
  };
}

test("the review's fixes: focus, the dot, the motion, the grid, the scale", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const checks: Record<string, unknown> = {};

  // ── focus on the cards' faces, dark and Paper ──
  await openApp(page, {
    frame: true,
    mock: { channelsReadError: CONNECT_ERROR, updateAvailable: true },
  });
  await setRelay(page, "disconnected");
  await expect(page.getByTestId("sidebar-relay-unreachable")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  await page.mouse.move(1000, 500);
  await settle(page);
  const rail = await box(page, RAIL);
  const focus: Record<string, unknown> = {};
  const reconnectWalk = await tabTo(page, "sidebar-reconnect");
  focus.reconnect = { ...reconnectWalk, ...(await focusStyle(page)) };
  if (rail) {
    await shot(page, "focus-relay-dark", {
      x: rail.x - 8,
      y: rail.y + rail.h - 180,
      w: rail.w + 16,
      h: 188,
    });
  }
  const updateWalk = await tabTo(page, "sidebar-update-now");
  focus.update_now = { ...updateWalk, ...(await focusStyle(page)) };
  if (rail) {
    await shot(page, "focus-update-dark", {
      x: rail.x - 8,
      y: rail.y + rail.h - 180,
      w: rail.w + 16,
      h: 188,
    });
  }
  // A rail row's focus, for comparison: the same outline.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const lightContext = await browser.newContext({ deviceScaleFactor: 2 });
  const light = await lightContext.newPage();
  await openApp(light, {
    frame: true,
    scheme: "light",
    mock: { channelsReadError: CONNECT_ERROR, updateAvailable: true },
  });
  await setRelay(light, "disconnected");
  await expect(light.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  await light.mouse.move(1000, 500);
  await settle(light);
  const paperWalk = await tabTo(light, "sidebar-update-now");
  focus.update_now_paper = { ...paperWalk, ...(await focusStyle(light)) };
  const lightRail = await box(light, RAIL);
  if (lightRail) {
    await shot(light, "focus-update-paper", {
      x: lightRail.x - 8,
      y: lightRail.y + lightRail.h - 180,
      w: lightRail.w + 16,
      h: 188,
    });
  }
  await lightContext.close();
  checks.focus = focus;

  // ── the grid, 1440 × 900 ──
  await page.mouse.move(1000, 500);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  checks.grid_1440 = await grid(page);
  if (rail) {
    await shot(page, "grid-dark-1440-foot", {
      x: rail.x - 8,
      y: rail.y + rail.h - 180,
      w: rail.w + 16,
      h: 188,
    });
  }

  // ── the motion: close, then open ──
  checks.motion_close = await trace(page);
  await page.waitForTimeout(400);
  checks.closed_state = await page.evaluate((ids) => {
    const sidebar = document.querySelector(
      '[data-testid="app-sidebar"]',
    ) as HTMLElement;
    return {
      card_visibility: getComputedStyle(sidebar).visibility,
      inert: Boolean(
        sidebar.closest("[inert]") || sidebar.querySelector("[inert]"),
      ),
      cards: ids.map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return {
          id,
          mounted: Boolean(el),
          visibility: el ? getComputedStyle(el).visibility : null,
          in_inert: el ? Boolean(el.closest("[inert]")) : null,
        };
      }),
    };
  }, FOOT_CARDS);
  checks.motion_open = await trace(page);
  await page.waitForTimeout(400);

  // ── the dot: its colour against the gear, and its cut ──
  await closeRail(page);
  await page.mouse.move(1000, 500);
  await settle(page);
  const dotRest = await updateDot(page);
  const tile = await box(page, '[data-testid="open-settings-view"]');
  if (tile) {
    await shot(page, "dot-rest-dark", {
      x: tile.x - 6,
      y: tile.y - 6,
      w: tile.w + 12,
      h: tile.h + 12,
    });
  }
  await page.getByTestId("open-settings-view").hover();
  await page.waitForTimeout(300);
  const dotHover = await updateDot(page);
  if (tile) {
    await shot(page, "dot-hover-dark", {
      x: tile.x - 6,
      y: tile.y - 6,
      w: tile.w + 12,
      h: tile.h + 12,
    });
  }
  await page.getByTestId("open-settings-view").click();
  await expect(
    page.getByRole("heading", { name: "Profile", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(1000, 500);
  await page.waitForTimeout(400);
  const dotCurrent = await updateDot(page);
  const currentTile = await box(page, '[data-testid="open-settings-view"]');
  if (currentTile) {
    await shot(page, "dot-current-dark", {
      x: currentTile.x - 6,
      y: currentTile.y - 6,
      w: currentTile.w + 12,
      h: currentTile.h + 12,
    });
  }
  const clearance = await dotClearance(page);
  const floor = await page.evaluate(() => {
    const p = document.createElement("div");
    p.style.color = "hsl(var(--mn-floor))";
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  });
  type DotRead = { background?: string; gear?: string | null };
  const pair = (d: DotRead | null) =>
    d?.background && d.gear ? contrast(d.background, d.gear) : null;
  const deltaE = (d: DotRead | null) =>
    d?.background && d.gear ? labDistance(d.background, d.gear) : null;
  checks.dot = {
    rest: dotRest,
    hover: dotHover,
    current: dotCurrent,
    contrast_dot_vs_gear: {
      rest: pair(dotRest as DotRead),
      hover: pair(dotHover as DotRead),
      current: pair(dotCurrent as DotRead),
    },
    delta_e_dot_vs_gear: {
      rest: deltaE(dotRest as DotRead),
      hover: deltaE(dotHover as DotRead),
      current: deltaE(dotCurrent as DotRead),
    },
    contrast_dot_vs_floor: (dotRest as DotRead)?.background
      ? contrast((dotRest as DotRead).background as string, floor)
      : null,
    clearance_current_dark: clearance,
  };
  // Paper.
  const paperContext = await browser.newContext({ deviceScaleFactor: 2 });
  const paper = await paperContext.newPage();
  await openApp(paper, {
    frame: true,
    scheme: "light",
    mock: { updateAvailable: true },
  });
  await expect(paper.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  await paper.getByTestId("open-settings-view").click();
  await expect(paper.getByTestId("open-settings-view-update")).toBeVisible({
    timeout: 20_000,
  });
  await paper.mouse.move(1000, 500);
  await settle(paper);
  const paperDot = await updateDot(paper);
  const paperTile = await box(paper, '[data-testid="open-settings-view"]');
  if (paperTile) {
    await shot(paper, "dot-current-paper", {
      x: paperTile.x - 6,
      y: paperTile.y - 6,
      w: paperTile.w + 12,
      h: paperTile.h + 12,
    });
  }
  (checks.dot as Record<string, unknown>).paper = {
    current: paperDot,
    contrast_dot_vs_gear: pair(paperDot as DotRead),
    delta_e_dot_vs_gear: deltaE(paperDot as DotRead),
    clearance: await dotClearance(paper),
  };
  await paperContext.close();

  // ── the grid at 800 × 500 and the text scale, with the auth card's
  // description too ──
  const auth = await page.context().newPage();
  await openApp(auth, {
    frame: true,
    mock: { channelsReadError: AUTH_ERROR, updateAvailable: true },
  });
  await expect(auth.getByTestId("sidebar-connection-status")).toBeVisible({
    timeout: 20_000,
  });
  await expect(auth.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  await auth.mouse.move(1000, 500);
  const scale: Record<string, unknown> = {};
  for (const [label, px] of [
    ["75", "12px"],
    ["100", ""],
    ["150", "24px"],
  ] as const) {
    await auth.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, px);
    await auth.waitForTimeout(400);
    scale[label] = await grid(auth);
    const r = await box(auth, RAIL);
    if (r) {
      await shot(auth, `scale-${label}-foot`, {
        x: r.x - 8,
        y: r.y + r.h - 300,
        w: r.w + 16,
        h: 308,
      });
    }
  }
  await auth.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  checks.scale = scale;
  await auth.close();

  const narrow = await page.context().newPage();
  await openApp(narrow, {
    frame: true,
    size: { width: 800, height: 500 },
    mock: { channelsReadError: CONNECT_ERROR, updateAvailable: true },
  });
  await setRelay(narrow, "disconnected");
  await expect(narrow.getByTestId("sidebar-relay-unreachable")).toBeVisible({
    timeout: 20_000,
  });
  await narrow.mouse.move(700, 400);
  checks.grid_800 = await grid(narrow);
  const nr = await box(narrow, RAIL);
  if (nr) {
    await shot(narrow, "grid-dark-800-foot", {
      x: nr.x - 8,
      y: nr.y + nr.h - 180,
      w: nr.w + 16,
      h: 188,
    });
  }
  await narrow.close();
  record("review-fixes", checks);

  // ── the verdicts ──
  type Focus = { draws_focus: boolean; focus_visible: boolean };
  for (const key of ["reconnect", "update_now", "update_now_paper"]) {
    const f = focus[key] as Focus;
    expect(f.focus_visible, key).toBe(true);
    expect(f.draws_focus, key).toBe(true);
  }
  type Frame = Record<string, { opacity: string; transform: string } | null>;
  const steady = (frames: unknown[], id: string) =>
    (frames as Frame[]).every(
      (f) =>
        f[id] !== null &&
        f[id]?.opacity === "1" &&
        (f[id]?.transform === "none" ||
          f[id]?.transform === "matrix(1, 0, 0, 1, 0, 0)"),
    );
  for (const id of ["sidebar-relay-unreachable", "sidebar-update-card"]) {
    expect(steady(checks.motion_close as unknown[], id), `close ${id}`).toBe(
      true,
    );
    expect(steady(checks.motion_open as unknown[], id), `open ${id}`).toBe(
      true,
    );
  }
  type Grid = {
    plate_left: number;
    plate_right: number;
    words_left: number;
    icon_centre: number;
    icon_box: { w: number };
    title_lines: number;
  };
  for (const g of [checks.grid_1440, checks.grid_800, scale["100"]] as Record<
    string,
    Grid
  >[]) {
    for (const id of FOOT_CARDS) {
      const c = g[id];
      if (!c) continue;
      expect(c.plate_left, id).toBe(6);
      expect(c.plate_right, id).toBe(6);
      expect(c.words_left, id).toBe(16);
      expect(c.icon_box.w, id).toBe(20);
    }
  }
  expect(
    (checks.grid_1440 as Record<string, Grid>)["sidebar-relay-unreachable"]
      .title_lines,
  ).toBe(1);
  for (const label of ["75", "150"]) {
    const g = scale[label] as Record<string, Grid>;
    for (const id of FOOT_CARDS) {
      const c = g[id];
      if (!c) continue;
      expect(c.plate_left, `${label} ${id}`).toBe(6);
      expect(c.words_left, `${label} ${id}`).toBe(16);
      expect(c.icon_box.w, `${label} ${id}`).toBe(20);
    }
  }
  const dot = checks.dot as {
    contrast_dot_vs_gear: Record<string, number>;
    clearance_current_dark: { gap_from_dot_edge_pt: number };
  };
  // The dot and the gear differ in hue at every state (the slate signal
  // against the ink), measured as CIE76 ΔE; the luminance ratio is
  // recorded alongside.
  for (const v of Object.values(
    (checks.dot as { delta_e_dot_vs_gear: Record<string, number> })
      .delta_e_dot_vs_gear,
  )) {
    expect(v).toBeGreaterThan(20);
  }
  expect(
    dot.clearance_current_dark.gap_from_dot_edge_pt,
  ).toBeGreaterThanOrEqual(0.75);
});

/** With the frame on and nothing to report, the footer is empty and the
 * frame draws exactly as the integration build before this package
 * (SHELL_FRAME_BASE_URL, default the WP-08a reviewer's at 47482). */
test("frame on, nothing to report: unchanged from the integration build", async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const frameBase =
    process.env.SHELL_FRAME_BASE_URL ?? "http://127.0.0.1:47482";
  const reachable = await fetch(frameBase)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, `integration build not reachable at ${frameBase}`);
  const capture = async (origin: string, label: string) => {
    const files: Record<string, string> = {};
    for (const scheme of ["dark", "light"] as const) {
      const context = await browser.newContext({ deviceScaleFactor: 2 });
      await context.clock.install({ time: new Date("2026-10-25T18:30:00") });
      const page = await context.newPage();
      await openApp(page, { frame: true, origin, scheme });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.waitForTimeout(2000);
      await page.mouse.move(1439, 899);
      const footer = await page.evaluate(
        () =>
          document.querySelector('[data-sidebar="footer"]')?.children.length ??
          null,
      );
      files[`${scheme}-open`] = await shot(
        page,
        `nothing-${scheme}-open${label}`,
      );
      files[`${scheme}-footer-children`] = String(footer);
      await page.keyboard.press("Meta+s");
      await page.waitForTimeout(900);
      await page.mouse.move(1439, 899);
      files[`${scheme}-closed`] = await shot(
        page,
        `nothing-${scheme}-closed${label}`,
      );
      await context.close();
    }
    return files;
  };
  const ours = await capture(info.project.use.baseURL ?? "", "");
  const base = await capture(frameBase, "-integration");
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(ours)) {
    if (key.endsWith("footer-children")) {
      result[key] = { ours: ours[key], base: base[key] };
      continue;
    }
    result[key] = {
      ours: sha(ours[key]),
      base: sha(base[key]),
      identical: sha(ours[key]) === sha(base[key]),
    };
  }
  record("frame-nothing-to-report", result);
  for (const key of Object.keys(result)) {
    const r = result[key] as { identical?: boolean };
    if (r.identical !== undefined) expect.soft(r.identical, key).toBe(true);
  }
});
