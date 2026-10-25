import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * The avatar: communities, its dot, its states (docs/luca/rail-system/
 * SHELL_BUILD.md, WP-08a). With more than one community the strip goes and
 * the avatar's menu lists them; the avatar carries no presence dot, only a
 * connection problem's while the rail is closed; it responds like a place;
 * the DEV chip's letters sit on its centre. The flag off draws the base
 * build exactly, by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks.json go (else the test's
 * output folder). SHELL_BASE_URL: the base build for the flag-off shots
 * (default http://127.0.0.1:4300); unreachable, reported as not run.
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };

const SECOND = {
  id: "e2e-second-community",
  name: "Bravo",
  relayUrl: "ws://localhost:3001",
  addedAt: "2026-01-02T00:00:00.000Z",
};
// Beyond the second, for a long list: two-word names, so the tiles carry two
// initials, the widest they draw.
const MORE_NAMES = [
  "Mason Studio",
  "North Relay",
  "Charlie Works",
  "Delta House",
  "Echo Lab",
  "Foxtrot Guild",
  "Golf Circle",
  "Hotel Room",
  "India Field",
  "Juliet Yard",
  "Kilo Bench",
  "Lima Hall",
  "Mike Deck",
  "Oscar Loft",
  "Papa Square",
  "Quebec Row",
  "Romeo Port",
  "Sierra Dock",
  "Tango Barn",
  "Uniform Bay",
  "Victor Hill",
  "Whiskey Cove",
];

function extraCommunities(count: number) {
  if (count < 2) return [];
  const more = MORE_NAMES.slice(0, Math.max(0, count - 2)).map(
    (name, index) => ({
      id: `e2e-more-community-${index + 3}`,
      name,
      relayUrl: `ws://localhost:${3002 + index}`,
      addedAt: `2026-01-${String(index + 3).padStart(2, "0")}T00:00:00.000Z`,
    }),
  );
  return [SECOND, ...more];
}
const FIRST_ID = "e2e-default-community";
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const CONVERSATION_CARD =
  '[data-testid="conversation-workspace-grid"] [data-luca-card]';
const AVATAR = '[data-testid="shell-profile-avatar-button"]';
const DISC = '[data-testid="shell-profile-avatar"]';

function shotsDir(fallback: string) {
  const dir = process.env.SHELL_SHOTS ?? fallback;
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function openApp(
  page: Page,
  {
    communities = 1,
    devBuild = false,
    frame,
    homeFollowsActive = false,
    origin = "",
    size = { width: 1440, height: 900 },
  }: {
    communities?: number;
    devBuild?: boolean;
    frame: boolean;
    homeFollowsActive?: boolean;
    origin?: string;
    size?: { width: number; height: number };
  },
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: "dark" });
  if (devBuild) await serveAsDevBuild(page);
  await installMockBridge(page);
  // After the bridge's own seeds, so these decide the frame and add the
  // second community beside the mock's own (which stays the active one).
  await page.addInitScript(
    ({ key, on, extra }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (extra.length > 0) {
        const list = JSON.parse(
          localStorage.getItem("buzz-communities") ?? "[]",
        ) as Array<{ id: string; pubkey?: string }>;
        for (const next of extra) {
          if (!list.some((community) => community.id === next.id)) {
            list.push({ ...next, pubkey: list[0]?.pubkey });
          }
        }
        localStorage.setItem("buzz-communities", JSON.stringify(list));
      }
    },
    {
      key: FEATURE_OVERRIDES_STORAGE_KEY,
      on: frame,
      extra: extraCommunities(communities),
    },
  );
  await page.addInitScript((follow) => {
    // Every write of the active community, for the switch's record.
    const writes: string[] = [];
    (window as unknown as { __activeWrites: string[] }).__activeWrites = writes;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "buzz-active-community-id") writes.push(value);
      return setItem.call(this, key, value);
    };
    // Luca's personal-home gate (App.tsx, PersonalHomeGate) returns the app
    // to the personal home after any switch, the strip's included. To see a
    // switch land, the home follows the active community here: a test seam
    // only, the Buzz world of several equal communities.
    if (follow) {
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        return getItem.call(
          this,
          key === "luca-personal-home-tenancy.v1"
            ? "buzz-active-community-id"
            : key,
        );
      };
    }
  }, homeFollowsActive);
  await page.goto(`${origin}/?e2e=mock`);
}

const activeWrites = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __activeWrites: string[] }).__activeWrites ?? [],
  );

/** The release build's identity, swapped for a dev one in the served bundle
 *  (as the frame's spec does): outside Tauri the app always reports a
 *  release build, and the DEV chip is drawn only for a dev one. */
async function serveAsDevBuild(page: Page) {
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "{identifier:``,isDev:!1}",
      "{identifier:`e2e.dev`,isDev:!0}",
    );
    await route.fulfill({ response, body });
  });
}

