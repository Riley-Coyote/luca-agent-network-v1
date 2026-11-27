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

// Each spec writes to its own folder under SHELL_SHOTS, so its hash checks
// compare its own shots and no other spec's (WP-28, Decided 6).
const SHELL_SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "shell-settings")
  : undefined;

function shotsDir(fallback: string) {
  const dir = SHELL_SHOTS ?? fallback;
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
  // Every shot in the Vitesse Black palette, the dark default (WP-05b, 5).
  await page.addInitScript(() => {
    if (!localStorage.getItem("buzz-theme")) {
      localStorage.setItem("buzz-theme", "vitesse-black");
    }
  });
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

/** The palette every shot was taken in, by file (WP-05b, 5). */
const palettes = new Map<string, string | null>();

const paletteOf = (page: Page) =>
  page.evaluate(() => localStorage.getItem("buzz-theme"));

async function shot(page: Page, dir: string, name: string) {
  await settle(page);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  palettes.set(file, await paletteOf(page));
  return file;
}

/** Empty frame: the floor at the window's foot, beneath the panels' card
 *  (6 tall, nothing drawn on it), so a click there only takes focus away. */
async function clickEmptyFrame(page: Page) {
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  const point = { x: Math.round(size.width * 0.6), y: size.height - 3 };
  const target = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      tag: element?.tagName ?? null,
      interactive: !!element?.closest(
        "button, a, input, select, textarea, [role=button], [role=radio]",
      ),
      inCard: !!element?.closest(
        "[data-luca-conversation-surface], [data-sidebar=sidebar]",
      ),
    };
  }, point);
  await page.mouse.click(point.x, point.y);
  return { point, ...target };
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

/** The conversation card's place: left at `left` (264 with the list open:
 *  its hairline on the one card, WP-12), top 36, 6 right and bottom. */
function inCardPlace(b: Box | null, W: number, H: number, left: number) {
  return (
    !!b &&
    b.x === left &&
    b.y === 36 &&
    W - (b.x + b.w) === 6 &&
    H - (b.y + b.h) === 6
  );
}

/** The mock's #general. */
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

