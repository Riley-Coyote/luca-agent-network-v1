import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-07a, the frame's glass plumbing (docs/luca/rail-system/SHELL_BUILD.md):
 * the Frame row in Settings → Appearance, what Glass draws with and without
 * Tauri and the native glass, the frosted fallback's arguments, the reporter's
 * messages, Reduce Transparency, the window's appearance, the traffic lights,
 * and the flag off. Nothing native is drawn here: the glass's look is judged
 * in the test app (WP-07b). Where a picture of the page under glass helps, a
 * stand-in desktop (the study's dusk and daylight skies, shellStudy.css) is
 * painted on the root, behind the veil.
 */

const SHOTS = process.env.WP07A_SHOTS ?? "test-results/shell-glass";
const BASE_URL = process.env.WP07A_BASE_URL ?? "http://127.0.0.1:4300";
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

type Logged = { command: string; payload: Record<string, unknown> | null };
type GlassMessage = Record<string, unknown> & { type: string };

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[console] ${message.text()}`);
  });
});

async function seedTheme(page: Page, theme: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("buzz-theme", value);
  }, theme);
}

/** The mock bridge seeds every preview feature on; this decides the frame's. */
async function setShellFrame(page: Page, enabled: boolean) {
  await page.addInitScript(
    ({ key, on }) => {
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? JSON.parse(raw) : {};
      overrides["shell-frame"] = on;
      window.localStorage.setItem(key, JSON.stringify(overrides));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: enabled },
  );
}

async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
  });
}

/** Stands in for PolyphonicGlass.swift: announces itself and keeps every
 *  message the page sends it. */
async function fakeNativeGlass(page: Page) {
  await page.addInitScript(() => {
    const glass = window as typeof window & {
      __GLASS_MESSAGES__?: unknown[];
      __POLYPHONIC_NATIVE_GLASS__?: number;
      webkit?: unknown;
    };
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
  });
}

/** Reduce Transparency, switchable while the page runs. */
async function fakeReducedTransparency(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let reduced = false;
    const query = "(prefers-reduced-transparency: reduce)";
    const original = window.matchMedia.bind(window);
    const list = {
      get matches() {
        return reduced;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: never) => listeners.add(listener),
      removeEventListener: (_: string, listener: never) =>
        listeners.delete(listener),
      addListener: (listener: never) => listeners.add(listener),
      removeListener: (listener: never) => listeners.delete(listener),
      dispatchEvent: () => true,
    };
    window.matchMedia = (media: string) =>
      media.includes("prefers-reduced-transparency")
        ? (list as unknown as MediaQueryList)
        : original(media);
    (
      window as typeof window & {
        __setReducedTransparency__?: (on: boolean) => void;
      }
    ).__setReducedTransparency__ = (on: boolean) => {
      reduced = on;
      for (const listener of listeners) {
        listener({ matches: on, media: query } as MediaQueryListEvent);
      }
    };
  });
}

async function openAppearance(page: Page, origin = "") {
  await page.goto(`${origin}/#/settings?section=appearance`, {
    waitUntil: "domcontentloaded",
  });
  const panel = page.getByTestId("settings-theme");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await waitForAnimations(page);
  return panel;
}

const commandLog = (page: Page) =>
  page.evaluate(
    () =>
      (
        (window as typeof window & { __BUZZ_E2E_COMMAND_LOG__?: Logged[] })
          .__BUZZ_E2E_COMMAND_LOG__ ?? []
      ).map(({ command, payload }) => ({
        command,
        payload: JSON.parse(JSON.stringify(payload ?? null)),
      })) as Logged[],
  );

const glassMessages = (page: Page) =>
  page.evaluate(
    () =>
      ((window as typeof window & { __GLASS_MESSAGES__?: GlassMessage[] })
        .__GLASS_MESSAGES__ ?? []) as GlassMessage[],
  );

const rootAttribute = (page: Page, name: string) =>
  page.evaluate(
    (attribute) => document.documentElement.getAttribute(attribute),
    name,
  );

/** A desktop behind the clear page: the study's skies (shellStudy.css:80-89
 *  at night, 1282-1287 by day), on the root, beneath the veil. */
async function paintDesktop(page: Page) {
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

const frameRow = (page: Page) => page.getByTestId("appearance-frame");

/** The Appearance header, System / Light / Dark and the Frame row, clipped
 *  from the page (the panel scrolls, so a shot of it alone runs blank). */
async function shootRow(page: Page, path: string) {
  await waitForAnimations(page);
  const top = await page.getByTestId("appearance-mode-system").boundingBox();
  const row = await frameRow(page).boundingBox();
  if (!top || !row) throw new Error("Appearance row is not on screen");
  const x = Math.max(0, row.x - 24);
  const y = Math.max(0, top.y - 24);
  await page.screenshot({
    path,
    clip: {
      x,
      y,
      width: row.width + 48,
      height: row.y + row.height + 24 - y,
    },
  });
}

// ── the Appearance row ─────────────────────────────────────────────────

test("browser, dark: a statement, its sentence, no glass", async ({ page }) => {
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  const row = frameRow(page);
  await expect(row).toBeVisible();
  // Nothing to choose in a browser: the label and its sentence (WP-05b, 6).
  await expect(row.locator("fieldset, button")).toHaveCount(0);
  await expect(page.getByTestId("appearance-frame-sentence")).toHaveText(
    "Solid black, nothing showing through it.",
  );
  await expect(page.getByTestId("settings-native-glass")).toHaveCount(0);
  expect(await rootAttribute(page, "data-luca-frame-glass")).toBeNull();
  // Directly under System / Light / Dark.
  const modes = await page.getByTestId("appearance-mode-dark").boundingBox();
  const box = await row.boundingBox();
  expect(box && modes && box.y > modes.y + modes.height - 1).toBe(true);
  await shootRow(page, `${SHOTS}/row-browser-dark.png`);
});

test("browser, light: a statement, its sentence", async ({ page }) => {
  await seedTheme(page, "paper");
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  await expect(frameRow(page).locator("fieldset, button")).toHaveCount(0);
  await expect(page.getByTestId("appearance-frame-sentence")).toHaveText(
    "Solid paper, nothing showing through it.",
  );
  await shootRow(page, `${SHOTS}/row-browser-light.png`);
});

test("browser: a stored glass choice still draws solid", async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("polyphonic-frame", "glass"),
  );
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  await expect(page.getByTestId("appearance-frame-sentence")).toHaveText(
    "Solid black, nothing showing through it.",
  );
  expect(await rootAttribute(page, "data-luca-frame-glass")).toBeNull();
});

// ── Tauri on a Mac without the native glass: the frosted fallback ────────