async function openGeneral(page: Page, { frame = true } = {}) {
  if (!frame) {
    await page.getByTestId("channel-general").click({ timeout: 40_000 });
    await expect(
      page.locator('[data-testid="conversation-workspace-grid"]').first(),
    ).toBeVisible({
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

async function shot(page: Page, dir: string, name: string, clip?: Box) {
  await settle(page);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({
    path: file,
    ...(clip
      ? { clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } }
      : {}),
  });
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

async function discStyle(page: Page) {
  return page.evaluate((s) => {
    const disc = document.querySelector(s) as HTMLElement | null;
    if (!disc) return null;
    const style = getComputedStyle(disc);
    const clip = disc.closest("[style*='clip-path']") as HTMLElement | null;
    return {
      background: style.backgroundColor,
      transition: `${style.transitionProperty} ${style.transitionDuration}`,
      clipped: !!clip && getComputedStyle(clip).clipPath !== "none",
    };
  }, DISC);
}

/** The ink of a small label: the device pixels inside `b` (less its 1-point
 *  border) that differ from the label's own ground, and the gaps they leave
 *  to each inner edge, in points. */
async function inkGaps(page: Page, b: Box) {
  const png = await page.screenshot({
    clip: { x: b.x, y: b.y, width: b.w, height: b.h },
  });
  return page.evaluate(
    async ({ b64, w }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / w;
      const inset = Math.round(scale * 1.5);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const grey = (x: number, y: number) => {
        const i = (y * bitmap.width + x) * 4;
        return (data[i] + data[i + 1] + data[i + 2]) / 3;
      };
      const ground = grey(inset, Math.round(bitmap.height / 2));
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let y = inset; y < bitmap.height - inset; y += 1) {
        for (let x = inset; x < bitmap.width - inset; x += 1) {
          if (Math.abs(grey(x, y) - ground) > 40) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      if (minX === Infinity) return null;
      const border = scale; // the chip's 1-point border
      return {
        left: (minX - border) / scale,
        right: (bitmap.width - border - (maxX + 1)) / scale,
        top: (minY - border) / scale,
        bottom: (bitmap.height - border - (maxY + 1)) / scale,
        ink: { w: (maxX + 1 - minX) / scale, h: (maxY + 1 - minY) / scale },
      };
    },
    { b64: png.toString("base64"), w: b.w },
  );
}

async function setRelay(page: Page, state: string) {
  await page.evaluate((s) => {
    const setter = (
      window as Window & {
        __BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?: (state: string) => void;
      }
    ).__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__;
    if (!setter) throw new Error("E2E relay state setter not installed.");
    setter(s);
  }, state);
}

const checks: Record<string, unknown> = {};
const files: string[] = [];

function record(dir: string) {
  writeFileSync(
    path.join(dir, "checks.json"),
    JSON.stringify({ checks, files }, null, 2),
  );
}

test("communities in the avatar's menu, and no strip", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const dir = shotsDir(info.outputPath());
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openApp(page, { communities: 2, frame: true, homeFollowsActive: true });
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-frame",
    "solid",
    { timeout: 20_000 },
  );
  await openGeneral(page);
  await page.mouse.move(700, 500);

  // ── no-strip: the places keep the window's left edge ────────────────
  const places = await box(page, '[data-testid="shell-places"]');
  const strip = await page.getByTestId("community-rail").count();
  files.push(await shot(page, dir, "no-strip"));
  checks.strip_gone = {
    strip_count: strip,
    places,
    ok: strip === 0 && places?.x === 0 && places?.w === 44,
  };

  // ── communities-in-menu ─────────────────────────────────────────────
  await page.locator(AVATAR).click();
  const popover = page.getByTestId("profile-popover");
  await expect(popover).toBeVisible();
  await expect(page.getByTestId("shell-communities")).toBeVisible();
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="shell-communities"] [data-testid^="shell-community-switch-"]',
      ),
    ].map((row) => ({
      name: row.textContent,
      current: row.getAttribute("aria-current"),
      label: row.getAttribute("aria-label"),
    })),
  );
  const menu = await box(page, '[data-testid="profile-popover"]');
  files.push(
    await shot(
      page,
      dir,
      "communities-in-menu",
      menu
        ? { x: 0, y: menu.y - 16, w: menu.x + menu.w + 24, h: menu.h + 32 }
        : undefined,
    ),
  );
  // The strip's per-community actions, kept: right-click and "more".
  await page
    .getByTestId(`shell-community-${SECOND.id}`)
    .click({ button: "right" });
  const contextItems = await page
    .getByTestId(`shell-community-menu-${SECOND.id}`)
    .getByRole("menuitem")
    .allTextContents();
  files.push(await shot(page, dir, "communities-context-menu"));
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId(`shell-community-menu-${SECOND.id}`),
  ).toHaveCount(0);
  await expect(popover).toBeVisible();
  const addVisible = await page.getByTestId("shell-community-add").isVisible();
  checks.communities_in_menu = {
    rows,
    context_menu: contextItems,
    add_community: addVisible,
    ok:
      rows.length === 2 &&
      rows[0].current === "true" &&
      rows[1].current === null &&
      contextItems.join("|") ===
        "Mark all as read|Copy relay URL|Community settings" &&
      addVisible,
  };

  // ── switch: lands in the other community ────────────────────────────
  await page.getByTestId(`shell-community-switch-${SECOND.id}`).click();
  await expect(popover).toBeHidden();
  await expect
    .poll(
      () =>
        page.evaluate(() => localStorage.getItem("buzz-active-community-id")),
      { timeout: 20_000 },
    )
    .toBe(SECOND.id);
  // The shell remounts against the other relay; its avatar's menu then marks
  // the other community current.
  await expect(page.locator(AVATAR)).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    await page.locator(AVATAR).click();
    await expect(
      page.getByTestId(`shell-community-switch-${SECOND.id}`),
    ).toHaveAttribute("aria-current", "true", { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  const after = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="shell-communities"] [data-testid^="shell-community-switch-"]',
      ),
    ].map((row) => ({
      name: row.textContent,
      current: row.getAttribute("aria-current"),
    })),
  );
  files.push(await shot(page, dir, "switched-to-bravo"));
  await page.keyboard.press("Escape");
  // And back, as the strip did.
  await page.locator(AVATAR).click();
  await page.getByTestId(`shell-community-switch-${FIRST_ID}`).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => localStorage.getItem("buzz-active-community-id")),
      { timeout: 20_000 },
    )
    .toBe(FIRST_ID);
  const stripAfter = await page.getByTestId("community-rail").count();
  const writes = await activeWrites(page);
  checks.switch_works = {
    after_switch: after,
    active_writes: writes,
    strip_after: stripAfter,
    ok:
      !!after.find((row) => row.name?.endsWith("Bravo"))?.current &&
      writes.join("|") === `${SECOND.id}|${FIRST_ID}` &&
      stripAfter === 0,
  };

  // ── the smallest window: the menu, communities and all, fits ────────
  await page.setViewportSize({ width: 800, height: 500 });
  await page.mouse.move(400, 250);
  await settle(page);
  await page.locator(AVATAR).click();
  await expect(page.getByTestId("shell-communities")).toBeVisible();
  await page.waitForTimeout(300);
  const small = await box(page, '[data-testid="profile-popover"]');
  const smallPlaces = await box(page, '[data-testid="shell-places"]');
  files.push(await shot(page, dir, "communities-in-menu-800x500"));
  (checks.communities_in_menu as Record<string, unknown>).at_800x500 = {
    menu: small,
    places: smallPlaces,
    ok:
      !!small &&
      small.y >= 0 &&
      small.y + small.h <= 500 &&
      smallPlaces?.x === 0,
  };
  await page.keyboard.press("Escape");
  checks.console_communities = errors;
  record(dir);
});

