import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-08d, the glass themes retire (docs/luca/rail-system/SHELL_BUILD.md;
 * SHELL_SPEC.md, "The glass themes" and Decided 7). Under `shell-frame`:
 * Obsidian and Crystalline leave Appearance; someone on one moves once, to
 * Vitesse Black or Paper with the Glass frame; glass-floor.css stands down.
 * With the flag off both themes are there and drawn exactly as before.
 */

const SHOTS = process.env.WP08D_SHOTS ?? "test-results/shell-glass-themes";
const BASE_URL = process.env.WP08D_BASE_URL ?? "http://127.0.0.1:4300";
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const MOVE_KEY = "polyphonic-glass-theme-moved";
const FRAME_KEY = "polyphonic-frame";
const ACCENT = "#60a5fa";

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.setTimeout(90_000);

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[console] ${message.text()}`);
  });
});

/** A profile, seeded once per tab: its theme, its accent and mode, and the
 *  frame flag as it starts. Reloads keep whatever the app stored since. */
async function seedProfile(
  page: Page,
  {
    theme,
    shellFrame,
    followSystem = false,
  }: { theme: string; shellFrame: boolean; followSystem?: boolean },
) {
  await page.addInitScript(
    ({ key, theme: value, on, accent, system }) => {
      if (window.sessionStorage.getItem("wp08d-seeded")) return;
      window.sessionStorage.setItem("wp08d-seeded", "1");
      window.localStorage.setItem("buzz-theme", value);
      window.localStorage.setItem("buzz-follow-system", String(system));
      window.localStorage.setItem("buzz-accent-color", accent);
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? JSON.parse(raw) : {};
      overrides["shell-frame"] = on;
      window.localStorage.setItem(key, JSON.stringify(overrides));
    },
    {
      key: FEATURE_OVERRIDES_STORAGE_KEY,
      theme,
      on: shellFrame,
      accent: ACCENT,
      system: followSystem,
    },
  );
}

/** The flag off for good, on every load (for the base comparison). */
async function flagOffAlways(page: Page) {
  await page.addInitScript((key) => {
    const raw = window.localStorage.getItem(key);
    const overrides = raw ? JSON.parse(raw) : {};
    overrides["shell-frame"] = false;
    window.localStorage.setItem(key, JSON.stringify(overrides));
  }, FEATURE_OVERRIDES_STORAGE_KEY);
}

async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
  });
}

/** Turn the flag on or off while the app runs, as Settings → Preview does
 *  from another window: the store, then its storage event. */
async function flipFlag(page: Page, on: boolean) {
  await page.evaluate(
    ({ key, on: value }) => {
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? JSON.parse(raw) : {};
      overrides["shell-frame"] = value;
      window.localStorage.setItem(key, JSON.stringify(overrides));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on },
  );
}

async function openAppearance(page: Page) {
  await page.goto("/#/settings?section=appearance", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("settings-theme")).toBeVisible({
    timeout: 20_000,
  });
  await waitForAnimations(page);
}

/** What a profile looks like now: drawn and stored. */
const profile = (page: Page) =>
  page.evaluate(
    ({ moveKey, frameKey }) => {
      const root = document.documentElement;
      const raw = window.localStorage.getItem(moveKey);
      return {
        palette: root.getAttribute("data-luca-theme"),
        dark: root.classList.contains("dark"),
        frameAttr: root.hasAttribute("data-luca-frame"),
        frameGlass: root.getAttribute("data-luca-frame-glass"),
        storedTheme: window.localStorage.getItem("buzz-theme"),
        storedFrame: window.localStorage.getItem(frameKey),
        followSystem: window.localStorage.getItem("buzz-follow-system"),
        accent: window.localStorage.getItem("buzz-accent-color"),
        move: raw ? JSON.parse(raw) : null,
      };
    },
    { moveKey: MOVE_KEY, frameKey: FRAME_KEY },
  );

/** The study's dusk and daylight skies behind the clear page
 *  (shellStudy.css:80-89, 1282-1287), as shell-glass.spec.ts paints them. */
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

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOTS}/${name}.png`,
    animations: "disabled",
    caret: "hide",
  });
}

