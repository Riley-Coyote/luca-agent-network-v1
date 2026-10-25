import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * Settings in the shell's frame (docs/luca/rail-system/SHELL_BUILD.md,
 * WP-05). Measures Settings against SHELL_SPEC.md ("Settings") and proves
 * the flag off draws exactly the base build, by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks.json go (else the test's
 * output folder). SHELL_BASE_URL: the base build to compare the flag-off
 * shots against (default http://127.0.0.1:4300); unreachable, the
 * comparison is reported as not run.
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };

function shotsDir(fallback: string) {
  const dir = process.env.SHELL_SHOTS ?? fallback;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Loads the app. On a busy machine the static server can drop a burst of
 *  chunk requests (ERR_CONNECTION_RESET) and leave it unbooted: load again. */
async function boot(page: Page, origin: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${origin}/?e2e=mock`);
    const booted = await page
      .locator("[data-luca-conversation-surface]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (booted) return;
  }
}

async function openApp(
  page: Page,
  {
    frame,
    origin = "",
    size = { width: 1440, height: 900 },
  }: {
    frame: boolean;
    origin?: string;
    size?: { width: number; height: number };
  },
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: "dark" });
  await installMockBridge(page);
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
  await boot(page, origin);
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

async function radius(page: Page, selector: string) {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    return element ? getComputedStyle(element).borderTopLeftRadius : null;
  }, selector);
}

const LIST_CARD = '[data-luca-settings-list] [data-sidebar="sidebar"]';
const PANELS_CARD = '[data-testid="settings-content-surface"]';
const SKELETON_LIST_CARD =
  '[data-testid="settings-loading-fallback"] [data-luca-settings-list] [data-sidebar="sidebar"]';
const SKELETON_PANELS_CARD =
  '[data-testid="settings-loading-fallback"] [data-buzz-content-surface]';

/** The rail card's place: x 44, top 36, 220 wide, 6 above the bottom. */
function inRailPlace(b: Box | null, H: number) {
  return (
    !!b && b.x === 44 && b.y === 36 && b.w === 220 && H - (b.y + b.h) === 6
  );
}

/** The conversation card's place: left at `left`, top 36, 6 right and bottom. */
function inCardPlace(b: Box | null, W: number, H: number, left: number) {
  return (
    !!b &&
    b.x === left &&
    b.y === 36 &&
    W - (b.x + b.w) === 6 &&
    H - (b.y + b.h) === 6
  );
}

async function openGeneral(page: Page) {
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general");
}

async function openSettingsFromPlaces(page: Page) {
  await page.getByTestId("open-settings-view").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.locator('[data-testid^="settings-panel-"]')).toBeVisible();
}

/** The list card's width, every frame, while the lip's toggle closes it. */
async function sampleListSlide(page: Page, ms: number) {
  return page.evaluate(
    ({ ms, list, panels }) =>
      new Promise<number[][]>((resolve) => {
        const q = (s: string) => document.querySelector(s) as HTMLElement;
        const samples: number[][] = [];
        const start = performance.now();
        q('[data-testid="shell-lip-toggle"]').click();
        const step = () => {
          const t = performance.now() - start;
          samples.push([
            t,
            q(list).getBoundingClientRect().width,
            q(panels).getBoundingClientRect().x,
          ]);
          if (t < ms) requestAnimationFrame(step);
          else resolve(samples);
        };
        requestAnimationFrame(step);
      }),
    { ms, list: LIST_CARD, panels: PANELS_CARD },
  );
}

test("Settings in the frame", async ({ page }, info) => {
  test.setTimeout(180_000);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];
  const W = 1440;
  const H = 900;

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await openApp(page, { frame: true });
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-frame",
    "solid",
    { timeout: 60_000 },
  );
  await openGeneral(page);
  const historyAtConversation = await page.evaluate(() => history.length);
  await openSettingsFromPlaces(page);
  await page.mouse.move(700, 500);
  await page.waitForTimeout(400);

  // ── the frame stays ───────────────────────────────────────────────
  const lip = await box(page, '[data-testid="shell-lip"]');
  const places = await box(page, '[data-testid="shell-places"]');
  const toggle = await box(page, '[data-testid="shell-lip-toggle"]');
  const back = await box(page, '[data-testid="global-back"]');
  const settingsTile = page.getByTestId("open-settings-view");
  const current = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="shell-places"] [aria-current]',
      ),
    ].map((element) => element.getAttribute("data-testid")),
  );
  const iconCentres = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="shell-places"] :is(.luca-place, .luca-place-search button, .luca-shell-avatar)',
      ),
    ].map((element) => {
      const r = element.getBoundingClientRect();
      return r.x + r.width / 2;
    }),
  );
  checks.frame_kept = {
    lip: lip,
    places_width: places?.w ?? null,
    place_icons: iconCentres.length,
    icons_on_axis: iconCentres.every((cx) => cx === 22),
    current_places: current,
    settings_plate: await settingsTile.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    toggle: toggle ? [toggle.x, toggle.y] : null,
    back: back ? [back.x, back.y] : null,
    back_enabled: await page.getByTestId("global-back").isEnabled(),
    name: await page.getByTestId("shell-lip-name").innerText(),
    top_chrome: await page.getByTestId("app-top-chrome").count(),
    ok:
      lip?.h === 36 &&
      lip.w === W &&
      places?.w === 44 &&
      iconCentres.length >= 8 &&
      iconCentres.every((cx) => cx === 22) &&
      current.join(",") === "open-settings-view" &&
      toggle?.x === 78 &&
      toggle.y === 10 &&
      back?.x === 274 &&
      back.y === 10 &&
      (await page.getByTestId("shell-lip-name").innerText()) === "Settings",
  };

  // Appearance, from the list.
  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByTestId("settings-panel-appearance")).toBeVisible();
  await page.mouse.move(700, 500);
  await page.waitForTimeout(500);
  files.push(await shot(page, dir, "appearance"));

  // ── the section list in the rail card's place ─────────────────────
  const list = await box(page, LIST_CARD);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("[data-settings-row]")].map((element) => {
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        id: element.getAttribute("data-testid"),
        x: r.x,
        w: r.width,
        h: r.height,
        size: style.fontSize,
        radius: style.borderTopLeftRadius,
        colour: style.color,
        background: style.backgroundColor,
        current: element.getAttribute("aria-current"),
      };
    }),
  );
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll(".luca-settings-group-head")].map(
      (element) => {
        const style = getComputedStyle(element);
        return {
          text: (element as HTMLElement).innerText,
          h: element.getBoundingClientRect().height,
          family: style.fontFamily.split(",")[0],
          size: style.fontSize,
          transform: style.textTransform,
        };
      },
    ),
  );
  checks.section_list_card = {
    box: list,
    bottom: list ? H - (list.y + list.h) : null,
    radius: await radius(page, LIST_CARD),
    groups: heads,
    rows: rows.length,
    row_sample: rows.slice(2, 4),
    current_rows: rows.filter((row) => row.current).map((row) => row.id),
    back_to_app: await page.getByTestId("settings-back-to-app").count(),
    version: await page.getByTestId("settings-version").count(),
    ok:
      inRailPlace(list, H) &&
      (await radius(page, LIST_CARD)) === "10px" &&
      heads.length === 4 &&
      heads.every(
        (head) =>
          head.h === 26 &&
          head.size === "11px" &&
          head.transform === "uppercase",
      ) &&
      rows.length === 12 &&
      rows.every(
        (row) =>
          row.h === 30 &&
          row.x === 50 &&
          row.w === 208 &&
          row.size === "14px" &&
          row.radius === "8px",
      ) &&
      rows
        .filter((row) => row.current)
        .map((row) => row.id)
        .join() === "settings-nav-appearance",
  };

  // ── the panels in the conversation card's place ───────────────────
  const panels = await box(page, PANELS_CARD);
  checks.panels_in_card = {
    box: panels,
    right: panels ? W - (panels.x + panels.w) : null,
    bottom: panels ? H - (panels.y + panels.h) : null,
    gap_to_list: panels && list ? panels.x - (list.x + list.w) : null,
    radius: await radius(page, PANELS_CARD),
    panel_inside: await page.evaluate(
      () =>
        !!document.querySelector(
          '[data-testid="settings-content-surface"] [data-testid="settings-panel-appearance"]',
        ),
    ),
    name_delta: await page.evaluate(() => {
      const name = document
        .querySelector('[data-testid="shell-lip-name"]')
        ?.getBoundingClientRect();
      const card = document
        .querySelector('[data-testid="settings-content-surface"]')
        ?.getBoundingClientRect();
      return name && card
        ? Math.abs(name.x + name.width / 2 - (card.x + card.width / 2))
        : null;
    }),
    ok:
      inCardPlace(panels, W, H, 268) &&
      (await radius(page, PANELS_CARD)) === "10px",
  };

  // The wide section.
  await page.getByTestId("settings-nav-agents").click();
  await expect(page.getByTestId("settings-panel-agents")).toBeVisible();
  await page.mouse.move(700, 500);
  await page.waitForTimeout(700);
  files.push(await shot(page, dir, "agents"));
  const agentsCard = await box(page, PANELS_CARD);
  checks.panels_in_card = {
    ...(checks.panels_in_card as object),
    agents_box: agentsCard,
    ok:
      (checks.panels_in_card as { ok: boolean }).ok &&
      inCardPlace(agentsCard, W, H, 268),
  };

  // ── section switches replace the history entry ────────────────────
  const historyInSettings = await page.evaluate(() => history.length);
  for (const id of ["notifications", "shortcuts", "about", "appearance"]) {
    await page.getByTestId(`settings-nav-${id}`).click();
    await expect(page.getByTestId(`settings-panel-${id}`)).toBeVisible();
  }
  const historyAfter = await page.evaluate(() => history.length);
  checks.history_replace = {
    history_at_conversation: historyAtConversation,
    history_entering_settings: historyInSettings,
    history_after_four_switches: historyAfter,
    url: page.url(),
    ok:
      historyInSettings === historyAtConversation + 1 &&
      historyAfter === historyInSettings &&
      /section=appearance/.test(page.url()),
  };

  // ── arrow keys between the rows ───────────────────────────────────
  await page.getByTestId("settings-nav-appearance").focus();
  await page.keyboard.press("ArrowDown");
  const arrowed = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-testid"),
  );
  checks.arrow_keys = {
    focused_after_down: arrowed,
    ok: arrowed === "settings-nav-notifications",
  };
  await page.mouse.click(900, 600);

  // ── the toggle closes the list, with the rail's motion ────────────
  const slide = await sampleListSlide(page, 620);
  await page.waitForTimeout(200);
  await page.mouse.move(700, 500);
  files.push(await shot(page, dir, "list-closed"));
  const closedList = await box(page, LIST_CARD);
  const closedPanels = await box(page, PANELS_CARD);
  const listPanelInert = await page.evaluate(
    () =>
      (document.querySelector("[data-luca-settings-list]") as HTMLElement)
        ?.inert ?? null,
  );
  const mid = slide.filter(([t]) => t > 150 && t < 300);
  checks.toggle_closes_list = {
    frames: slide.length,
    mid_slide_widths: mid.map(([, w]) => Math.round(w)),
    mid_slide_panel_left: mid.map(([, , x]) => Math.round(x)),
    closed_list_width: closedList?.w ?? null,
    closed_panels: closedPanels,
    list_inert: listPanelInert,
    lip_toggle_expanded: await page
      .getByTestId("shell-lip-toggle")
      .getAttribute("aria-expanded"),
    back_x_closed: (await box(page, '[data-testid="global-back"]'))?.x ?? null,
    ok:
      slide.length >= 8 &&
      mid.length > 0 &&
      mid.every(([, w]) => w > 0 && w < 220) &&
      (closedList?.w ?? 1) === 0 &&
      inCardPlace(closedPanels, W, H, 44) &&
      listPanelInert === true,
  };

  // The list stays closed when Settings is left and opened again: nothing
  // forces it open.
  await page.keyboard.press("ControlOrMeta+,");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+,");
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.waitForTimeout(600);
  const stillClosed = (await box(page, LIST_CARD))?.w ?? null;

  // ⌘S opens it again, and closes it.
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(700);
  const openedByKey = await box(page, LIST_CARD);
  const panelsOpened = await box(page, PANELS_CARD);
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(700);
  const closedByKey = (await box(page, LIST_CARD))?.w ?? null;
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(700);

  // ⌘, leaves Settings, and opens it again.
  await page.keyboard.press("ControlOrMeta+,");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  const leftByComma = page.url();
  await page.keyboard.press("ControlOrMeta+,");
  await expect(page.getByTestId("settings-view")).toBeVisible();
  checks.shortcut_toggles = {
    list_after_reload_closed: stillClosed,
    cmd_s_opens: openedByKey,
    panels_after_open: panelsOpened,
    cmd_s_closes_width: closedByKey,
    cmd_comma_left_to: leftByComma,
    cmd_comma_reopens: true,
    ok:
      stillClosed === 0 &&
      inRailPlace(openedByKey, H) &&
      inCardPlace(panelsOpened, W, H, 268) &&
      closedByKey === 0 &&
      !/\/settings/.test(leftByComma),
  };

  // ── back, Conversations and Escape leave Settings ─────────────────
  await boot(page, new URL(page.url()).origin);
  await openGeneral(page);
  await openSettingsFromPlaces(page);
  await page.getByTestId("global-back").click();
  const backTo = await page.getByTestId("shell-lip-name").innerText();
  await openSettingsFromPlaces(page);
  await page.getByTestId("shell-place-conversations").click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  const conversationsTo = page.url();
  await openGeneral(page);
  await openSettingsFromPlaces(page);
  await page.getByTestId("settings-nav-appearance").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general");
  await page.mouse.move(700, 500);
  await page.waitForTimeout(500);
  files.push(await shot(page, dir, "escape"));
  checks.back_and_escape = {
    back_to_app_buttons: 0,
    lip_back_to: backTo,
    conversations_place_to: conversationsTo,
    escape_to: await page.getByTestId("shell-lip-name").innerText(),
    ok:
      backTo === "general" &&
      !/\/settings/.test(conversationsTo) &&
      (await page.getByTestId("shell-lip-name").innerText()) === "general",
  };

  // ── the loading skeleton, drawn as the frame ──────────────────────
  // A fresh page, with the settings chunk held back so the fallback shows.
  const release: Array<() => void> = [];
  await page.route(/SettingsScreen-[^/]*\.js$/, async (route) => {
    await new Promise<void>((resolve) => release.push(resolve));
    await route.continue().catch(() => undefined);
  });
  await boot(page, new URL(page.url()).origin);
  await openGeneral(page);
  await page.getByTestId("open-settings-view").click();
  await expect(page.getByTestId("settings-loading-fallback")).toBeVisible();
  await page.mouse.move(700, 500);
  await page.waitForTimeout(500);
  files.push(await shot(page, dir, "loading"));
  const skeletonList = await box(page, SKELETON_LIST_CARD);
  const skeletonPanels = await box(page, SKELETON_PANELS_CARD);
  checks.loading_skeleton = {
    list: skeletonList,
    panels: skeletonPanels,
    lip: (await box(page, '[data-testid="shell-lip"]'))?.h ?? null,
    places: (await box(page, '[data-testid="shell-places"]'))?.w ?? null,
    settings_current: await page
      .getByTestId("open-settings-view")
      .getAttribute("aria-current"),
    ok:
      inRailPlace(skeletonList, H) &&
      inCardPlace(skeletonPanels, W, H, 268) &&
      (await radius(page, SKELETON_LIST_CARD)) === "10px" &&
      (await radius(page, SKELETON_PANELS_CARD)) === "10px",
  };
  for (const go of release) go();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  const loadedList = await box(page, LIST_CARD);
  checks.loading_skeleton = {
    ...(checks.loading_skeleton as object),
    loaded_list_same_place: inRailPlace(loadedList, H),
    ok:
      (checks.loading_skeleton as { ok: boolean }).ok &&
      inRailPlace(loadedList, H) &&
      (checks.loading_skeleton as { settings_current: string | null })
        .settings_current === "page",
  };

  // ── the smallest window, 800 × 500 ────────────────────────────────
  await page.setViewportSize({ width: 800, height: 500 });
  await page.getByTestId("settings-nav-appearance").click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(700);
  files.push(await shot(page, dir, "appearance-800x500"));
  const smallList = await box(page, LIST_CARD);
  const smallPanels = await box(page, PANELS_CARD);
  const listScrolls = await page.evaluate(() => {
    const element = document.querySelector(".luca-settings-list");
    return element ? element.scrollHeight > element.clientHeight : null;
  });
  checks.min_window = {
    list: smallList,
    panels: smallPanels,
    list_scrolls: listScrolls,
    ok:
      inRailPlace(smallList, 500) &&
      inCardPlace(smallPanels, 800, 500, 268) &&
      listScrolls === true,
  };

  // ── narrow, under 768: the frame, with the list as the rail's sheet ─
  await page.setViewportSize({ width: 700, height: 600 });
  await page.waitForTimeout(700);
  await page.mouse.move(400, 300);
  files.push(await shot(page, dir, "narrow"));
  const narrowPanels = await box(page, PANELS_CARD);
  const narrowLip = await box(page, '[data-testid="shell-lip"]');
  const narrowPlaces = await box(page, '[data-testid="shell-places"]');
  const narrowHeader = await page
    .getByRole("button", { name: "Open settings navigation" })
    .count();
  await page.getByTestId("shell-lip-toggle").click();
  await expect(page.getByTestId("settings-section-list")).toBeVisible();
  await page.waitForTimeout(700);
  files.push(await shot(page, dir, "narrow-list-open"));
  await page.getByTestId("settings-nav-shortcuts").click();
  await expect(page.getByTestId("settings-panel-shortcuts")).toBeVisible();
  await page.waitForTimeout(600);
  const sheetClosedAfterPick =
    (await page.getByTestId("settings-section-list").count()) === 0;
  checks.narrow_layout = {
    lip: narrowLip,
    places_width: narrowPlaces?.w ?? null,
    panels: narrowPanels,
    old_header_buttons: narrowHeader,
    toggle_opens_list_sheet: true,
    sheet_closes_after_pick: sheetClosedAfterPick,
    ok:
      narrowLip?.h === 36 &&
      narrowPlaces?.w === 44 &&
      inCardPlace(narrowPanels, 700, 600, 44) &&
      narrowHeader === 0 &&
      sheetClosedAfterPick,
  };

  checks.console = { errors: consoleErrors, ok: true };
  const failing = Object.entries(checks)
    .filter(([, value]) => !(value as { ok?: boolean }).ok)
    .map(([key]) => key);
  checks.failing = failing;
  writeFileSync(
    path.join(dir, "checks.json"),
    `${JSON.stringify({ checks, files }, null, 2)}\n`,
  );
  expect(failing).toEqual([]);
});

test("flag off draws the base build exactly", async ({ browser }, info) => {
  test.setTimeout(600_000);
  const dir = shotsDir(info.outputPath());
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);

  // Settings at three sections and three sizes, the same way in both builds.
  const capture = async (origin: string, label: string) => {
    const out: Record<string, string> = {};
    for (const [name, size, sections] of [
      [
        "1440x900",
        { width: 1440, height: 900 },
        ["profile", "appearance", "agents"],
      ],
      ["800x500", { width: 800, height: 500 }, ["appearance"]],
      ["narrow", { width: 700, height: 600 }, ["appearance"]],
    ] as const) {
      // A shot counts only if every request behind it loaded: on a busy
      // machine the static server drops some (the palettes' previews then
      // fall back to plain tiles), so such a take is taken again.
      for (let take = 0; take < 4; take += 1) {
        const context = await browser.newContext({ deviceScaleFactor: 2 });
        // Both builds start their clocks at the same minute.
        await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
        const page = await context.newPage();
        let dropped = 0;
        page.on("requestfailed", () => {
          dropped += 1;
        });
        try {
          await openApp(page, { frame: false, origin, size });
          await page.emulateMedia({
            colorScheme: "dark",
            reducedMotion: "reduce",
          });
          await expect(
            page.locator("[data-luca-conversation-surface]").first(),
          ).toBeAttached({ timeout: 60_000 });
          await page.keyboard.press("ControlOrMeta+,");
          await expect(page.getByTestId("settings-view")).toBeVisible();
          for (const section of sections) {
            if (section !== "profile") {
              if (size.width < 768) {
                await page
                  .getByRole("button", { name: "Open settings navigation" })
                  .click();
              }
              await page.getByTestId(`settings-nav-${section}`).click();
            }
            await expect(
              page.getByTestId(`settings-panel-${section}`),
            ).toBeVisible();
            await page.mouse.move(size.width - 1, size.height - 1);
            // The palettes' previews load their colours on their own.
            await page.waitForLoadState("networkidle");
            await page.waitForTimeout(800);
            out[`${section}-${name}`] = await shot(
              page,
              dir,
              `flag-off-settings-${section}-${name}${label}`,
            );
          }
        } catch (error) {
          // A dropped chunk can stop a screen rendering at all.
          if (take === 3) throw error;
          dropped += 1;
        }
        await context.close();
        if (dropped === 0) break;
      }
    }
    return out;
  };

  const ours = await capture(info.project.use.baseURL ?? "", "");
  const base = reachable ? await capture(BASE_URL, "-base") : null;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(ours)) {
    result[key] = {
      ours: sha(ours[key]),
      base: base ? sha(base[key]) : "not run",
      identical: base ? sha(ours[key]) === sha(base[key]) : "not run",
    };
  }
  writeFileSync(
    path.join(dir, "checks-flag-off.json"),
    `${JSON.stringify(
      {
        flag_off_identical: result,
        files: [...Object.values(ours), ...Object.values(base ?? {})],
      },
      null,
      2,
    )}\n`,
  );
  test.skip(!reachable, `base build not reachable at ${BASE_URL}`);
  for (const key of Object.keys(ours)) {
    expect
      .soft((result[key] as { identical: boolean }).identical, key)
      .toBe(true);
  }
});