test("the menu's switch is the strip's, gate and all", async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const dir = shotsDir(info.outputPath());
  const result: Record<string, string[]> = {};
  for (const frame of [false, true]) {
    const context = await browser.newContext({
      baseURL: info.project.use.baseURL,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await openApp(page, { communities: 2, frame });
    await page.waitForSelector('[data-testid="app-sidebar"]', {
      timeout: 20_000,
    });
    if (frame) {
      await page.locator(AVATAR).click();
      await page.getByTestId(`shell-community-switch-${SECOND.id}`).click();
    } else {
      await page.getByTestId(`community-rail-button-${SECOND.id}`).click();
    }
    await page.waitForTimeout(3_000);
    result[frame ? "menu" : "strip"] = await activeWrites(page);
    await context.close();
  }
  const existing = (checks.switch_works ?? {}) as Record<string, unknown>;
  checks.switch_works = {
    ...existing,
    with_personal_home_gate: result,
    ok:
      existing.ok === true &&
      result.menu.join("|") === result.strip.join("|") &&
      result.menu[0] === SECOND.id,
  };
  record(dir);
});

test("the avatar: no presence dot, its states, its tooltip, its dot", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const dir = shotsDir(info.outputPath());
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openApp(page, { frame: true });
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-frame",
    "solid",
    { timeout: 20_000 },
  );
  await openGeneral(page);
  await page.mouse.move(700, 500);
  await settle(page);

  const av = await box(page, AVATAR);
  if (!av) throw new Error("No avatar.");
  const clip = { x: 0, y: av.y - 44, w: 120, h: 80 };

  // ── no presence dot ─────────────────────────────────────────────────
  const presence = await page
    .locator('[data-testid="shell-self-presence-badge"]')
    .count();
  const rest = await discStyle(page);
  files.push(await shot(page, dir, "avatar-rest", clip));
  checks.no_presence_dot = {
    presence_badges: presence,
    disc_clipped: rest?.clipped,
    ok: presence === 0 && rest?.clipped === false,
  };

  // ── hover, its tooltip ──────────────────────────────────────────────
  await page.locator(AVATAR).hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  const hover = await discStyle(page);
  files.push(await shot(page, dir, "avatar-hover", clip));
  const tip = await box(
    page,
    "[data-radix-popper-content-wrapper] [data-side]",
  );
  const tipText = (await tooltip.textContent())?.trim();
  const tipSide = await page.evaluate(
    () =>
      document
        .querySelector("[data-radix-popper-content-wrapper] [data-side]")
        ?.getAttribute("data-side") ?? null,
  );
  const name = await page.evaluate(
    () =>
      document
        .querySelector('[data-testid="shell-profile-avatar-button"]')
        ?.getAttribute("aria-label")
        ?.replace("Open profile menu for ", "") ?? null,
  );
  files.push(
    await shot(page, dir, "avatar-tooltip", {
      x: 0,
      y: av.y - 44,
      w: 260,
      h: 80,
    }),
  );
  // The same tooltip as Settings', the place above it.
  await page.getByTestId("open-settings-view").hover();
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  const settingsTipClass = await page.evaluate(
    () =>
      document.querySelector("[data-radix-popper-content-wrapper] [data-side]")
        ?.className ?? null,
  );
  // A hand keeps moving: a second step on the avatar. Playwright's hover is
  // one pointermove, which Radix spends on leaving Settings' tooltip (its
  // pointer-in-transit grace), so a lone step can leave the avatar's unasked.
  await page.locator(AVATAR).hover();
  await page.mouse.move(av.x + av.w / 2 + 1, av.y + av.h / 2 + 1);
  await expect(tooltip).toHaveText(name ?? "", { timeout: 5_000 });
  const avatarTipClass = await page.evaluate(
    () =>
      document.querySelector("[data-radix-popper-content-wrapper] [data-side]")
        ?.className ?? null,
  );
  checks.avatar_tooltip = {
    text: tipText,
    name,
    side: tipSide,
    box: tip,
    same_as_places: settingsTipClass === avatarTipClass,
    ok:
      !!name &&
      tipText === name &&
      tipSide === "right" &&
      settingsTipClass === avatarTipClass,
  };

  // ── open ────────────────────────────────────────────────────────────
  await page.locator(AVATAR).click();
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await page.mouse.move(700, 500);
  await page.waitForTimeout(300);
  const open = await discStyle(page);
  const tooltipWhileOpen = await page.getByRole("tooltip").count();
  files.push(await shot(page, dir, "avatar-open", { ...clip, w: 360 }));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("profile-popover")).toBeHidden();
  await page.mouse.move(700, 500);
  await page.waitForTimeout(300);
  const tooltipAfterClose = await page.getByRole("tooltip").count();
  const back = await discStyle(page);
  checks.avatar_states = {
    rest: rest?.background,
    hover: hover?.background,
    open: open?.background,
    after_close: back?.background,
    transition: rest?.transition,
    tooltip_while_open: tooltipWhileOpen,
    tooltip_after_close: tooltipAfterClose,
    ok:
      rest?.background === "rgba(200, 196, 185, 0.14)" &&
      hover?.background === "rgba(200, 196, 185, 0.2)" &&
      open?.background === "rgba(200, 196, 185, 0.2)" &&
      back?.background === "rgba(200, 196, 185, 0.14)" &&
      rest?.transition === "background-color 0.12s" &&
      tooltipWhileOpen === 0 &&
      tooltipAfterClose === 0,
  };

  // ── connection-dot: the relay down, the rail closed ─────────────────
  await setRelay(page, "stalled");
  await expect(page.getByTestId("sidebar-relay-unreachable")).toBeVisible({
    timeout: 10_000,
  });
  await settle(page);
  const dotWithRailOpen = await page
    .getByTestId("shell-avatar-connection-dot")
    .count();
  files.push(await shot(page, dir, "connection-rail-open"));
  await page.getByTestId("shell-lip-toggle").click();
  await expect(page.getByTestId("shell-avatar-connection-dot")).toBeVisible({
    timeout: 10_000,
  });
  await page.mouse.move(700, 500);
  await page.waitForTimeout(600);
  const dot = await box(page, '[data-testid="shell-avatar-connection-dot"]');
  const disc = await box(page, DISC);
  const dotStyle = await page.evaluate(() => {
    const dot = document.querySelector(
      '[data-testid="shell-avatar-connection-dot"]',
    ) as HTMLElement | null;
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-warning)";
    document.body.append(probe);
    const warning = getComputedStyle(probe).color;
    probe.remove();
    return {
      background: dot ? getComputedStyle(dot).backgroundColor : null,
      warning,
    };
  });
  const clipped = (await discStyle(page))?.clipped;
  const label = await page.locator(AVATAR).getAttribute("aria-label");
  // Under the frame the reconnecting card never draws (SHELL_SPEC.md, "The
  // reconnecting card"): nothing covers the avatar, its dot or Settings.
  const overlay = await page.getByTestId("sidebar-reconnect").count();
  const onTop = await page.evaluate(() =>
    ["shell-profile-avatar-button", "open-settings-view"].map((id) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return { id, hit_inside: !!hit && element.contains(hit) };
    }),
  );
  files.push(await shot(page, dir, "connection-dot-rail-closed"));
  files.push(await shot(page, dir, "connection-dot", clip));
  const discBox = await box(page, AVATAR);
  if (discBox) {
    files.push(
      await shot(page, dir, "connection-dot-zoom", {
        x: discBox.x - 4,
        y: discBox.y - 4,
        w: discBox.w + 8,
        h: discBox.h + 8,
      }),
    );
  }
  const dotCentre =
    dot && disc
      ? { x: dot.x + dot.w / 2 - disc.x, y: dot.y + dot.h / 2 - disc.y }
      : null;
  // The avatar takes the click: its menu opens, communities and all.
  await page.locator(AVATAR).click({ timeout: 5_000 });
  const menuOpens = await page
    .getByTestId("profile-popover")
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("profile-popover")).toBeHidden();
  await page.mouse.move(700, 500);
  await page.waitForTimeout(300);
  checks.connection_dot = {
    overlay_count: overlay,
    on_top: onTop,
    avatar_click_opens_menu: menuOpens,
    with_rail_open: dotWithRailOpen,
    dot,
    centre_in_disc: dotCentre,
    background: dotStyle.background,
    warning: dotStyle.warning,
    disc_cut: clipped,
    label,
    ok:
      dotWithRailOpen === 0 &&
      !!dot &&
      dot.w === 6 &&
      dot.h === 6 &&
      !!dotCentre &&
      dotCentre.x === 20.5 &&
      dotCentre.y === 20.5 &&
      dotStyle.background === dotStyle.warning &&
      clipped === true &&
      !!label?.endsWith(", connection problem") &&
      overlay === 0 &&
      onTop.every((entry) => entry?.hit_inside === true) &&
      menuOpens,
  };
  // The smallest window, the rail still closed.
  await page.setViewportSize({ width: 800, height: 500 });
  await page.mouse.move(400, 250);
  await settle(page);
  const smallAvatar = await box(page, AVATAR);
  const smallDot = await box(
    page,
    '[data-testid="shell-avatar-connection-dot"]',
  );
  if (smallAvatar) {
    files.push(
      await shot(page, dir, "connection-dot-800x500", {
        x: 0,
        y: smallAvatar.y - 44,
        w: 120,
        h: 80,
      }),
    );
  }
  (checks.connection_dot as Record<string, unknown>).at_800x500 = {
    dot: smallDot,
    ok: smallDot?.w === 6 && smallDot?.h === 6,
  };
  // Back in touch: the dot goes.
  await setRelay(page, "connected");
  await expect(page.getByTestId("shell-avatar-connection-dot")).toHaveCount(0, {
    timeout: 10_000,
  });
  checks.console_avatar = errors;
  record(dir);
});