test("Tauri, dark, no native glass: Glass draws the heads-up display", async ({
  page,
}) => {
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  await expect(page.getByTestId("appearance-frame-solid")).toHaveText("Black");
  await expect(page.getByTestId("appearance-frame-glass")).toHaveText("Glass");
  await shootRow(page, `${SHOTS}/row-tauri-dark-solid.png`);

  await page.getByTestId("appearance-frame-glass").click();
  await expect(page.getByTestId("appearance-frame-sentence")).toHaveText(
    "Glass, your desktop softly blurred behind it.",
  );
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .not.toBeNull();
  expect(await rootAttribute(page, "data-luca-frame-glass")).toBe("frosted");
  expect(
    await page.evaluate(() => window.localStorage.getItem("polyphonic-frame")),
  ).toBe("glass");

  const log = await commandLog(page);
  const vibrancy = log.filter(
    (entry) => entry.command === "set_window_vibrancy",
  );
  expect(vibrancy.at(-1)?.payload).toEqual({
    enabled: true,
    material: "hud-window",
    state: "active",
    cornerRadius: 16,
  });
  const lights = log.filter(
    (entry) => entry.command === "set_traffic_lights_inset",
  );
  expect(lights.at(0)?.payload).toEqual({ x: 16, centre: 22 });
  const themes = log.filter(
    (entry) => entry.command === "plugin:window|set_theme",
  );
  expect(themes.at(-1)?.payload?.value).toBe("dark");

  await paintDesktop(page);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/frosted-dark-settings.png` });

  // Back to Black: the theme's chain clears the layer, and the page is solid.
  const before = (await commandLog(page)).length;
  await page.getByTestId("appearance-frame-solid").click();
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .toBeNull();
  const after = (await commandLog(page)).slice(before);
  expect(
    after.some(
      (entry) =>
        entry.command === "set_window_vibrancy" &&
        entry.payload?.enabled === false,
    ),
  ).toBe(true);
});

test("Tauri, light, no native glass: the under-window background, provisional", async ({
  page,
}) => {
  await seedTheme(page, "paper");
  await page.addInitScript(() =>
    window.localStorage.setItem("polyphonic-frame", "glass"),
  );
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  await expect(page.getByTestId("appearance-frame-solid")).toHaveText("Paper");
  await expect(page.getByTestId("appearance-frame-glass")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .not.toBeNull();
  const vibrancy = (await commandLog(page)).filter(
    (entry) => entry.command === "set_window_vibrancy",
  );
  expect(vibrancy.at(-1)?.payload).toEqual({
    enabled: true,
    material: "under-window-background",
    state: "active",
    cornerRadius: 16,
  });
  const themes = (await commandLog(page)).filter(
    (entry) => entry.command === "plugin:window|set_theme",
  );
  expect(themes.at(-1)?.payload?.value).toBe("light");
  await shootRow(page, `${SHOTS}/row-tauri-light-glass.png`);
  await paintDesktop(page);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/frosted-light-settings.png` });
});

test("Tauri, dark, frosted: a conversation under glass", async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("polyphonic-frame", "glass"),
  );
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`, {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"), {
      timeout: 15_000,
    })
    .not.toBeNull();
  await page.locator("[data-luca-card]").first().waitFor();
  await paintDesktop(page);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/frosted-dark-conversation.png` });
});

// ── the page under glass: every value, measured ───────────────────────