const tileIds = (page: Page) =>
  page
    .locator('[data-testid^="theme-option-"], [data-testid^="theme-pair-"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid")),
    );

// ── someone on a glass theme moves, once, and comes back ─────────────────

// WP-09a, 9: a coloured accent Obsidian kept hidden (it pins the neutral
// one) is set aside with the move, so the successor shows its own; it comes
// back with Obsidian. Paper doesn't pin one, so Crystalline's accent stays.
for (const glass of [
  {
    theme: "obsidian",
    to: "vitesse-black",
    dark: true,
    movedAccent: "neutral",
  },
  { theme: "crystalline", to: "paper", dark: false, movedAccent: ACCENT },
]) {
  test(`${glass.theme}: moves to ${glass.to} with the Glass frame, and back`, async ({
    page,
  }) => {
    await fakeTauri(page);
    await installMockBridge(page);
    await seedProfile(page, { theme: glass.theme, shellFrame: false });
    await openAppearance(page);
    await paintDesktop(page);

    const before = await profile(page);
    console.log(`[${glass.theme}] before ${JSON.stringify(before)}`);
    expect(before.palette).toBe(glass.theme);
    expect(before.dark).toBe(glass.dark);
    expect(before.storedFrame).toBeNull();
    expect(before.move).toBeNull();
    await shoot(page, `${glass.theme}-1-before-flag-off`);

    // The flag turns on while the app runs.
    await flipFlag(page, true);
    await expect
      .poll(() => profile(page).then((p) => p.palette))
      .toBe(glass.to);
    await expect(page.getByTestId("appearance-frame-glass")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const after = await profile(page);
    console.log(`[${glass.theme}] after ${JSON.stringify(after)}`);
    expect(after).toMatchObject({
      palette: glass.to,
      dark: glass.dark,
      frameAttr: true,
      storedTheme: glass.to,
      storedFrame: "glass",
      followSystem: "false",
      accent: glass.movedAccent,
      move: { from: glass.theme, to: glass.to, frame: null },
    });
    await expect
      .poll(() => profile(page).then((p) => p.frameGlass))
      .toBe("frosted");
    // Its successor is the chosen tile, and the glass theme's tile is gone.
    await expect(page.getByTestId(`theme-option-${glass.to}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId(`theme-option-${glass.theme}`)).toHaveCount(
      0,
    );
    await shoot(page, `${glass.theme}-2-after-flag-on`);

    // A reload keeps it, and moves nothing again.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("settings-theme")).toBeVisible({
      timeout: 20_000,
    });
    const reloaded = await profile(page);
    expect(reloaded).toMatchObject({
      palette: glass.to,
      storedTheme: glass.to,
      storedFrame: "glass",
      move: after.move,
    });
    await expect
      .poll(() => profile(page).then((p) => p.frameGlass))
      .toBe("frosted");

    // The flag turns off again: what they had comes back.
    await flipFlag(page, false);
    await expect
      .poll(() => profile(page).then((p) => p.palette))
      .toBe(glass.theme);
    const restored = await profile(page);
    console.log(`[${glass.theme}] restored ${JSON.stringify(restored)}`);
    expect(restored).toMatchObject({
      palette: glass.theme,
      dark: glass.dark,
      frameAttr: false,
      frameGlass: null,
      storedTheme: glass.theme,
      storedFrame: null,
      followSystem: "false",
      accent: ACCENT,
      move: null,
    });
    // Its tile is back, and chosen.
    await page
      .getByTestId(`appearance-mode-${glass.dark ? "dark" : "light"}`)
      .click();
    await expect(
      page.getByTestId(`theme-option-${glass.theme}`),
    ).toHaveAttribute("aria-pressed", "true");
    await shoot(page, `${glass.theme}-3-restored-flag-off`);
  });
}

test("the move happens once: a later palette and frame survive reloads and the flag off", async ({
  page,
}) => {
  await fakeTauri(page);
  await installMockBridge(page);
  // On at boot: the move happens before the first paint.
  await seedProfile(page, { theme: "obsidian", shellFrame: true });
  await openAppearance(page);
  const moved = await profile(page);
  expect(moved).toMatchObject({
    palette: "vitesse-black",
    storedFrame: "glass",
    move: { from: "obsidian", to: "vitesse-black", frame: null },
  });

  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("theme-option-graphite").click();
  await page.getByTestId("appearance-frame-solid").click();
  await expect
    .poll(() => profile(page).then((p) => p.palette))
    .toBe("graphite");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("settings-theme")).toBeVisible({
    timeout: 20_000,
  });
  const reloaded = await profile(page);
  expect(reloaded).toMatchObject({
    palette: "graphite",
    storedTheme: "graphite",
    storedFrame: "solid",
    move: moved.move,
  });

  await flipFlag(page, false);
  await expect.poll(() => profile(page).then((p) => p.frameAttr)).toBe(false);
  const off = await profile(page);
  expect(off).toMatchObject({
    palette: "graphite",
    storedTheme: "graphite",
    storedFrame: "solid",
    move: null,
  });
});

// ── System mode: the glass pair's owners keep a day and a night ─────────

// Under the frame the two defaults pair with each other, so whichever glass
// member was stored, the moved owner has Paper by day and Vitesse Black by
// night, and the Paper · Vitesse Black pair reads as chosen in System.
for (const glass of ["obsidian", "crystalline"]) {
  for (const scheme of ["dark", "light"] as const) {
    test(`System mode, ${glass} stored, ${scheme} Mac: the defaults' pair`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await fakeTauri(page);
      await installMockBridge(page);
      await seedProfile(page, {
        theme: glass,
        shellFrame: true,
        followSystem: true,
      });
      await openAppearance(page);
      const expected = scheme === "dark" ? "vitesse-black" : "paper";
      await expect
        .poll(() => profile(page).then((p) => p.palette))
        .toBe(expected);
      const now = await profile(page);
      console.log(`[system ${glass} ${scheme}] ${JSON.stringify(now)}`);
      expect(now).toMatchObject({
        dark: scheme === "dark",
        storedFrame: "glass",
        followSystem: "true",
        move: { from: glass },
      });
      await expect(page.getByTestId("appearance-mode-system")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const pair = page.getByTestId("theme-pair-paper");
      await expect(pair).toHaveAttribute("aria-pressed", "true");
      await expect(pair).toBeInViewport();
      await shoot(page, `system-${glass}-${scheme}`);
    });
  }
}

// ── Dark under the frame leads with the dark default ────────────────────

test("flag on: Dark leads with Vitesse Black, where Obsidian's owners land", async ({
  page,
}) => {
  await fakeTauri(page);
  await installMockBridge(page);
  await seedProfile(page, { theme: "obsidian", shellFrame: true });
  await openAppearance(page);
  await page.getByTestId("appearance-mode-dark").click();
  await waitForAnimations(page);
  const ids = (await tileIds(page)).filter((id): id is string => !!id);
  expect(ids[0]).toBe("theme-option-vitesse-black");
  expect(ids.filter((id) => id === "theme-option-vitesse-black")).toHaveLength(
    1,
  );
  const chosen = page.getByTestId("theme-option-vitesse-black");
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  await expect(chosen).toBeInViewport();
});

// ── the one card is painted in every palette ───────────────────────────

// Slate clears the rail's .bg-sidebar to show its floor (theme.css); under
// the frame the rail and the conversation lie on the one card (WP-12), which
// keeps its own surface, Black frame and Glass, and the rail on it is clear.
for (const frame of ["solid", "glass"] as const) {
  test(`flag on, Slate, ${frame} frame: the one card is painted`, async ({
    page,
  }) => {
    await fakeTauri(page);
    await installMockBridge(page);
    await seedProfile(page, { theme: "buzz", shellFrame: true });
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      { key: FRAME_KEY, value: frame },
    );
    await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`, {
      waitUntil: "domcontentloaded",
    });
    const rail = page.locator('[data-frame] [data-sidebar="sidebar"]');
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await waitForAnimations(page);
    const paint = await page.evaluate(() => {
      const one = document.querySelector("[data-luca-one-card]");
      const railCard = document.querySelector(
        '[data-frame] [data-sidebar="sidebar"]',
      );
      if (!one || !railCard) return null;
      const probe = document.createElement("div");
      probe.style.backgroundColor = "hsl(var(--mn-surface))";
      one.appendChild(probe);
      const surface = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        bg: getComputedStyle(one).backgroundColor,
        rail: getComputedStyle(railCard).backgroundColor,
        surface,
      };
    });
    console.log(`[slate one card ${frame}] ${JSON.stringify(paint)}`);
    expect(paint?.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(paint?.bg).toBe(paint?.surface);
    expect(paint?.rail).toBe("rgba(0, 0, 0, 0)");
  });
}

// ── Appearance without the two tiles ────────────────────────────────────

test("flag on: Appearance has no Obsidian or Crystalline tile, in any mode", async ({
  page,
}) => {
  await fakeTauri(page);
  await installMockBridge(page);
  await seedProfile(page, { theme: "vitesse-black", shellFrame: true });
  await openAppearance(page);
  const seen: Record<string, string[]> = {};
  for (const mode of ["system", "light", "dark"] as const) {
    await page.getByTestId(`appearance-mode-${mode}`).click();
    await waitForAnimations(page);
    const ids = (await tileIds(page)).filter((id): id is string => !!id);
    seen[mode] = ids;
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.some((id) => /obsidian|crystalline/.test(id))).toBe(false);
  }
  console.log(
    `[tiles flag on] ${JSON.stringify(Object.fromEntries(Object.entries(seen).map(([m, ids]) => [m, ids.length])))}`,
  );
  // The other palettes stay: Paper and Graphite among them.
  expect(seen.light).toContain("theme-option-paper");
  expect(seen.dark).toContain("theme-option-graphite");
  await page.getByTestId("appearance-mode-dark").click();
  await shoot(page, "tiles-flag-on-dark");
  await page.getByTestId("appearance-mode-light").click();
  await shoot(page, "tiles-flag-on-light");
});

test("flag off: both tiles are there and selectable", async ({ page }) => {
  await installMockBridge(page);
  await seedProfile(page, { theme: "vitesse-black", shellFrame: false });
  await openAppearance(page);
  await page.getByTestId("appearance-mode-system").click();
  await expect(page.getByTestId("theme-pair-crystalline")).toBeVisible();
  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("theme-option-obsidian").click();
  await expect
    .poll(() => profile(page).then((p) => p.palette))
    .toBe("obsidian");
  await shoot(page, "tiles-flag-off-obsidian-chosen");
  await page.getByTestId("appearance-mode-light").click();
  await page.getByTestId("theme-option-crystalline").click();
  await expect
    .poll(() => profile(page).then((p) => p.palette))
    .toBe("crystalline");
  await shoot(page, "tiles-flag-off-crystalline-chosen");
  // Choosing one with the flag off moves nothing.
  expect((await profile(page)).move).toBeNull();
});

// ── glass-floor.css stands down under the flag ──────────────────────────

/** Every glass-floor rule for the forced glass theme, and how many elements
 *  it reaches, with the root forced to that theme. */
const glassFloorReach = (page: Page, theme: string) =>
  page.evaluate((name) => {
    const root = document.documentElement;
    root.setAttribute("data-luca-theme", name);
    let rules = 0;
    let reaching = 0;
    let elements = 0;
    const visit = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSStyleRule) {
          if (!rule.selectorText.includes("data-luca-native")) continue;
          if (!rule.selectorText.includes(`data-luca-theme="${name}"`))
            continue;
          rules += 1;
          // Pseudo-elements can't be queried: their host element is.
          const selector = rule.selectorText.replace(/::(before|after)/g, "");
          const count = document.querySelectorAll(selector).length;
          if (count > 0) reaching += 1;
          elements += count;
        } else if ("cssRules" in rule) {
          visit((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules);
      } catch {
        // cross-origin sheet: not ours
      }
    }
    const layer = document.querySelector(".luca-theme-shell-layer");
    const card = document.querySelector("[data-luca-card]");
    return {
      rules,
      reaching,
      elements,
      layer: layer ? getComputedStyle(layer).backgroundColor : null,
      card: card ? getComputedStyle(card).backgroundColor : null,
      body: getComputedStyle(document.body).backgroundColor,
    };
  }, theme);

for (const theme of ["obsidian", "crystalline"]) {
  test(`glass-floor.css stands down under the flag: ${theme}`, async ({
    browser,
  }) => {
    const reach: Record<
      string,
      Awaited<ReturnType<typeof glassFloorReach>>
    > = {};
    for (const on of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await fakeTauri(page);
      await installMockBridge(page);
      await seedProfile(page, {
        theme: on ? "vitesse-black" : theme,
        shellFrame: on,
      });
      await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .locator("[data-luca-card]")
        .first()
        .waitFor({ timeout: 20_000 });
      await waitForAnimations(page);
      expect(
        await page.evaluate(() =>
          document.documentElement.hasAttribute("data-luca-native"),
        ),
      ).toBe(true);
      reach[on ? "on" : "off"] = await glassFloorReach(page, theme);
      await context.close();
    }
    console.log(`[glass-floor ${theme}] ${JSON.stringify(reach)}`);
    expect(reach.off.rules).toBeGreaterThan(20);
    expect(reach.off.reaching).toBeGreaterThan(5);
    expect(reach.on.rules).toBe(reach.off.rules);
    expect(reach.on.reaching).toBe(0);
    expect(reach.on.elements).toBe(0);
  });
}

// ── the flag off, by hash against the base ───────────────────────────────

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

for (const view of [
  {
    name: "obsidian-appearance",
    theme: "obsidian",
    tauri: false,
    route: "/#/settings?section=appearance",
    ready: (page: Page) => page.getByTestId("settings-theme"),
  },
  {
    name: "crystalline-appearance",
    theme: "crystalline",
    tauri: false,
    route: "/#/settings?section=appearance",
    ready: (page: Page) => page.getByTestId("settings-theme"),
  },
  {
    name: "obsidian-conversation-tauri",
    theme: "obsidian",
    tauri: true,
    route: `/#/channels/${GENERAL_CHANNEL_ID}`,
    ready: (page: Page) => page.getByText("Hey team — checking in."),
  },
  {
    name: "crystalline-conversation-tauri",
    theme: "crystalline",
    tauri: true,
    route: `/#/channels/${GENERAL_CHANNEL_ID}`,
    ready: (page: Page) => page.getByText("Hey team — checking in."),
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
      if (view.tauri) await fakeTauri(page);
      await installMockBridge(page);
      await page.addInitScript((theme) => {
        window.localStorage.setItem("buzz-theme", theme);
      }, view.theme);
      await flagOffAlways(page);
      await page.goto(`${origin}${view.route}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(view.ready(page).first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      await waitForAnimations(page);
      expect(
        await page.evaluate(() =>
          document.documentElement.getAttribute("data-luca-theme"),
        ),
      ).toBe(view.theme);
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
    console.log(`[hash ${view.name}] ours ${ours} base ${base}`);
    expect(ours).toBe(base);
  });
}