async function openMenu(page: Page) {
  await page.locator(AVATAR).click();
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await expect(page.getByTestId("shell-communities")).toBeVisible();
  await page.waitForTimeout(350);
  await settle(page);
}

/** The menu's parts, where they are, and whether its list scrolls. */
async function menuLayout(page: Page) {
  return page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const list = document.querySelector(
      '[data-testid="shell-communities-list"]',
    ) as HTMLElement | null;
    const rows = [
      ...document.querySelectorAll(
        '[data-testid="shell-communities-list"] [data-testid^="shell-community-switch-"]',
      ),
    ];
    return {
      window: { w: innerWidth, h: innerHeight },
      menu: rect(document.querySelector('[data-testid="profile-popover"]')),
      identity: rect(
        document.querySelector(
          '[data-testid="profile-popover"] [role="menu"] > div',
        ),
      ),
      settings: rect(
        document.querySelector('[data-testid="profile-popover-settings"]'),
      ),
      add: rect(document.querySelector('[data-testid="shell-community-add"]')),
      list: rect(list),
      list_scroll: list
        ? {
            overflow_y: getComputedStyle(list).overflowY,
            client: list.clientHeight,
            scroll: list.scrollHeight,
            top: list.scrollTop,
          }
        : null,
      rows: rows.length,
      last_row: rect(rows[rows.length - 1] ?? null),
    };
  });
}