for (const mode of ["dark", "light"] as const) {
  test(`the page under glass, ${mode}: floor clear, veil, words, cards`, async ({
    page,
  }) => {
    if (mode === "light") await seedTheme(page, "paper");
    await page.addInitScript(() =>
      window.localStorage.setItem("polyphonic-frame", "glass"),
    );
    await fakeTauri(page);
    await installMockBridge(page);
    await setShellFrame(page, true);
    await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
    await page.getByText("Hey team — checking in.").waitFor();
    await expect
      .poll(() => rootAttribute(page, "data-luca-frame-glass"))
      .not.toBeNull();
    await waitForAnimations(page);
    const measured = await page.evaluate(() => {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      const veil = getComputedStyle(document.body, "::before");
      const card = [
        ...document.querySelectorAll<HTMLElement>("[data-luca-card]"),
      ]
        .filter((element) => !element.closest('[data-testid="app-sidebar"]'))
        .find((element) => element.getBoundingClientRect().width > 0);
      const floors = [
        ...document.querySelectorAll<HTMLElement>(
          ".luca-theme-shell-layer, .buzz-huddle-shell, .buzz-huddle-app-surface, [data-buzz-glass-inset], [data-luca-floor-host]",
        ),
      ].map((element) => getComputedStyle(element).backgroundColor);
      return {
        html: style.backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        floors,
        veil: {
          background: veil.backgroundColor,
          position: veil.position,
          zIndex: veil.zIndex,
          radius: veil.borderTopLeftRadius,
          inset: [veil.top, veil.right, veil.bottom, veil.left],
        },
        // Each tone, resolved the way the frame's words will wear it.
        words: ["ink", "muted", "faint", "plate", "thread"].map((name) => {
          const probe = document.createElement("span");
          probe.style.color = `var(--luca-frame-${name})`;
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        }),
        cardShadow: card ? getComputedStyle(card).boxShadow : null,
        floorToken: style.getPropertyValue("--mn-floor").trim(),
        inkToken: style.getPropertyValue("--mn-ink").trim(),
      };
    });
    test.info().annotations.push({
      type: "measured",
      description: JSON.stringify(measured),
    });
    expect(measured.html).toBe("rgba(0, 0, 0, 0)");
    expect(measured.body).toBe("rgba(0, 0, 0, 0)");
    for (const floor of measured.floors) expect(floor).toBe("rgba(0, 0, 0, 0)");
    expect(measured.veil.position).toBe("fixed");
    expect(measured.veil.zIndex).toBe("-1");
    expect(measured.veil.radius).toBe("16px");
    expect(measured.veil.inset).toEqual(["0px", "0px", "0px", "0px"]);
    if (mode === "dark") {
      expect(measured.veil.background).toBe("rgba(0, 0, 0, 0.22)");
      // The build writes the study's rgb(250 248 243 / 0.96) etc. as hex
      // (#faf8f3f5): 245/255 = 0.96, 194/255 = 0.76, 143/255 = 0.56.
      expect(measured.words).toEqual([
        "rgba(250, 248, 243, 0.96)",
        "rgba(250, 248, 243, 0.76)",
        "rgba(250, 248, 243, 0.56)",
        "rgba(255, 255, 255, 0.1)",
        "rgba(255, 255, 255, 0.22)",
      ]);
      expect(measured.cardShadow).toBe(
        "rgba(255, 255, 255, 0.12) 0px -0.5px 0px 0px, rgba(0, 0, 0, 0.25) 0px 1px 2px 0px, rgba(0, 0, 0, 0.32) 0px 18px 44px 0px",
      );
    } else {
      expect(measured.veil.background).toMatch(/, 0\.22\)$/);
      // The page's ink at 100 / 84 / 66%.
      const ink = measured.words[0]
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .join(", ");
      expect(measured.words[0]).toBe(`rgb(${ink})`);
      expect(measured.words[1]).toBe(`rgba(${ink}, 0.84)`);
      expect(measured.words[2]).toBe(`rgba(${ink}, 0.66)`);
      expect(measured.cardShadow).toBe("none");
    }
    await paintDesktop(page);
    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/glass-${mode}-veil.png` });
    // The same frame without the veil, to measure what it does.
    await page.addStyleTag({
      content: ":root body::before { display: none !important; }",
    });
    await page.screenshot({ path: `${SHOTS}/glass-${mode}-no-veil.png` });
  });
}

// ── Liquid Glass: the reporter ──────────────────────────────────────────

test("Tauri, dark, native glass: Liquid Glass and the reporter's messages", async ({
  page,
}) => {
  await fakeReducedTransparency(page);
  await fakeNativeGlass(page);
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  await expect(page.getByTestId("appearance-frame-glass")).toHaveText(
    "Liquid Glass",
  );
  await expect(page.getByTestId("settings-native-glass")).toHaveCount(0);
  expect(await glassMessages(page)).toEqual([]);

  await page.getByTestId("appearance-frame-glass").click();
  await expect(page.getByTestId("appearance-frame-sentence")).toHaveText(
    "Liquid Glass, your desktop showing through it.",
  );
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .not.toBeNull();
  expect(await rootAttribute(page, "data-luca-frame-glass")).toBe("liquid");
  await shootRow(page, `${SHOTS}/row-tauri-dark-liquid.png`);

  // Go to a conversation, so there is a card to report.
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.locator("[data-luca-card]").first().waitFor();
  await waitForAnimations(page);
  await expect
    .poll(
      async () =>
        (await glassMessages(page)).filter(
          (message) => message.type === "frame",
        ).length,
    )
    .toBeGreaterThan(0);
  const messages = await glassMessages(page);
  const settings = messages.find((message) => message.type === "settings");
  expect(settings).toEqual({
    type: "settings",
    material: "clear",
    motion: "pour",
    floor: "plain",
    cardGlass: false,
    slow: false,
  });
  const frames = messages.filter((message) => message.type === "frame");
  const last = frames.at(-1) as GlassMessage & {
    card: { x: number; y: number; w: number; h: number; r: number } | null;
    sheet: Record<string, unknown>;
  };
  expect(last.floor).toBe("none");
  expect(last.row).toBeNull();
  expect(last.clip).toBeNull();
  expect(last.sheet).toEqual({
    x: 0,
    y: 0,
    w: 1440,
    h: 900,
    r: 16,
    style: "regular",
    tint: "#00000080",
    appearance: "dark",
  });
  expect(typeof last.t).toBe("number");
  // The card reported is the conversation's card where it is now.
  const card = await page.evaluate(() => {
    const cards = [
      ...document.querySelectorAll<HTMLElement>("[data-luca-card]"),
    ]
      .filter((element) => !element.closest('[data-testid="app-sidebar"]'))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.x - b.x);
    const rect = cards[0];
    return rect
      ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
      : null;
  });
  expect(
    last.card && {
      x: last.card.x,
      y: last.card.y,
      w: last.card.w,
      h: last.card.h,
    },
  ).toEqual(card);
  // Deduped: consecutive frames are never the same.
  for (let index = 1; index < frames.length; index += 1) {
    const { t: _a, ...previous } = frames[index - 1];
    const { t: _b, ...current } = frames[index];
    expect(current).not.toEqual(previous);
  }

  // A resize is reported.
  const count = frames.length;
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(async () => {
      const latest = (await glassMessages(page))
        .filter((message) => message.type === "frame")
        .at(-1) as { sheet: { w: number; h: number } } | undefined;
      return latest ? [latest.sheet.w, latest.sheet.h] : null;
    })
    .toEqual([1280, 720]);
  expect(
    (await glassMessages(page)).filter((message) => message.type === "frame")
      .length,
  ).toBeGreaterThan(count);

  // The rail sliding is followed frame by frame.
  const beforeSlide = (await glassMessages(page)).length;
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(700);
  const slid = (await glassMessages(page)).slice(beforeSlide);
  test.info().annotations.push({
    type: "rail-slide-frames",
    description: String(
      slid.filter((message) => message.type === "frame").length,
    ),
  });
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(700);

  // Reduce Transparency: off, and the page draws the solid frame.
  await page.evaluate(() =>
    (
      window as typeof window & {
        __setReducedTransparency__?: (on: boolean) => void;
      }
    ).__setReducedTransparency__?.(true),
  );
  await expect
    .poll(async () => (await glassMessages(page)).at(-1)?.type)
    .toBe("off");
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .toBeNull();
  // And back.
  await page.evaluate(() =>
    (
      window as typeof window & {
        __setReducedTransparency__?: (on: boolean) => void;
      }
    ).__setReducedTransparency__?.(false),
  );
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .not.toBeNull();
  await expect
    .poll(async () => (await glassMessages(page)).at(-1)?.type)
    .toBe("frame");
  await page.setViewportSize({ width: 1440, height: 900 });
  await paintDesktop(page);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/liquid-dark-conversation.png` });
});

