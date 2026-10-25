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
    probe.style.color = "hsl(var(--buzz-selected-accent))";
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const background = getComputedStyle(dot).backgroundColor;
    return {
      shown: true,
      label: tile.getAttribute("aria-label"),
      size: { w: d.width, h: d.height },
      from_tile_right: +(t.right - d.right).toFixed(2),
      from_tile_top: +(d.top - t.top).toFixed(2),
      background,
      accent,
      is_accent: background === accent,
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
    is_accent?: boolean;
  };
  const closed = checks.rail_closed as Dot;
  expect((checks.rail_open as Dot).shown).toBe(false);
  expect(closed.shown).toBe(true);
  expect(closed.label).toBe("Settings, update available");
  expect(closed.size).toEqual({ w: 6, h: 6 });
  expect(closed.from_tile_right).toBe(4);
  expect(closed.from_tile_top).toBe(4);
  expect(closed.is_accent).toBe(true);
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