async function openGeneral(page: Page) {
  // Opened by its route, from Settings too: the shell's rail groups chats by
  // home (WP-02). Retried, because a fresh page's own first redirect can land
  // after the route is set.
  // The app has booted: the Chats rail's rows, another place's rail (each
  // place has its own: WP-10), or Settings (where the rail is not mounted).
  await page.waitForSelector(
    '[data-testid="app-sidebar"] :is([data-channel-id], [data-place-rail]), [data-testid="settings-view"]',
    { timeout: 20_000 },
  );
  await expect(async () => {
    await page.evaluate((id) => {
      location.hash = `#/channels/${id}`;
    }, GENERAL_CHANNEL_ID);
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
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
      // Search, eight places (Home since 8e4693bfe, Mnemos since 77f4258c3)
      // and the avatar.
      iconCentres.length === 10 &&
      iconCentres.every((cx) => cx === 22) &&
      current.join(",") === "open-settings-view" &&
      // No native lights in a browser: the toggle on the places' axis, its
      // centre at 22, its left at 10 (WP-08g).
      toggle?.x === 10 &&
      toggle.y === 10 &&
      back?.x === 270 &&
      back.y === 10 &&
      // The lip names the section (WP-17, 2).
      (await page.getByTestId("shell-lip-name").innerText()) ===
        "Profile & identity",
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
          // WP-40 (BETA14_RELEASE.md, Decided 1), after WP-37: every
          // place's rail heads are the mono capitals at 11, 28 tall.
          head.h === 28 &&
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
      inCardPlace(panels, W, H, 264) &&
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
      inCardPlace(agentsCard, W, H, 264),
  };

  // ── section switches are history steps (WP-17, from the flows review;
  //    WP-05 replaced the entry) ───────────────────────────────────────
  const historyInSettings = await page.evaluate(() => history.length);
  for (const id of ["notifications", "shortcuts", "about", "appearance"]) {
    await page.getByTestId(`settings-nav-${id}`).click();
    await expect(page.getByTestId(`settings-panel-${id}`)).toBeVisible();
  }
  const historyAfter = await page.evaluate(() => history.length);
  checks.history_steps = {
    history_at_conversation: historyAtConversation,
    history_entering_settings: historyInSettings,
    history_after_four_switches: historyAfter,
    url: page.url(),
    // Every section opened since the conversation is a step of its own.
    ok:
      historyInSettings > historyAtConversation &&
      historyAfter === historyInSettings + 4 &&
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
  // Focus leaves on a click on empty frame: on the panels, Appearance's
  // palette tiles lie under the pointer, and a click there changed the
  // palette of every shot after it (WP-05b, 5).
  const blur = await clickEmptyFrame(page);
  checks.blur_click = {
    ...blur,
    palette_after: await paletteOf(page),
    ok:
      !blur.interactive &&
      !blur.inCard &&
      (await paletteOf(page)) === "vitesse-black",
  };

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
      inCardPlace(panelsOpened, W, H, 264) &&
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
      inCardPlace(skeletonPanels, W, H, 264) &&
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
    const element = document.querySelector(".luca-settings-scroll");
    return element ? element.scrollHeight > element.clientHeight : null;
  });
  checks.min_window = {
    list: smallList,
    panels: smallPanels,
    list_scrolls: listScrolls,
    ok:
      inRailPlace(smallList, 500) &&
      inCardPlace(smallPanels, 800, 500, 264) &&
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

  const shotPalettes = Object.fromEntries(
    files.map((file) => [path.basename(file), palettes.get(file) ?? null]),
  );
  checks.spec_palette = {
    shots: shotPalettes,
    ok: Object.values(shotPalettes).every((name) => name === "vitesse-black"),
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

/** Answers the app's version as the real app does (the mock has none), so
 *  the section list's foot is drawn. */
async function answerVersion(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, ...rest: unknown[]) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    internals.invoke = (cmd, ...rest) =>
      cmd === "plugin:app|version"
        ? Promise.resolve("0.5.0-beta.14")
        : invoke(cmd, ...rest);
  });
}

/** Presses Escape until the search dialog is gone (at most three times)
 *  and says how many it took. */
async function escapesToCloseSearch(page: Page) {
  for (let press = 1; press <= 3; press += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    if ((await page.getByTestId("search-dialog-input").count()) === 0) {
      return press;
    }
  }
  return -1;
}

/** The version line against the rows and the card, at the list's top and
 *  at its end. */
async function measureFoot(page: Page) {
  return page.evaluate(() => {
    const rect = (s: string) =>
      document.querySelector(s)?.getBoundingClientRect() ?? null;
    const scroller = document.querySelector(
      ".luca-settings-scroll",
    ) as HTMLElement;
    const read = () => {
      const card = rect('[data-luca-settings-list] [data-sidebar="sidebar"]');
      const view = scroller.getBoundingClientRect();
      const version = rect('[data-testid="settings-version"]');
      const about = rect('[data-testid="settings-nav-about"]');
      const head = [...document.querySelectorAll(".luca-settings-group-head")]
        .at(-1)
        ?.getBoundingClientRect();
      return {
        card_bottom: card ? card.y + card.height : null,
        scroll_bottom: view.y + view.height,
        version_top: version?.y ?? null,
        version_bottom: version ? version.y + version.height : null,
        about_bottom: about ? about.y + about.height : null,
        application_head_top: head?.y ?? null,
        version_after_about:
          !!version && !!about && version.y >= about.y + about.height,
      };
    };
    scroller.scrollTop = 0;
    const top = read();
    scroller.scrollTop = scroller.scrollHeight;
    const end = read();
    const scrolls = scroller.scrollHeight > scroller.clientHeight;
    return { scrolls, top, end };
  });
}