test("Tauri, light, native glass: no tint, light appearance", async ({
  page,
}) => {
  await seedTheme(page, "paper");
  await page.addInitScript(() =>
    window.localStorage.setItem("polyphonic-frame", "glass"),
  );
  await fakeNativeGlass(page);
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  await expect(page.getByTestId("appearance-frame-solid")).toHaveText("Paper");
  await expect(page.getByTestId("appearance-frame-glass")).toHaveText(
    "Liquid Glass",
  );
  await expect(page.getByTestId("appearance-frame-sentence")).toHaveText(
    "Liquid Glass, your desktop showing through it.",
  );
  await shootRow(page, `${SHOTS}/row-tauri-light-liquid.png`);
  await expect
    .poll(
      async () =>
        (await glassMessages(page)).filter(
          (message) => message.type === "frame",
        ).length,
    )
    .toBeGreaterThan(0);
  const last = (await glassMessages(page))
    .filter((message) => message.type === "frame")
    .at(-1) as { sheet: Record<string, unknown> };
  expect(last.sheet.tint).toBeNull();
  expect(last.sheet.appearance).toBe("light");
  // No vibrancy is installed for Liquid Glass.
  const vibrancy = (await commandLog(page)).filter(
    (entry) => entry.command === "set_window_vibrancy",
  );
  expect(vibrancy.every((entry) => entry.payload?.enabled === false)).toBe(
    true,
  );
  await paintDesktop(page);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/liquid-light-settings.png` });
});

test("native glass announced, flag on: the rail's reporter stands aside", async ({
  page,
}) => {
  await fakeNativeGlass(page);
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.locator("[data-luca-card]").first().waitFor();
  await waitForAnimations(page);
  expect(await rootAttribute(page, "data-luca-native-glass")).toBeNull();
  // The frame is solid: nothing at all is sent to the glass.
  expect(await glassMessages(page)).toEqual([]);
});

// ── the flag off ────────────────────────────────────────────────────────

test("flag off: no Frame row, the rail glass settings and reporter as before", async ({
  page,
}) => {
  await fakeNativeGlass(page);
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, false);
  await openAppearance(page);
  await expect(frameRow(page)).toHaveCount(0);
  await expect(page.getByTestId("settings-native-glass")).toBeVisible();
  expect(await rootAttribute(page, "data-luca-frame")).toBeNull();
  const log = await commandLog(page);
  expect(
    log.some((entry) => entry.command === "set_traffic_lights_inset"),
  ).toBe(false);
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.locator("[data-luca-card]").first().waitFor();
  await expect
    .poll(() => rootAttribute(page, "data-luca-native-glass"))
    .toBe("surface");
  const messages = await glassMessages(page);
  expect(
    messages.some((message) => message.type === "frame" && "sheet" in message),
  ).toBe(false);
});

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

for (const view of [
  {
    name: "conversation",
    route: `/#/channels/${GENERAL_CHANNEL_ID}`,
    ready: (page: Page) => page.getByText("Hey team — checking in."),
  },
  {
    name: "library",
    route: "/#/artifacts",
    ready: (page: Page) => page.getByText("threshold-study.html"),
  },
  {
    name: "settings",
    route: "/#/settings?section=appearance",
    ready: (page: Page) => page.getByTestId("settings-theme"),
  },
]) {
  test(`flag off is identical to the base: ${view.name}`, async ({
    browser,
    baseURL,
  }) => {
    const shots: string[] = [];
    for (const [label, origin] of [
      ["ours", baseURL ?? ""],
      ["base", BASE_URL],
    ] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await installMockBridge(page);
      await setShellFrame(page, false);
      await page.goto(`${origin}${view.route}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(view.ready(page).first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      await waitForAnimations(page);
      const path = `${SHOTS}/flag-off-${view.name}-${label}.png`;
      // The agents' live marks are WebGL and move every frame: masked.
      await page.screenshot({
        path,
        animations: "disabled",
        caret: "hide",
        mask: [
          page.locator(
            ".composer-agent-ledge, .luca-chat-agent-mark__mote, mote-3d",
          ),
        ],
      });
      shots.push(path);
      await context.close();
    }
    const [ours, base] = shots.map(hash);
    test.info().annotations.push({
      type: "hashes",
      description: `${view.name}: ours ${ours} base ${base}`,
    });
    expect(ours).toBe(base);
  });
}

// ── the review's findings, proved fixed ───────────────────────────────

/** The routes a place's or a conversation's card is drawn on. */
const CARD_VIEWS = [
  ["conversation", `/#/channels/${GENERAL_CHANNEL_ID}`],
  ["library", "/#/artifacts"],
  ["agents", "/#/agents"],
  ["activity", "/#/pulse"],
  ["brain", "/#/brain"],
  ["new-conversation", "/#/messages/new"],
  ["settings", "/#/settings?section=appearance"],
] as const;

const NIGHT_CARD_LIGHT =
  "rgba(255, 255, 255, 0.12) 0px -0.5px 0px 0px, rgba(0, 0, 0, 0.25) 0px 1px 2px 0px, rgba(0, 0, 0, 0.32) 0px 18px 44px 0px";

/** The cards on the frame, as shellGlass.ts finds them, with their light. */
const measureCards = (page: Page) =>
  page.evaluate(() => {
    const selector = [
      "[data-luca-card]",
      "[data-luca-conversation-surface]:not(:has([data-luca-workspace-floor]))",
      '[data-frame] [data-sidebar="sidebar"]',
    ].join(", ");
    const all = [...document.querySelectorAll<HTMLElement>(selector)];
    return all
      .filter(
        (card) =>
          !all.some((other) => other !== card && other.contains(card)) &&
          card.getBoundingClientRect().width >= 1 &&
          getComputedStyle(card).visibility === "visible",
      )
      .map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          kind: card.hasAttribute("data-luca-card") ? "card" : "surface",
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          radius: getComputedStyle(card).borderTopLeftRadius,
          boxShadow: getComputedStyle(card).boxShadow,
        };
      });
  });

/** Reads pixels (in CSS points) out of a 2x screenshot, on a blank page. */
async function pixels(
  page: Page,
  png: Buffer,
  points: readonly { x: number; y: number }[],
) {
  const decoder = await page.context().newPage();
  try {
    return await decoder.evaluate(
      async ({ data, at }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no canvas");
        context.drawImage(image, 0, 0);
        return at.map(({ x, y }) =>
          Array.from(
            context.getImageData(Math.round(x * 2), Math.round(y * 2), 1, 1)
              .data,
          ).slice(0, 3),
        );
      },
      { data: png.toString("base64"), at: points },
    );
  } finally {
    await decoder.close();
  }
}

const luminance = ([r, g, b]: number[]) => {
  const [lr, lg, lb] = [r, g, b].map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

async function openGlass(
  page: Page,
  route: string,
  { light, liquid }: { light: boolean; liquid: boolean },
) {
  if (light) await seedTheme(page, "paper");
  await page.addInitScript(() =>
    window.localStorage.setItem("polyphonic-frame", "glass"),
  );
  if (liquid) await fakeNativeGlass(page);
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"), {
      timeout: 15_000,
    })
    .toBe(liquid ? "liquid" : "frosted");
}

test("one owner: the glass marks only data-luca-frame-glass", async ({
  page,
}) => {
  await fakeReducedTransparency(page);
  await openGlass(page, `/#/channels/${GENERAL_CHANNEL_ID}`, {
    light: false,
    liquid: true,
  });
  // The frame's own attribute is WP-01's ("solid" while the frame is drawn):
  // the glass never writes it.
  expect(await rootAttribute(page, "data-luca-frame")).not.toBe("glass");
  // A frame that marks itself solid keeps its mark through the glass going
  // and coming back.
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-luca-frame", "solid"),
  );
  const setReduced = (on: boolean) =>
    page.evaluate(
      (value) =>
        (
          window as typeof window & {
            __setReducedTransparency__?: (on: boolean) => void;
          }
        ).__setReducedTransparency__?.(value),
      on,
    );
  await setReduced(true);
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .toBeNull();
  expect(await rootAttribute(page, "data-luca-frame")).toBe("solid");
  await setReduced(false);
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .toBe("liquid");
  expect(await rootAttribute(page, "data-luca-frame")).toBe("solid");
});

for (const mode of ["dark", "light"] as const) {
  for (const [name, route] of CARD_VIEWS) {
    test(`every card wears the glass light, ${mode}: ${name}`, async ({
      page,
    }) => {
      await openGlass(page, route, { light: mode === "light", liquid: true });
      await page.waitForTimeout(1200);
      await waitForAnimations(page);
      const cards = await measureCards(page);
      test.info().annotations.push({
        type: "cards",
        description: JSON.stringify(cards),
      });
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.boxShadow).toBe(
          mode === "dark" ? NIGHT_CARD_LIGHT : "none",
        );
      }
      await paintDesktop(page);
      await waitForAnimations(page);
      const png = await page.screenshot({
        path: `${SHOTS}/fix-cards-${mode}-${name}.png`,
        animations: "disabled",
        caret: "hide",
      });
      // Just outside the first card's right edge and below its bottom edge.
      const [card] = cards;
      const midY = card.rect.y + card.rect.h / 2;
      const midX = card.rect.x + card.rect.w / 2;
      const right = card.rect.x + card.rect.w;
      const bottom = card.rect.y + card.rect.h;
      const sampled = await pixels(page, png, [
        { x: right - 2, y: midY },
        { x: right + 0.5, y: midY },
        { x: Math.min(right + 3, 1439), y: midY },
        { x: midX, y: bottom - 2 },
        { x: midX, y: Math.min(bottom + 2, 899) },
      ]);
      test.info().annotations.push({
        type: "edge pixels",
        description: JSON.stringify({
          card: card.rect,
          insideRight: sampled[0],
          rightEdge: sampled[1],
          outsideRight: sampled[2],
          insideBottom: sampled[3],
          belowBottom: sampled[4],
        }),
      });
    });
  }
}