const inside = (
  b: { x: number; y: number; w: number; h: number } | null,
  w: { w: number; h: number },
) => !!b && b.y >= 0 && b.x >= 0 && b.y + b.h <= w.h && b.x + b.w <= w.w;

test("many communities: the menu stays in the window, its list scrolls", async ({
  browser,
}, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const errors: string[] = [];
  const result: Record<string, unknown> = {};
  let ok = true;
  for (const [count, size] of [
    [10, { width: 800, height: 500 }],
    [10, { width: 1440, height: 900 }],
    [24, { width: 1440, height: 900 }],
    [2, { width: 800, height: 500 }],
  ] as const) {
    const label = `many-${count}c-${size.width}x${size.height}`;
    const context = await browser.newContext({
      baseURL: info.project.use.baseURL,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await openApp(page, { communities: count, frame: true, size });
    await expect(page.locator("html")).toHaveAttribute(
      "data-luca-frame",
      "solid",
      { timeout: 20_000 },
    );
    await openGeneral(page);
    await page.mouse.move(size.width - 10, 10);
    await openMenu(page);
    const before = await menuLayout(page);
    files.push(await shot(page, dir, label));
    // The wheel over the list reaches the last community.
    let after = before;
    if (before.list) {
      await page.mouse.move(
        before.list.x + before.list.w / 2,
        before.list.y + before.list.h / 2,
      );
      for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, 240);
      await page.waitForTimeout(300);
      after = await menuLayout(page);
      if (
        before.list_scroll &&
        before.list_scroll.scroll > before.list_scroll.client
      ) {
        files.push(await shot(page, dir, `${label}-scrolled`));
      }
    }
    const lastVisible =
      !!after.last_row &&
      !!after.list &&
      after.last_row.y >= after.list.y - 0.5 &&
      after.last_row.y + after.last_row.h <=
        after.list.y + after.list.h + 0.5 &&
      inside(after.last_row, after.window);
    // Add community: in the window, and it opens its dialog.
    await page.getByTestId("shell-community-add").click({ timeout: 5_000 });
    const dialog = page.getByRole("dialog", { name: "Add Community" });
    const dialogOpens = await dialog
      .waitFor({ state: "visible", timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const avatarBox = await box(page, AVATAR);
    const menuBottomOnAvatar =
      !!avatarBox &&
      !!before.menu &&
      Math.abs(before.menu.y + before.menu.h - (avatarBox.y + avatarBox.h)) <=
        0.5;
    const entry = {
      avatar: avatarBox,
      menu_bottom_on_avatar: menuBottomOnAvatar,
      rows: before.rows,
      window: before.window,
      menu: before.menu,
      identity: before.identity,
      settings: before.settings,
      add: before.add,
      list: before.list,
      list_scroll_before: before.list_scroll,
      list_scroll_after: after.list_scroll,
      last_row_after_wheel: after.last_row,
      menu_in_window: inside(before.menu, before.window),
      identity_in_window: inside(before.identity, before.window),
      settings_in_window: inside(before.settings, before.window),
      add_in_window: inside(before.add, before.window),
      last_row_reached: lastVisible,
      add_opens_dialog: dialogOpens,
    };
    const entryOk =
      menuBottomOnAvatar &&
      entry.rows === count &&
      entry.menu_in_window &&
      entry.identity_in_window &&
      entry.settings_in_window &&
      entry.add_in_window &&
      lastVisible &&
      dialogOpens;
    result[label] = { ...entry, ok: entryOk };
    ok &&= entryOk;
    await context.close();
  }
  checks.menu_fits_window = { ...result, ok };
  checks.console_many = errors;
  record(dir);
});

test("the menu's rows end on one trailing edge", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  const result: Record<string, unknown> = {};
  let ok = true;
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    const context = await browser.newContext({
      baseURL: info.project.use.baseURL,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await openApp(page, { communities: 2, frame: true, size });
    await openGeneral(page);
    await page.mouse.move(size.width - 10, 10);
    await openMenu(page);
    // The strip's unread marks, drawn with the rows' own markup, to measure
    // where every kind of mark ends.
    await page.evaluate((id) => {
      const button = document.querySelector(
        `[data-testid="shell-community-switch-${id}"]`,
      );
      if (!button) return;
      const mark = document.createElement("span");
      mark.className = "luca-shell-community-mark";
      mark.innerHTML =
        '<span class="luca-shell-community-count" data-probe="count">3</span>';
      button.append(mark);
    }, SECOND.id);
    await settle(page);
    const measure = () =>
      page.evaluate(
        ({ first, second }) => {
          const right = (selector: string) => {
            const element = document.querySelector(selector);
            return element ? element.getBoundingClientRect().right : null;
          };
          const opacity = (selector: string) => {
            const element = document.querySelector(selector);
            return element ? getComputedStyle(element).opacity : null;
          };
          const row = document.querySelector(
            `[data-testid="shell-community-${first}"]`,
          );
          return {
            row_right: row?.getBoundingClientRect().right ?? null,
            settings_kbd: right('[data-testid="profile-popover-settings"] kbd'),
            check: right(`[data-testid="shell-community-current-${first}"]`),
            count: right('[data-probe="count"]'),
            switch_button: right(
              `[data-testid="shell-community-switch-${first}"]`,
            ),
            more_glyph: right(
              `[data-testid="shell-community-more-${first}"] svg`,
            ),
            more_opacity: opacity(
              `[data-testid="shell-community-more-${first}"]`,
            ),
            mark_opacity: opacity(
              `[data-testid="shell-community-${first}"] .luca-shell-community-mark`,
            ),
            other_more_opacity: opacity(
              `[data-testid="shell-community-more-${second}"]`,
            ),
          };
        },
        { first: FIRST_ID, second: SECOND.id },
      );
    const rest = await measure();
    const menu = await box(page, '[data-testid="profile-popover"]');
    const clip = menu
      ? { x: menu.x - 8, y: menu.y - 8, w: menu.w + 16, h: menu.h + 16 }
      : undefined;
    files.push(
      await shot(
        page,
        dir,
        `trailing-edge-rest-${size.width}x${size.height}`,
        clip,
      ),
    );
    await page.getByTestId(`shell-community-${FIRST_ID}`).hover();
    await page.waitForTimeout(300);
    const hover = await measure();
    files.push(
      await shot(
        page,
        dir,
        `trailing-edge-hover-${size.width}x${size.height}`,
        clip,
      ),
    );
    // The ⋯ opened by the keyboard holds the slot.
    await page.getByTestId(`shell-community-more-${FIRST_ID}`).click();
    await page.mouse.move(size.width - 10, 10);
    await page.waitForTimeout(300);
    const opened = await measure();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const label = `${size.width}x${size.height}`;
    const near = (a: number | null, b: number | null) =>
      a !== null && b !== null && Math.abs(a - b) <= 0.5;
    const entryOk =
      near(rest.check, rest.settings_kbd) &&
      near(rest.count, rest.settings_kbd) &&
      near(rest.switch_button, rest.row_right) &&
      near(hover.more_glyph, rest.settings_kbd) &&
      rest.more_opacity === "0" &&
      rest.mark_opacity === "1" &&
      hover.more_opacity === "1" &&
      hover.mark_opacity === "0" &&
      hover.other_more_opacity === "0" &&
      opened.more_opacity === "1" &&
      opened.mark_opacity === "0";
    result[label] = { rest, hover, more_open: opened, ok: entryOk };
    ok &&= entryOk;
    await context.close();
  }
  checks.trailing_edge = { ...result, ok };
  record(dir);
});

test("Add community opens on every route, Settings too", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  const result: Record<string, unknown> = {};
  let ok = true;
  await openApp(page, { communities: 2, frame: true });
  await openGeneral(page);
  for (const route of ["general", "settings"] as const) {
    if (route === "settings") {
      await page.evaluate(() => {
        location.hash = "#/settings";
      });
      await expect(page.locator("[data-luca-settings-frame]")).toBeVisible({
        timeout: 20_000,
      });
    }
    await page.mouse.move(700, 500);
    await openMenu(page);
    const started = Date.now();
    await page.getByTestId("shell-community-add").click();
    const dialog = page.getByRole("dialog", { name: "Add Community" });
    const opened = await dialog
      .waitFor({ state: "visible", timeout: 1_200 })
      .then(() => Date.now() - started)
      .catch(() => null);
    await page.waitForTimeout(300);
    const dialogs = await page.getByRole("dialog").count();
    files.push(await shot(page, dir, `add-community-${route}`));
    const hash = await page.evaluate(() => location.hash);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const hashAfter = await page.evaluate(() => location.hash);
    const entryOk =
      opened !== null &&
      dialogs === 1 &&
      hash === hashAfter &&
      (route !== "settings" || hash === "#/settings");
    result[route] = {
      opened_after_ms: opened,
      dialogs,
      hash,
      hash_after_close: hashAfter,
      ok: entryOk,
    };
    ok &&= entryOk;
  }
  checks.add_community_every_route = { ...result, ok };
  record(dir);
});

test("the community tiles follow the text size", async ({ page }, info) => {
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  const result: Record<string, unknown> = {};
  let ok = true;
  await openApp(page, { communities: 4, frame: true });
  await openGeneral(page);
  for (const [zoom, root] of [
    [75, "12px"],
    [100, "16px"],
    [150, "24px"],
  ] as const) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, root);
    await page.mouse.move(1400, 10);
    await openMenu(page);
    const tiles = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-testid="profile-popover"] .luca-shell-community-icon',
        ),
      ].map((tile) => {
        const element = tile as HTMLElement;
        const r = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const icon = element.querySelector("svg");
        const iconBox = icon?.getBoundingClientRect();
        return {
          text: element.textContent,
          w: r.width,
          h: r.height,
          radius: style.borderRadius,
          font: style.fontSize,
          scroll_w: element.scrollWidth,
          client_w: element.clientWidth,
          icon: iconBox ? { w: iconBox.width, h: iconBox.height } : null,
        };
      }),
    );
    const avatar = await box(
      page,
      '[data-testid="profile-popover"] [role="menu"] > div > :first-child',
    );
    const menu = await box(page, '[data-testid="profile-popover"]');
    files.push(
      await shot(
        page,
        dir,
        `tiles-zoom-${zoom}`,
        menu
          ? { x: menu.x - 8, y: menu.y - 8, w: menu.w + 16, h: menu.h + 16 }
          : undefined,
      ),
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("profile-popover")).toBeHidden();
    const expected = (20 * zoom) / 100;
    const entryOk =
      tiles.length === 5 &&
      tiles.every(
        (tile) =>
          Math.abs(tile.w - expected) <= 0.5 &&
          Math.abs(tile.h - expected) <= 0.5 &&
          tile.scroll_w <= tile.client_w &&
          (!tile.icon || (tile.icon.w <= tile.w && tile.icon.h <= tile.h)),
      );
    result[`${zoom}%`] = { tiles, menu_avatar: avatar, ok: entryOk };
    ok &&= entryOk;
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  checks.tiles_scale = { ...result, ok };
  record(dir);
});