test("the review's fixes", async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];
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
  await answerVersion(page);
  await openGeneral(page);

  // ── ⌘K and ⌘N work in Settings, where their places are ────────────
  await openSettingsFromPlaces(page);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Meta+k");
  const searchOpened = await page
    .getByTestId("search-dialog-input")
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(300);
  files.push(await shot(page, dir, "fix-cmd-k-in-settings"));
  const escapesInSettings = await escapesToCloseSearch(page);
  const afterEscape = page.url();
  const stillInSettings = await page.getByTestId("settings-view").count();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Meta+n");
  const newConversation = await page
    .waitForURL(/#\/messages\/new/, { timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  const leftSettings = (await page.getByTestId("settings-view").count()) === 0;
  // ⌘⇧N (a new channel) and ⌘⇧A stay as they were in Settings: off.
  await openSettingsFromPlaces(page);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Meta+Shift+a");
  await page.waitForTimeout(300);
  const shiftAStays = /#\/settings/.test(page.url());
  // The same, in a conversation, for comparison.
  await openGeneral(page);
  await page.mouse.move(900, 600);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Meta+k");
  await expect(page.getByTestId("search-dialog-input")).toBeVisible();
  await page.waitForTimeout(300);
  const escapesInConversation = await escapesToCloseSearch(page);
  checks.cmd_k_cmd_n_in_settings = {
    cmd_k_opens_search: searchOpened,
    escapes_to_close_search_in_settings: escapesInSettings,
    escapes_to_close_search_in_conversation: escapesInConversation,
    escape_closes_search_only: /#\/settings/.test(afterEscape),
    settings_after_escape: stillInSettings,
    cmd_n_url: page.url(),
    cmd_n_opens_new_conversation: newConversation,
    cmd_n_leaves_settings: leftSettings,
    cmd_shift_a_unchanged_in_settings: shiftAStays,
    ok:
      searchOpened &&
      escapesInSettings > 0 &&
      escapesInSettings === escapesInConversation &&
      /#\/settings/.test(afterEscape) &&
      stillInSettings === 1 &&
      newConversation &&
      leftSettings &&
      shiftAStays,
  };

  // ── the panels' card holds still as Settings opens ────────────────
  // The settings chunk is cached by now (opened above).
  await openGeneral(page);
  await page.waitForTimeout(400);
  const arrival = await page.evaluate(
    () =>
      new Promise<{
        frames: Array<{ t: number; host: string; surface: string }>;
        transitions: string[];
      }>((resolve) => {
        const frames: Array<{ t: number; host: string; surface: string }> = [];
        const transitions = new Set<string>();
        const start = performance.now();
        (
          document.querySelector(
            '[data-testid="open-settings-view"]',
          ) as HTMLElement
        ).click();
        const step = () => {
          const t = performance.now() - start;
          const host = document.querySelector(
            '[data-testid="settings-view"]',
          ) as HTMLElement | null;
          const surface = document.querySelector(
            '[data-testid="settings-content-surface"]',
          ) as HTMLElement | null;
          if (host) {
            frames.push({
              t: Math.round(t),
              host: getComputedStyle(host).opacity,
              surface: surface ? getComputedStyle(surface).opacity : "none",
            });
            for (const animation of host.getAnimations()) {
              const name =
                animation instanceof CSSTransition
                  ? `transition:${animation.transitionProperty}`
                  : animation.constructor.name;
              transitions.add(name);
            }
          }
          if (t < 320) requestAnimationFrame(step);
          else resolve({ frames, transitions: [...transitions] });
        };
        requestAnimationFrame(step);
      }),
  );
  checks.panels_card_still_on_open = {
    frames_sampled: arrival.frames.length,
    first_frames: arrival.frames.slice(0, 4),
    min_host_opacity: Math.min(
      ...arrival.frames.map((frame) => Number(frame.host)),
    ),
    host_animations: arrival.transitions,
    ok:
      arrival.frames.length >= 5 &&
      arrival.frames.every((frame) => frame.host === "1") &&
      arrival.transitions.length === 0,
  };
  // A frame caught right after the click: the card is already drawn.
  await openGeneral(page);
  await page.waitForTimeout(400);
  await page.getByTestId("open-settings-view").click();
  const early = path.join(dir, "fix-settings-arriving-early-1440x900.png");
  await page.screenshot({ path: early });
  palettes.set(early, await paletteOf(page));
  files.push(early);

  // ── the unread dot on Conversations, in Settings ──────────────────
  await openGeneral(page);
  await page.waitForTimeout(300);
  const dotInConversation = await page
    .getByTestId("shell-place-conversations-unread")
    .count();
  const unreadRows = await page.getByTestId(/^channel-unread/).count();
  await openSettingsFromPlaces(page);
  await page.mouse.move(700, 500);
  await page.waitForTimeout(300);
  const dotSettingsOpen = await page
    .getByTestId("shell-place-conversations-unread")
    .count();
  const dotBox = await box(
    page,
    '[data-testid="shell-place-conversations-unread"]',
  );
  const placesShot = path.join(dir, "fix-unread-dot-settings-list-open.png");
  await settle(page);
  await page.screenshot({
    path: placesShot,
    clip: { x: 0, y: 0, width: 300, height: 260 },
  });
  palettes.set(placesShot, await paletteOf(page));
  files.push(placesShot);
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(700);
  const dotSettingsClosed = await page
    .getByTestId("shell-place-conversations-unread")
    .count();
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(700);
  checks.unread_dot_in_settings = {
    unread_rows_on_rail: unreadRows,
    dot_in_conversation_rail_open: dotInConversation,
    dot_in_settings_list_open: dotSettingsOpen,
    dot_in_settings_list_closed: dotSettingsClosed,
    dot_box: dotBox,
    conversations_label: await page
      .getByTestId("shell-place-conversations")
      .getAttribute("aria-label"),
    ok:
      dotInConversation === 0 &&
      dotSettingsOpen === 1 &&
      dotSettingsClosed === 1,
  };

  // ── the version line at the list's foot ───────────────────────────
  const foot: Record<string, unknown> = {};
  for (const [name, size] of [
    ["1440x900", { width: 1440, height: 900 }],
    ["800x500", { width: 800, height: 500 }],
    ["800x510", { width: 800, height: 510 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.mouse.move(size.width - 1, size.height - 1);
    await page.waitForTimeout(500);
    const measured = await measureFoot(page);
    const scroller = page.locator(".luca-settings-scroll");
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    const clip = {
      x: 40,
      y: size.height - 120,
      width: 232,
      height: 120,
    };
    const topShot = path.join(dir, `fix-foot-${name}-top.png`);
    await settle(page);
    await page.screenshot({ path: topShot, clip });
    palettes.set(topShot, await paletteOf(page));
    files.push(topShot);
    if (measured.scrolls) {
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const endShot = path.join(dir, `fix-foot-${name}-end.png`);
      await settle(page);
      await page.screenshot({ path: endShot, clip });
      palettes.set(endShot, await paletteOf(page));
      files.push(endShot);
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
    }
    foot[name] = measured;
  }
  const big = foot["1440x900"] as Awaited<ReturnType<typeof measureFoot>>;
  const small = [foot["800x500"], foot["800x510"]] as Array<
    Awaited<ReturnType<typeof measureFoot>>
  >;
  checks.version_in_list_scroll = {
    ...foot,
    ok:
      // With room: no scroll, the version (its 12 of padding below the
      // words) rests on the card's foot.
      !big.scrolls &&
      big.top.version_bottom !== null &&
      big.top.card_bottom !== null &&
      Math.abs(big.top.card_bottom - big.top.version_bottom) <= 1 &&
      big.top.version_after_about &&
      // Without: one scroll to the card's own edge; at its end every row of
      // Application shows and the version follows About.
      small.every(
        (m) =>
          m.scrolls &&
          m.top.card_bottom !== null &&
          Math.abs(m.top.scroll_bottom - m.top.card_bottom) <= 1 &&
          m.end.version_after_about &&
          m.end.about_bottom !== null &&
          m.end.version_bottom !== null &&
          m.end.version_bottom <= m.end.scroll_bottom + 0.5,
      ),
  };

  // ── flag off: ⌘K in Settings is as the base (no dialog) ───────────
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const off = await context.newPage();
  await openApp(off, { frame: false, origin: new URL(page.url()).origin });
  await expect(
    off.locator("[data-luca-conversation-surface]").first(),
  ).toBeAttached({ timeout: 60_000 });
  await off.keyboard.press("ControlOrMeta+,");
  await expect(off.getByTestId("settings-view")).toBeVisible();
  await off.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await off.keyboard.press("Meta+k");
  await off.waitForTimeout(600);
  checks.flag_off_cmd_k_unchanged = {
    search_dialog: await off.getByTestId("search-dialog-input").count(),
    ok: (await off.getByTestId("search-dialog-input").count()) === 0,
  };
  await context.close();

  const fixPalettes = Object.fromEntries(
    files.map((file) => [path.basename(file), palettes.get(file) ?? null]),
  );
  checks.spec_palette = {
    shots: fixPalettes,
    ok: Object.values(fixPalettes).every((name) => name === "vitesse-black"),
  };

  checks.console = { errors: consoleErrors, ok: consoleErrors.length === 0 };
  const failing = Object.entries(checks)
    .filter(([, value]) => !(value as { ok?: boolean }).ok)
    .map(([key]) => key);
  checks.failing = failing;
  writeFileSync(
    path.join(dir, "checks-fixes.json"),
    `${JSON.stringify({ checks, files }, null, 2)}\n`,
  );
  expect(failing).toEqual([]);
});

/** Which place has focus, if focus is on a place. */
const focusedPlace = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return {
      testid: active?.getAttribute("data-testid") ?? null,
      in_places: !!active?.closest('[data-testid="shell-places"]'),
      focus_visible: !!active?.matches(":focus-visible"),
    };
  });