test("by day the cards' shadows lie on the glass beneath them", async ({
  page,
}) => {
  await openGlass(page, `/#/channels/${GENERAL_CHANNEL_ID}`, {
    light: true,
    liquid: true,
  });
  await page.getByText("Hey team — checking in.").waitFor();
  await page.waitForTimeout(600);
  await waitForAnimations(page);
  const measured = await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(
      "[data-luca-frame-shadows]",
    );
    if (!layer) return null;
    const style = getComputedStyle(layer);
    return {
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      parent: layer.parentElement?.tagName,
      shadows: [...layer.querySelectorAll<HTMLElement>("span")].map((span) => {
        const rect = span.getBoundingClientRect();
        const s = getComputedStyle(span);
        return {
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          radius: s.borderTopLeftRadius,
          opacity: s.opacity,
          boxShadow: s.boxShadow,
        };
      }),
      ink: getComputedStyle(document.documentElement)
        .getPropertyValue("--mn-ink")
        .trim(),
    };
  });
  const cards = await measureCards(page);
  test.info().annotations.push({
    type: "shadows",
    description: JSON.stringify({ measured, cards }),
  });
  expect(measured?.display).toBe("block");
  expect(measured?.position).toBe("fixed");
  expect(measured?.zIndex).toBe("-1");
  expect(measured?.shadows.length).toBe(cards.length);
  cards.forEach((card, index) => {
    const shadow = measured?.shadows[index];
    expect(shadow?.rect.x).toBeCloseTo(card.rect.x, 1);
    expect(shadow?.rect.y).toBeCloseTo(card.rect.y, 1);
    expect(shadow?.rect.w).toBeCloseTo(card.rect.w, 1);
    expect(shadow?.rect.h).toBeCloseTo(card.rect.h, 1);
    expect(shadow?.radius).toBe(card.radius);
    // 0 1px 2px ink 8%, 0 16px 40px -10px ink 22% (shellStudy.css:1335-1343).
    expect(shadow?.boxShadow).toMatch(
      /^rgba\([\d, .]+, 0\.08\) 0px 1px 2px 0px, rgba\([\d, .]+, 0\.22\) 0px 16px 40px -10px$/,
    );
  });

  await paintDesktop(page);
  await waitForAnimations(page);
  const card = cards[0];
  const midX = card.rect.x + card.rect.w / 2;
  const bottom = card.rect.y + card.rect.h;
  const right = card.rect.x + card.rect.w;
  const midY = card.rect.y + card.rect.h / 2;
  const at = [
    { x: midX, y: bottom - 2 },
    { x: midX, y: Math.min(bottom + 3, 899) },
    { x: right - 2, y: midY },
    { x: Math.min(right + 3, 1439), y: midY },
  ];
  const withShadow = await page.screenshot({
    path: `${SHOTS}/fix-day-shadows-conversation.png`,
    animations: "disabled",
    caret: "hide",
  });
  await page.addStyleTag({
    content: "[data-luca-frame-shadows] { display: none !important; }",
  });
  const withoutShadow = await page.screenshot({
    path: `${SHOTS}/fix-day-no-shadows-conversation.png`,
    animations: "disabled",
    caret: "hide",
  });
  const [a, b] = await Promise.all([
    pixels(page, withShadow, at),
    pixels(page, withoutShadow, at),
  ]);
  const report = {
    withShadow: {
      bottom: contrast(a[0], a[1]),
      right: contrast(a[2], a[3]),
      pixels: a,
    },
    withoutShadow: {
      bottom: contrast(b[0], b[1]),
      right: contrast(b[2], b[3]),
      pixels: b,
    },
  };
  test.info().annotations.push({
    type: "edge contrast",
    description: JSON.stringify(report),
  });
  expect(report.withShadow.bottom).toBeGreaterThan(report.withoutShadow.bottom);
});

test("at night the shadows' layer is not drawn", async ({ page }) => {
  await openGlass(page, `/#/channels/${GENERAL_CHANNEL_ID}`, {
    light: false,
    liquid: false,
  });
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () => document.querySelector("[data-luca-frame-shadows]") === null,
    ),
  ).toBe(true);
});

for (const mode of ["dark", "light"] as const) {
  test(`the Frame row's chosen option stands up, ${mode}`, async ({ page }) => {
    if (mode === "light") await seedTheme(page, "paper");
    await page.addInitScript(() =>
      window.localStorage.setItem("polyphonic-frame", "glass"),
    );
    await fakeNativeGlass(page);
    await fakeTauri(page);
    await installMockBridge(page);
    await setShellFrame(page, true);
    await openAppearance(page);
    const chosen = page.getByTestId("appearance-frame-glass");
    await expect(chosen).toHaveAttribute("aria-pressed", "true");
    await waitForAnimations(page);
    const styles = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(
        '[data-testid="appearance-frame-glass"]',
      );
      const other = document.querySelector<HTMLElement>(
        '[data-testid="appearance-frame-solid"]',
      );
      const track = button?.closest("fieldset");
      const css = (element: Element | null | undefined) =>
        element ? getComputedStyle(element) : null;
      return {
        track: css(track)?.backgroundColor,
        chosen: css(button)?.backgroundColor,
        chosenShadow: css(button)?.boxShadow,
        chosenColor: css(button)?.color,
        other: css(other)?.backgroundColor,
        otherColor: css(other)?.color,
        chosenBox: button?.getBoundingClientRect().toJSON(),
        trackBox: track?.getBoundingClientRect().toJSON(),
      };
    });
    test.info().annotations.push({
      type: "segment",
      description: JSON.stringify(styles),
    });
    const png = await page.screenshot({
      animations: "disabled",
      caret: "hide",
    });
    const box = styles.chosenBox as DOMRect;
    const track = styles.trackBox as DOMRect;
    const [chip, onTrack] = await pixels(page, png, [
      { x: box.x + 4, y: box.y + box.height / 2 },
      { x: track.x + 2, y: track.y + track.height / 2 },
    ]);
    test.info().annotations.push({
      type: "segment pixels",
      description: JSON.stringify({
        chip,
        track: onTrack,
        contrast: contrast(chip, onTrack),
      }),
    });
    if (mode === "dark") {
      expect(styles.track).toMatch(/, 0\.06\)$/);
      expect(styles.chosen).toMatch(/, 0\.14\)$/);
      expect(contrast(chip, onTrack)).toBeGreaterThan(1.1);
    } else {
      expect(styles.track).toMatch(/, 0\.06\)$/);
      expect(styles.chosen).toMatch(/^rgb\(/);
      expect(styles.chosenShadow).toMatch(
        /0\.22\) 0px 0\.5px 1px 0px, .*0\.1\) 0px 1px 3px 0px$/,
      );
      // White paper on its track: lighter than the track, never a dip.
      expect(luminance(chip)).toBeGreaterThan(luminance(onTrack));
    }
  });
}