test("the DEV chip's letters sit on its centre", async ({ page }, info) => {
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  await openApp(page, { devBuild: true, frame: true });
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-frame",
    "solid",
    { timeout: 20_000 },
  );
  await openGeneral(page);
  await page.locator(AVATAR).click();
  const popover = page.getByTestId("profile-popover");
  await expect(popover).toBeVisible();
  await page.mouse.move(700, 500);
  await page.waitForTimeout(400);
  await settle(page);
  const chip = await box(
    page,
    '[data-testid="profile-popover"] [data-testid="sidebar-dev-build-chip"]',
  );
  if (!chip) throw new Error("No DEV chip in the menu.");
  const gaps = await inkGaps(page, chip);
  const styles = await page.evaluate(() => {
    const chip = document.querySelector(
      '[data-testid="profile-popover"] [data-testid="sidebar-dev-build-chip"]',
    ) as HTMLElement;
    const style = getComputedStyle(chip);
    return {
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      letter_spacing: style.letterSpacing,
    };
  });
  const menu = await box(page, '[data-testid="profile-popover"]');
  if (menu) {
    files.push(
      await shot(page, dir, "dev-chip", {
        x: menu.x - 8,
        y: menu.y - 8,
        w: 300,
        h: 72,
      }),
    );
  }
  files.push(
    await shot(page, dir, "dev-chip-zoom", {
      x: chip.x - 3,
      y: chip.y - 3,
      w: chip.w + 6,
      h: chip.h + 6,
    }),
  );
  checks.dev_chip_centred = {
    chip,
    ...styles,
    gaps,
    ok:
      !!gaps &&
      Math.abs(gaps.left - gaps.right) <= 0.5 &&
      Math.abs(gaps.top - gaps.bottom) <= 0.5,
  };
  record(dir);
});

