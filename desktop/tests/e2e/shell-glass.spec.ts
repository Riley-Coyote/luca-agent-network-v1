import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
      :root:root[data-luca-frame="glass"].dark {
        background:
          radial-gradient(60% 50% at 78% 82%, rgb(242 170 104 / 0.85), transparent 70%),
          radial-gradient(40% 35% at 18% 70%, rgb(126 104 168 / 0.7), transparent 70%),
          linear-gradient(180deg, #16223f 0%, #2d3561 38%, #8c5a74 68%, #e19a6b 100%) !important;
      }
      :root:root[data-luca-frame="glass"]:not(.dark) {
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

test("browser, dark: Black only, its sentence, no glass", async ({ page }) => {
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  const row = frameRow(page);
  await expect(row).toBeVisible();
  await expect(page.getByTestId("appearance-frame-solid")).toHaveText("Black");
  await expect(page.getByTestId("appearance-frame-glass")).toHaveCount(0);
  await expect(page.getByTestId("appearance-frame-sentence")).toHaveText(
    "Solid black, nothing showing through it.",
  );
  await expect(page.getByTestId("settings-native-glass")).toHaveCount(0);
  expect(await rootAttribute(page, "data-luca-frame")).toBe("solid");
  // Directly under System / Light / Dark.
  const modes = await page.getByTestId("appearance-mode-dark").boundingBox();
  const box = await row.boundingBox();
  expect(box && modes && box.y > modes.y + modes.height - 1).toBe(true);
  await shootRow(page, `${SHOTS}/row-browser-dark.png`);
});

test("browser, light: Paper only, its sentence", async ({ page }) => {
  await seedTheme(page, "paper");
  await installMockBridge(page);
  await setShellFrame(page, true);
  await openAppearance(page);
  await expect(page.getByTestId("appearance-frame-solid")).toHaveText("Paper");
  await expect(page.getByTestId("appearance-frame-glass")).toHaveCount(0);
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
  await expect(page.getByTestId("appearance-frame-solid")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await rootAttribute(page, "data-luca-frame")).toBe("solid");
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
  await expect.poll(() => rootAttribute(page, "data-luca-frame")).toBe("glass");
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
  await expect.poll(() => rootAttribute(page, "data-luca-frame")).toBe("solid");
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
  await expect.poll(() => rootAttribute(page, "data-luca-frame")).toBe("glass");
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
    .poll(() => rootAttribute(page, "data-luca-frame"), { timeout: 15_000 })
    .toBe("glass");
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
      .poll(() => rootAttribute(page, "data-luca-frame"))
      .toBe("glass");
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
  await expect.poll(() => rootAttribute(page, "data-luca-frame")).toBe("glass");
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
  await expect.poll(() => rootAttribute(page, "data-luca-frame")).toBe("solid");
  // And back.
  await page.evaluate(() =>
    (
      window as typeof window & {
        __setReducedTransparency__?: (on: boolean) => void;
      }
    ).__setReducedTransparency__?.(false),
  );
  await expect.poll(() => rootAttribute(page, "data-luca-frame")).toBe("glass");
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