for (const [label, seed] of [
  ["Vitesse Black", {}],
  ["Obsidian", { theme: "obsidian" }],
  ["Crystalline", { theme: "crystalline" }],
  ["System", { followSystem: true }],
] as const) {
  test(`flag off: the main window asks nothing of its appearance (${label})`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value: { theme?: string; followSystem?: boolean }) => {
        if (value.theme) window.localStorage.setItem("buzz-theme", value.theme);
        if (value.followSystem) {
          window.localStorage.setItem("buzz-follow-system", "true");
        }
      },
      seed,
    );
    await fakeTauri(page);
    await installMockBridge(page);
    await setShellFrame(page, false);
    await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
    await page.getByText("Hey team — checking in.").waitFor();
    await page.waitForTimeout(800);
    const log = await commandLog(page);
    const themes = log.filter(
      (entry) => entry.command === "plugin:window|set_theme",
    );
    test.info().annotations.push({
      type: "set_theme calls",
      description: JSON.stringify(themes),
    });
    expect(themes).toEqual([]);
  });
}

test("flag on: the main window's appearance follows the palette", async ({
  page,
}) => {
  await seedTheme(page, "obsidian");
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.getByText("Hey team — checking in.").waitFor();
  await expect
    .poll(async () =>
      (await commandLog(page))
        .filter((entry) => entry.command === "plugin:window|set_theme")
        .map((entry) => entry.payload?.value),
    )
    .toContain("dark");
});

// ── with the frame (WP-01) merged: run against a merged build ─────────
//
// `WP07A_MERGE=1` against a build of this branch merged with the frame's.
// Proves the glass leaves the frame's layout alone, lights the rail's card,
// casts its shadow by day, and dresses the frame's words in the glass tones.