test("the flag off draws the base build", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  if (!reachable) {
    checks.flag_off_identical = { ok: null, note: `${BASE_URL} not reached` };
    record(dir);
    return;
  }
  const result: Record<string, unknown> = {};
  let ok = true;
  for (const communities of [1, 2] as const) {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 800, height: 500 },
    ]) {
      const label = `flag-off-${communities}c-${size.width}x${size.height}`;
      const hashes: Record<string, string> = {};
      for (const [which, origin] of [
        ["ours", ""],
        ["base", BASE_URL],
      ] as const) {
        // A busy machine can leave a first load blank: one fresh try more.
        let context = await browser.newContext({
          baseURL: info.project.use.baseURL,
          deviceScaleFactor: 2,
        });
        let page = await context.newPage();
        for (let attempt = 0; ; attempt += 1) {
          // Both builds start their clocks at the same minute, and hold the
          // residents' eyes still, so two captures can match by hash.
          await context.clock.install({
            time: new Date("2026-10-24T18:30:00"),
          });
          try {
            await openApp(page, { communities, frame: false, origin, size });
            await page.emulateMedia({
              colorScheme: "dark",
              reducedMotion: "reduce",
            });
            await openGeneral(page, { frame: false });
            break;
          } catch (error) {
            await context.close();
            if (attempt >= 1) throw error;
            context = await browser.newContext({
              baseURL: info.project.use.baseURL,
              deviceScaleFactor: 2,
            });
            page = await context.newPage();
          }
        }
        if (communities === 2) {
          await expect(page.getByTestId("community-rail")).toBeVisible({
            timeout: 20_000,
          });
        }
        await page.mouse.move(size.width - 10, size.height - 10);
        await page.waitForTimeout(600);
        const file = await shot(page, dir, `${label}-${which}`);
        files.push(file);
        hashes[which] = sha(file);
        await context.close();
      }
      result[label] = { ...hashes, same: hashes.ours === hashes.base };
      ok &&= hashes.ours === hashes.base;
    }
  }
  checks.flag_off_identical = { ...result, ok };
  record(dir);
});