/** Presses a place from the keyboard: focus it, then Enter. */
async function pressPlace(page: Page, testId: string) {
  await page.getByTestId(testId).focus();
  await page.keyboard.press("Enter");
}

test("Settings and the Frame row, finished (WP-05b)", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];
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
  await answerVersion(page);
  await openGeneral(page);

  // ── 1. focus stays on the place you pressed ───────────────────────
  // Opening: Settings, from the app's column into Settings' own.
  await pressPlace(page, "open-settings-view");
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.locator('[data-testid^="settings-panel-"]')).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(600);
  const opened = await focusedPlace(page);
  const openShot = path.join(dir, "wp05b-focus-settings-opened.png");
  await settle(page);
  await page.screenshot({
    path: openShot,
    clip: { x: 0, y: 0, width: 320, height: 900 },
  });
  palettes.set(openShot, await paletteOf(page));
  files.push(openShot);
  // Closing: Conversations, from Settings' column back into the app's.
  await pressPlace(page, "shell-place-conversations");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await page.waitForTimeout(600);
  const closed = await focusedPlace(page);
  const closeShot = path.join(dir, "wp05b-focus-settings-closed.png");
  await settle(page);
  await page.screenshot({
    path: closeShot,
    clip: { x: 0, y: 0, width: 320, height: 900 },
  });
  palettes.set(closeShot, await paletteOf(page));
  files.push(closeShot);
  // Another place out of Settings: Library.
  await openGeneral(page);
  await pressPlace(page, "open-settings-view");
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.waitForTimeout(400);
  await pressPlace(page, "open-artifacts-view");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await page.waitForTimeout(600);
  const library = await focusedPlace(page);
  // A pointer press hands nothing over (as on macOS, where a press doesn't
  // focus the button), so no tooltip is left standing in the new column.
  await openGeneral(page);
  await page.getByTestId("open-settings-view").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.mouse.move(1439, 899);
  await page.waitForTimeout(600);
  const clicked = {
    ...(await focusedPlace(page)),
    tooltips: await page.getByRole("tooltip").count(),
  };
  checks.focus_kept = {
    opened_settings: opened,
    closed_by_conversations: closed,
    closed_by_library: library,
    opened_by_pointer: clicked,
    // One column for every route now (WP-17, 4): focus simply stays on the
    // place pressed. Conversations returns to the conversation you were
    // in, whose composer takes the keys, as it does from every place. A
    // pointer press leaves no ring and no tooltip.
    ok:
      opened.testid === "open-settings-view" &&
      opened.in_places &&
      (closed.testid === "shell-place-conversations" ||
        closed.testid === "message-input") &&
      library.testid === "open-artifacts-view" &&
      library.in_places &&
      !clicked.focus_visible &&
      clicked.tooltips === 0,
  };

  // ── 2. the version line: text-2xs, the faint tone ─────────────────
  const version = await page.evaluate(() => {
    const line = document.querySelector('[data-testid="settings-version"]');
    const head = document.querySelector(".luca-settings-group-head");
    const probe = document.createElement("span");
    probe.className = "text-2xs";
    document.body.append(probe);
    const twoXs = getComputedStyle(probe).fontSize;
    probe.remove();
    return line
      ? {
          text: line.textContent,
          size: getComputedStyle(line).fontSize,
          text_2xs: twoXs,
          colour: getComputedStyle(line).color,
          faint: head ? getComputedStyle(head).color : null,
          classes: line.className,
        }
      : null;
  });
  await page.mouse.move(1439, 899);
  // The line itself, close: About above it, the card's foot below.
  const footShot = path.join(dir, "wp05b-version-line.png");
  await settle(page);
  const line = await box(page, '[data-testid="settings-version"]');
  await page.screenshot({
    path: footShot,
    clip: line
      ? { x: 44, y: line.y - 24, width: 160, height: line.h + 30 }
      : { x: 40, y: 780, width: 232, height: 120 },
  });
  palettes.set(footShot, await paletteOf(page));
  files.push(footShot);
  checks.version_size = {
    ...version,
    ok:
      !!version &&
      version.size === "11px" &&
      version.size === version.text_2xs &&
      version.colour === version.faint,
  };

  // ── 4. the current row keeps its lit top under keyboard focus ─────
  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByTestId("settings-panel-appearance")).toBeVisible();
  await clickEmptyFrame(page);
  // The lit top is the sliding mark's now (WP-09a: Settings' list wears the
  // rail's mark), not the row's: read the mark once it has come to rest and
  // dried (marks.ts), at rest and with its row focused.
  const MARK = '[data-testid="shell-settings-marks"] > .luca-mark:last-child';
  const markShadow = async () => {
    await expect
      .poll(
        () =>
          page.evaluate(
            (selector) =>
              document
                .querySelector<HTMLElement>(selector)
                ?.style.getPropertyValue("--wet") ?? null,
            MARK,
          ),
        { timeout: 10_000 },
      )
      .toBe("0.000");
    return page.evaluate(
      (selector) =>
        getComputedStyle(document.querySelector(selector) as Element).boxShadow,
      MARK,
    );
  };
  const restingShadow = await markShadow();
  const restingRowShadow = await page
    .getByTestId("settings-nav-appearance")
    .evaluate((element) => getComputedStyle(element).boxShadow);
  // From the keyboard: down to Notifications, up to Appearance.
  await page.getByTestId("settings-nav-security").focus();
  await page.keyboard.press("ArrowDown");
  const focusedRow = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      testid: active?.getAttribute("data-testid") ?? null,
      current: active?.getAttribute("aria-current") ?? null,
      focus_visible: !!active?.matches(":focus-visible"),
      shadow: active ? getComputedStyle(active).boxShadow : null,
      outline: active
        ? `${getComputedStyle(active).outlineStyle} ${getComputedStyle(active).outlineWidth}`
        : null,
    };
  });
  const focusedMarkShadow = await markShadow();
  await page.mouse.move(1439, 899);
  const rowShot = path.join(dir, "wp05b-current-row-focused.png");
  await settle(page);
  const rowBox = await box(page, '[data-testid="settings-nav-appearance"]');
  await page.screenshot({
    path: rowShot,
    clip: rowBox
      ? { x: rowBox.x - 6, y: rowBox.y - 6, width: rowBox.w + 12, height: 42 }
      : { x: 44, y: 36, width: 220, height: 200 },
  });
  palettes.set(rowShot, await paletteOf(page));
  files.push(rowShot);
  checks.focus_lit_top = {
    resting_shadow: restingShadow,
    resting_row_shadow: restingRowShadow,
    focused_mark_shadow: focusedMarkShadow,
    focused: focusedRow,
    ok:
      focusedRow.testid === "settings-nav-appearance" &&
      focusedRow.current === "page" &&
      focusedRow.focus_visible &&
      /inset/.test(restingShadow) &&
      focusedMarkShadow === restingShadow &&
      // The row draws no plate or edge of its own beneath the mark.
      restingRowShadow === "none" &&
      focusedRow.shadow === "none" &&
      focusedRow.outline === "solid 1px",
  };
  await clickEmptyFrame(page);

  // ── 3. the skeleton's panel sits in the loaded panel's column ─────
  const release: Array<() => void> = [];
  await page.route(/SettingsScreen-[^/]*\.js$/, async (route) => {
    await new Promise<void>((resolve) => release.push(resolve));
    await route.continue().catch(() => undefined);
  });
  await boot(page, new URL(page.url()).origin);
  await openGeneral(page);
  await page.getByTestId("open-settings-view").click();
  await expect(page.getByTestId("settings-loading-fallback")).toBeVisible();
  await page.mouse.move(1439, 899);
  await page.waitForTimeout(500);
  files.push(await shot(page, dir, "wp05b-skeleton"));
  const skeleton = await page.evaluate(() => {
    const column = document
      .querySelector('[data-testid="settings-loading-panel"]')
      ?.getBoundingClientRect();
    const title = document
      .querySelector('[data-testid="settings-loading-panel"] > div')
      ?.getBoundingClientRect();
    return column && title
      ? { x: column.x, y: column.y, w: column.width, title_h: title.height }
      : null;
  });
  for (const go of release) go();
  await expect(page.locator('[data-testid^="settings-panel-"]')).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  files.push(await shot(page, dir, "wp05b-skeleton-loaded"));
  const loaded = await page.evaluate(() => {
    const column = document
      .querySelector('[data-testid="settings-content-scroll"] > div')
      ?.getBoundingClientRect();
    // The section's head is the shared page's (WP-17, 1).
    const title = document
      .querySelector(
        '[data-testid="settings-content-scroll"] [data-testid="place-page-head"]',
      )
      ?.getBoundingClientRect();
    return column && title
      ? {
          x: column.x,
          y: column.y,
          w: column.width,
          title_h: title.height,
          title_y: title.y,
          section: document
            .querySelector('[data-testid^="settings-panel-"]')
            ?.getAttribute("data-testid"),
        }
      : null;
  });
  checks.skeleton_column = {
    skeleton,
    loaded,
    ok:
      !!skeleton &&
      !!loaded &&
      Math.abs(skeleton.x - loaded.x) <= 0.5 &&
      Math.abs(skeleton.y - loaded.y) <= 0.5 &&
      Math.abs(skeleton.w - loaded.w) <= 0.5 &&
      Math.abs(skeleton.title_h - loaded.title_h) <= 1,
  };

  // ── 5. every shot here in Vitesse Black ───────────────────────────
  const shotPalettes = Object.fromEntries(
    files.map((file) => [path.basename(file), palettes.get(file) ?? null]),
  );
  checks.spec_palette = {
    shots: shotPalettes,
    ok: Object.values(shotPalettes).every((name) => name === "vitesse-black"),
  };

  checks.console = { errors: consoleErrors, ok: consoleErrors.length === 0 };
  const failing = Object.entries(checks)
    .filter(([, value]) => !(value as { ok?: boolean }).ok)
    .map(([key]) => key);
  checks.failing = failing;
  writeFileSync(
    path.join(dir, "checks-wp05b.json"),
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