test.describe("with the frame merged", () => {
  test.skip(!process.env.WP07A_MERGE, "needs a build with WP-01 merged");

  /** A flat stand-in desktop, so what shows through can be read exactly. */
  const paintFlat = (page: Page) =>
    page.addStyleTag({
      content:
        ":root:root[data-luca-frame-glass] { background: rgb(255 0 0) !important; }",
    });

  for (const liquid of [true, false]) {
    test(`the frame holds under ${liquid ? "Liquid Glass" : "frosted glass"}`, async ({
      page,
    }) => {
      await openGlass(page, `/#/channels/${GENERAL_CHANNEL_ID}`, {
        light: false,
        liquid,
      });
      await page.getByText("Hey team — checking in.").waitFor();
      await page.waitForTimeout(800);
      await waitForAnimations(page);
      const measured = await page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const root = document.documentElement;
        const row = document.querySelector("[data-luca-frame-row]");
        const rail = document.querySelector<HTMLElement>(
          '[data-frame] [data-sidebar="sidebar"]',
        );
        return {
          frame: root.getAttribute("data-luca-frame"),
          glass: root.getAttribute("data-luca-frame-glass"),
          rowPaddingTop: row ? getComputedStyle(row).paddingTop : null,
          cardLip: getComputedStyle(root).getPropertyValue("--mn-card-lip"),
          places: box('[data-testid="shell-places"]'),
          rail: box('[data-frame] [data-sidebar="sidebar"]'),
          railRadius: rail ? getComputedStyle(rail).borderTopLeftRadius : null,
          railShadow: rail ? getComputedStyle(rail).boxShadow : null,
          card: box("[data-luca-card]"),
          chatTitle: (() => {
            const title = document.querySelector('[data-testid="chat-title"]');
            return title ? getComputedStyle(title).display : null;
          })(),
        };
      });
      test.info().annotations.push({
        type: "frame under glass",
        description: JSON.stringify(measured),
      });
      expect(measured.frame).toBe("solid");
      expect(measured.glass).toBe(liquid ? "liquid" : "frosted");
      expect(measured.rowPaddingTop).toBe("36px");
      expect(measured.cardLip.trim()).toBe("6px");
      expect(measured.places).toEqual({ x: 0, y: 36, w: 44, h: 864 });
      expect(measured.rail).toEqual({ x: 44, y: 36, w: 220, h: 858 });
      expect(measured.railRadius).toBe("10px");
      expect(measured.railShadow).toBe(NIGHT_CARD_LIGHT);
      expect(measured.card?.y).toBe(36);
      expect(measured.card?.x).toBe(268);
      expect(measured.chatTitle).toBe("none");

      // Glass shows at every part of the frame: a flat red desktop under the
      // veil (black at 22%) reads (199, 0, 0), where no card's shadow lies on
      // it; with the cards' shadows hidden, everywhere.
      await paintFlat(page);
      await waitForAnimations(page);
      const probes = [
        { name: "lip", x: 1000, y: 3 },
        { name: "places gap", x: 3, y: 450 },
        { name: "places, beside the icons", x: 40, y: 450 },
        { name: "right 6", x: 1437, y: 450 },
        { name: "bottom 6", x: 720, y: 897 },
        { name: "between the cards", x: 266, y: 450 },
        { name: "under the rail", x: 150, y: 897 },
      ];
      const shot = `${SHOTS}/merge-frame-${liquid ? "liquid" : "frosted"}-dark-probes`;
      const shadowed = await pixels(
        page,
        await page.screenshot({
          path: `${shot}.png`,
          animations: "disabled",
          caret: "hide",
        }),
        probes,
      );
      await page.addStyleTag({
        content: "* { box-shadow: none !important; }",
      });
      const bare = await pixels(
        page,
        await page.screenshot({
          path: `${shot}-no-card-shadows.png`,
          animations: "disabled",
          caret: "hide",
        }),
        probes,
      );
      test.info().annotations.push({
        type: "probes",
        description: JSON.stringify(
          probes.map((probe, index) => ({
            ...probe,
            withCardShadows: shadowed[index],
            withoutCardShadows: bare[index],
          })),
        ),
      });
      for (const rgb of shadowed) {
        // The glass, never the solid floor (0, 0, 0).
        expect(rgb[0]).toBeGreaterThan(140);
      }
      for (const rgb of bare) {
        expect(Math.abs(rgb[0] - 199)).toBeLessThanOrEqual(3);
        expect(rgb[1]).toBeLessThanOrEqual(3);
        expect(rgb[2]).toBeLessThanOrEqual(3);
      }
    });
  }

  for (const mode of ["dark", "light"] as const) {
    test(`the frame's words wear the glass tones, ${mode}`, async ({
      page,
    }) => {
      await openGlass(page, `/#/channels/${GENERAL_CHANNEL_ID}`, {
        light: mode === "light",
        liquid: true,
      });
      await page.getByText("Hey team — checking in.").waitFor();
      await page.waitForTimeout(800);
      const tones = await page.evaluate(() => {
        const color = (selector: string) => {
          const element = document.querySelector(selector);
          return element ? getComputedStyle(element).color : null;
        };
        const current = document.querySelector(".luca-place[data-current]");
        return {
          lip: color(".luca-lip"),
          name: color(".luca-lip-name"),
          button: color(".luca-lip-button"),
          place: color(".luca-place:not([data-current])"),
          current: current ? getComputedStyle(current).color : null,
          currentPlate: current
            ? getComputedStyle(current).backgroundColor
            : null,
          ink: getComputedStyle(document.documentElement)
            .getPropertyValue("--mn-ink")
            .trim(),
        };
      });
      test.info().annotations.push({
        type: "tones",
        description: JSON.stringify(tones),
      });
      if (mode === "dark") {
        expect(tones.lip).toBe("rgba(250, 248, 243, 0.96)");
        expect(tones.name).toBe("rgba(250, 248, 243, 0.96)");
        expect(tones.button).toBe("rgba(250, 248, 243, 0.76)");
        expect(tones.place).toBe("rgba(250, 248, 243, 0.76)");
        expect(tones.current).toBe("rgba(250, 248, 243, 0.96)");
        expect(tones.currentPlate).toBe("rgba(255, 255, 255, 0.1)");
      } else {
        const ink = tones.lip
          ?.match(/[\d.]+/g)
          ?.slice(0, 3)
          .join(", ");
        expect(tones.lip).toBe(`rgb(${ink})`);
        expect(tones.button).toBe(`rgba(${ink}, 0.84)`);
        expect(tones.place).toBe(`rgba(${ink}, 0.84)`);
      }

      // Over the study's stand-in desktop, at the foot of the places column.
      await paintDesktop(page);
      await waitForAnimations(page);
      const png = await page.screenshot({
        path: `${SHOTS}/merge-words-${mode}-conversation.png`,
        animations: "disabled",
        caret: "hide",
      });
      const settings = await page
        .locator(".luca-places-end .luca-place, .luca-places-end button")
        .first()
        .boundingBox();
      const avatar = await page.locator(".luca-shell-avatar").boundingBox();
      if (!settings || !avatar) throw new Error("places' foot not found");
      const [behindSettings, behindAvatar] = await pixels(page, png, [
        { x: 3, y: settings.y + settings.height / 2 },
        { x: 3, y: avatar.y + avatar.height / 2 },
      ]);
      const over = (tone: string | null, ground: number[]) => {
        const [r, g, b, a = 1] = (tone?.match(/[\d.]+/g) ?? []).map(Number);
        return [r, g, b].map((c, i) => c * a + ground[i] * (1 - a));
      };
      const report = {
        behindSettings,
        behindAvatar,
        muted: {
          settings: contrast(over(tones.place, behindSettings), behindSettings),
          avatar: contrast(over(tones.place, behindAvatar), behindAvatar),
        },
        ink: {
          settings: contrast(over(tones.lip, behindSettings), behindSettings),
          avatar: contrast(over(tones.lip, behindAvatar), behindAvatar),
        },
      };
      test.info().annotations.push({
        type: "contrast at the places' foot",
        description: JSON.stringify(report),
      });
    });
  }

  test("by day the rail's card casts its shadow, and it fades as it closes", async ({
    page,
  }) => {
    await openGlass(page, `/#/channels/${GENERAL_CHANNEL_ID}`, {
      light: true,
      liquid: true,
    });
    await page.getByText("Hey team — checking in.").waitFor();
    await page.waitForTimeout(800);
    await waitForAnimations(page);
    const shadows = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            "[data-luca-frame-shadows] span",
          ),
        ].map((span) => {
          const r = span.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            opacity: Number(getComputedStyle(span).opacity),
          };
        }),
      );
    const open = await shadows();
    const cards = await measureCards(page);
    test.info().annotations.push({
      type: "open",
      description: JSON.stringify({ open, cards }),
    });
    expect(open).toContainEqual({ x: 44, y: 36, w: 220, h: 858, opacity: 1 });
    for (const card of cards) expect(card.boxShadow).toBe("none");
    await paintDesktop(page);
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOTS}/merge-day-shadows-open.png`,
      animations: "disabled",
      caret: "hide",
    });

    // Closing: sampled through the slide, then shut.
    await page.getByTestId("shell-lip-toggle").click();
    const during: { w: number; opacity: number }[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(60);
      const rail = (await shadows()).find((s) => s.x === 44 && s.w < 220);
      if (rail) during.push({ w: rail.w, opacity: rail.opacity });
    }
    await page.waitForTimeout(700);
    await waitForAnimations(page);
    const closed = await shadows();
    test.info().annotations.push({
      type: "closing",
      description: JSON.stringify({ during, closed }),
    });
    expect(during.length).toBeGreaterThan(0);
    for (const sample of during) {
      expect(sample.opacity).toBeCloseTo(sample.w / 220, 2);
    }
    expect(closed.some((s) => s.x === 44 && s.w < 220)).toBe(false);
    await page.screenshot({
      path: `${SHOTS}/merge-day-shadows-closed.png`,
      animations: "disabled",
      caret: "hide",
    });
  });
});

// ── WP-05b: the Frame row says what is drawn ────────────────────────────
// docs/luca/rail-system/SHELL_BUILD.md, "WP-05b", decisions 6 and 7. Each
// test writes its measurements beside its shots, in wp05b-<check>.json.

const SHOTS_05B = process.env.WP05B_SHOTS ?? SHOTS;

function record05b(key: string, value: Record<string, unknown>) {
  mkdirSync(SHOTS_05B, { recursive: true });
  writeFileSync(
    `${SHOTS_05B}/wp05b-${key}.json`,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

/** A Tauri window off the Mac (Windows): the platform the page reads. */
async function fakeWindows(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", {
      configurable: true,
      get: () => "Win32",
    });
  });
}

/** Full screen, switchable while the page runs: the window answers
 *  `is_fullscreen` with it, and a resize says it changed (as macOS does). */
async function fakeFullscreen(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __FAKE_FULLSCREEN__: boolean;
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, ...rest: unknown[]) => Promise<unknown>;
      };
    };
    const internals = w.__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    w.__FAKE_FULLSCREEN__ = false;
    internals.invoke = (cmd, ...rest) =>
      cmd === "plugin:window|is_fullscreen"
        ? Promise.resolve(w.__FAKE_FULLSCREEN__)
        : invoke(cmd, ...rest);
  });
}

const setFullscreen = (page: Page, on: boolean) =>
  page.evaluate((value) => {
    const w = window as unknown as {
      __FAKE_FULLSCREEN__: boolean;
      __BUZZ_E2E_EMIT_TAURI_EVENT__: (event: string, payload: unknown) => void;
    };
    w.__FAKE_FULLSCREEN__ = value;
    w.__BUZZ_E2E_EMIT_TAURI_EVENT__("tauri://resize", {
      width: 2880,
      height: 1800,
    });
  }, on);

test("WP-05b: in a browser the Frame row is a statement", async ({ page }) => {
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  const row = frameRow(page);
  const read = await row.evaluate((element) => ({
    controls: element.querySelectorAll("fieldset, button, [role=radio]").length,
    label: element.querySelector("#appearance-frame-label")?.textContent,
    sentence: element.querySelector('[data-testid="appearance-frame-sentence"]')
      ?.textContent,
  }));
  await shootRow(page, `${SHOTS_05B}/wp05b-row-browser-statement.png`);
  const ok =
    read.controls === 0 &&
    read.label === "Frame" &&
    read.sentence === "Solid black, nothing showing through it.";
  record05b("browser_statement", { ...read, ok });
  expect(ok).toBe(true);
});

test("WP-05b: Glass is offered only where it can be drawn", async ({
  page,
  browser,
}) => {
  // Tauri off the Mac: nothing but the solid frame can be drawn yet.
  await fakeWindows(page);
  await page.addInitScript(() =>
    window.localStorage.setItem("polyphonic-frame", "glass"),
  );
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  const windows = {
    platform: await page.evaluate(() => navigator.platform),
    controls: await frameRow(page).locator("fieldset, button").count(),
    sentence: await page.getByTestId("appearance-frame-sentence").innerText(),
    glass_mark: await rootAttribute(page, "data-luca-frame-glass"),
  };
  await shootRow(page, `${SHOTS_05B}/wp05b-row-tauri-windows.png`);

  // Tauri on a Mac: both choices.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const mac = await context.newPage();
  await fakeTauri(mac);
  await installMockBridge(mac);
  await setShellFrame(mac, true);
  await openAppearance(mac);
  const macRead = {
    platform: await mac.evaluate(() => navigator.platform),
    choices: await frameRow(mac)
      .locator("fieldset button")
      .evaluateAll((buttons) => buttons.map((b) => b.textContent)),
  };
  await context.close();
  const ok =
    windows.platform === "Win32" &&
    windows.controls === 0 &&
    windows.sentence === "Solid black, nothing showing through it." &&
    windows.glass_mark === null &&
    /mac/i.test(macRead.platform) &&
    macRead.choices.join("|") === "Black|Glass";
  record05b("glass_offered_where_drawn", { windows, mac: macRead, ok });
  expect(ok).toBe(true);
});

test("WP-05b: under Reduce Transparency Liquid Glass stays chosen, drawn solid", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("polyphonic-frame", "glass"),
  );
  await fakeReducedTransparency(page);
  await fakeNativeGlass(page);
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  const sentence = page.getByTestId("appearance-frame-sentence");
  await expect(sentence).toHaveText(
    "Liquid Glass, your desktop showing through it.",
  );
  const before = await rootAttribute(page, "data-luca-frame-glass");
  await page.evaluate(() =>
    (
      window as typeof window & {
        __setReducedTransparency__?: (on: boolean) => void;
      }
    ).__setReducedTransparency__?.(true),
  );
  await expect(sentence).toHaveText(
    "Liquid Glass, drawn solid while Reduce Transparency is on.",
  );
  const reduced = {
    sentence: await sentence.innerText(),
    glass_pressed: await page
      .getByTestId("appearance-frame-glass")
      .getAttribute("aria-pressed"),
    solid_pressed: await page
      .getByTestId("appearance-frame-solid")
      .getAttribute("aria-pressed"),
    glass_mark: await rootAttribute(page, "data-luca-frame-glass"),
    stored: await page.evaluate(() =>
      window.localStorage.getItem("polyphonic-frame"),
    ),
  };
  await shootRow(page, `${SHOTS_05B}/wp05b-row-reduce-transparency.png`);
  await page.evaluate(() =>
    (
      window as typeof window & {
        __setReducedTransparency__?: (on: boolean) => void;
      }
    ).__setReducedTransparency__?.(false),
  );
  await expect(sentence).toHaveText(
    "Liquid Glass, your desktop showing through it.",
  );
  const ok =
    before === "liquid" &&
    reduced.glass_pressed === "true" &&
    reduced.solid_pressed === "false" &&
    reduced.glass_mark === null &&
    reduced.stored === "glass";
  record05b("reduce_transparency_words", {
    before_mark: before,
    reduced,
    after: await sentence.innerText(),
    ok,
  });
  expect(ok).toBe(true);
});

test("WP-05b: the sentence describes the Frame choice", async ({ page }) => {
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  const read = await page.evaluate(() => {
    const fieldset = document.querySelector(
      '[data-testid="appearance-frame"] fieldset',
    );
    const id = fieldset?.getAttribute("aria-describedby") ?? null;
    const target = id ? document.getElementById(id) : null;
    return {
      described_by: id,
      target_testid: target?.getAttribute("data-testid") ?? null,
      target_text: target?.textContent ?? null,
      labelled_by: fieldset?.getAttribute("aria-labelledby") ?? null,
    };
  });
  // What a screen reader is told about the group.
  const group = page.locator('[data-testid="appearance-frame"] fieldset');
  const snapshot = await group.ariaSnapshot();
  await expect(group).toHaveAccessibleDescription(
    "Solid black, nothing showing through it.",
  );
  await expect(group).toHaveAccessibleName("Frame");
  const ok =
    read.target_testid === "appearance-frame-sentence" &&
    read.target_text === "Solid black, nothing showing through it." &&
    read.labelled_by === "appearance-frame-label";
  record05b("described_by", {
    ...read,
    aria_snapshot: snapshot,
    accessible_description: "Solid black, nothing showing through it.",
    accessible_name: "Frame",
    ok,
  });
  expect(ok).toBe(true);
});

test("WP-05b: in full screen the frosted glass has square corners", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("polyphonic-frame", "glass"),
  );
  await fakeTauri(page);
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  await expect
    .poll(() => rootAttribute(page, "data-luca-frame-glass"))
    .toBe("frosted");
  await fakeFullscreen(page);
  const vibrancy = async () =>
    (await commandLog(page)).filter(
      (entry) => entry.command === "set_window_vibrancy",
    );
  const windowed = (await vibrancy()).at(-1)?.payload ?? null;

  await setFullscreen(page, true);
  await expect
    .poll(async () => (await vibrancy()).at(-1)?.payload?.cornerRadius)
    .toBe(0);
  const entered = {
    payload: (await vibrancy()).at(-1)?.payload ?? null,
    fullscreen_mark: await rootAttribute(page, "data-luca-window-fullscreen"),
    glass_mark: await rootAttribute(page, "data-luca-frame-glass"),
    veil_radius: await page.evaluate(
      () => getComputedStyle(document.body, "::before").borderTopLeftRadius,
    ),
  };
  await paintDesktop(page);
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOTS_05B}/wp05b-frosted-fullscreen-corner.png`,
    clip: { x: 0, y: 0, width: 320, height: 200 },
  });

  await setFullscreen(page, false);
  await expect
    .poll(async () => (await vibrancy()).at(-1)?.payload?.cornerRadius)
    .toBe(16);
  const left = {
    payload: (await vibrancy()).at(-1)?.payload ?? null,
    fullscreen_mark: await rootAttribute(page, "data-luca-window-fullscreen"),
    veil_radius: await page.evaluate(
      () => getComputedStyle(document.body, "::before").borderTopLeftRadius,
    ),
  };
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOTS_05B}/wp05b-frosted-windowed-corner.png`,
    clip: { x: 0, y: 0, width: 320, height: 200 },
  });
  const ok =
    (windowed as { cornerRadius?: number } | null)?.cornerRadius === 16 &&
    (entered.payload as { cornerRadius?: number; material?: string } | null)
      ?.cornerRadius === 0 &&
    (entered.payload as { material?: string } | null)?.material ===
      "hud-window" &&
    entered.fullscreen_mark === "" &&
    entered.glass_mark === "frosted" &&
    entered.veil_radius === "0px" &&
    (left.payload as { cornerRadius?: number } | null)?.cornerRadius === 16 &&
    left.fullscreen_mark === null &&
    left.veil_radius === "16px";
  record05b("fullscreen_square_frost", { windowed, entered, left, ok });
  expect(ok).toBe(true);
});
