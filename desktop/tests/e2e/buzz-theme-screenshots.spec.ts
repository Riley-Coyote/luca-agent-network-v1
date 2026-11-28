import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/buzz-theme";
const THEME_STORAGE_KEY = "buzz-theme";

/**
 * Seed the active theme into localStorage BEFORE the mock bridge installs so
 * ThemeProvider reads it on first mount (init scripts run in registration
 * order; React reads state on mount, which the bridge triggers).
 */
async function seedTheme(page: Page, theme: string) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
}

async function openChannel(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

async function expectBuzzGradientPaint(
  page: Page,
  mode: "light" | "dark",
): Promise<string> {
  const paint = await page.evaluate(() => {
    const root = document.documentElement;
    const appSurface = document.querySelector(".buzz-huddle-app-surface");
    const lightLayer = document.querySelector('[data-buzz-gradient="light"]');
    const darkLayer = document.querySelector('[data-buzz-gradient="dark"]');
    const sidebarRoot = document.querySelector(
      '[data-testid="app-sidebar"], [data-testid="settings-sidebar"]',
    );
    const sidebarSurface =
      sidebarRoot?.querySelector('[data-sidebar="sidebar"]') ?? sidebarRoot;
    const appStyles = appSurface ? getComputedStyle(appSurface) : null;
    const lightStyles = lightLayer ? getComputedStyle(lightLayer) : null;
    const darkStyles = darkLayer ? getComputedStyle(darkLayer) : null;
    return {
      isDark: root.classList.contains("dark"),
      theme: root.getAttribute("data-buzz-theme"),
      surfaceImage: appStyles?.backgroundImage ?? "",
      lightImage: lightStyles?.backgroundImage ?? "",
      lightOpacity: lightStyles?.opacity ?? "",
      darkImage: darkStyles?.backgroundImage ?? "",
      darkOpacity: darkStyles?.opacity ?? "",
      sidebarImage: sidebarSurface
        ? getComputedStyle(sidebarSurface).backgroundImage
        : "",
    };
  });

  expect(paint.theme).toBe(mode === "light" ? "buzz" : "buzz-dark");
  expect(paint.isDark).toBe(mode === "dark");
  expect(paint.surfaceImage).toBe("none");
  expect(paint.lightImage).not.toBe("");
  expect(paint.lightImage).not.toBe("none");
  expect(paint.darkImage).not.toBe("");
  expect(paint.darkImage).not.toBe("none");
  expect(paint.lightImage).not.toBe(paint.darkImage);
  expect(paint.lightOpacity).toBe(mode === "light" ? "1" : "0");
  expect(paint.darkOpacity).toBe(mode === "dark" ? "1" : "0");
  expect(paint.sidebarImage).toBe("none");
  return mode === "light" ? paint.lightImage : paint.darkImage;
}

async function expectAppliedBuzzTheme(
  page: Page,
  themeName: "buzz" | "buzz-dark",
  storedTheme: "buzz" | "buzz-dark" = themeName,
) {
  const isDark = themeName === "buzz-dark";
  await expect
    .poll(() =>
      page.evaluate((storageKey) => {
        const root = document.documentElement;
        const styles = getComputedStyle(root);
        return {
          storedTheme: window.localStorage.getItem(storageKey),
          isDark: root.classList.contains("dark"),
          buzzTheme: root.getAttribute("data-buzz-theme"),
          gradientTop: styles.getPropertyValue("--buzz-gradient-top").trim(),
          gradientBottom: styles
            .getPropertyValue("--buzz-gradient-bottom")
            .trim(),
        };
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      storedTheme,
      isDark,
      buzzTheme: themeName,
      gradientTop: isDark ? "#4a4616" : "#e6e6b6",
      gradientBottom: isDark ? "#0a1423" : "#c4d0da",
    });
}

async function emitNativeThemeChange(page: Page, theme: "light" | "dark") {
  await page.evaluate(async (nextTheme) => {
    const tauriWindow = window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke?: (
          command: string,
          payload?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    const invoke = tauriWindow.__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error("Mock Tauri invoke bridge is unavailable.");
    await invoke("plugin:event|emit", {
      event: "tauri://theme-changed",
      payload: nextTheme,
    });
  }, theme);
}

// The first-party Luca contract is a quiet dark shell and Paper light palette.
// theme-loader retains buzz/buzz-dark as dark compatibility keys; neither is
// the historical Buzz gradient. Assert the pixels painted from the live tokens.
async function expectAppliedLucaTheme(
  page: Page,
  theme: "paper" | "buzz-dark" | "buzz",
  storedTheme: "paper" | "buzz-dark" | "buzz" = theme,
) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        stored: localStorage.getItem("buzz-theme"),
        theme: document.documentElement.getAttribute("data-luca-theme"),
        dark: document.documentElement.classList.contains("dark"),
      })),
    )
    .toEqual({ stored: storedTheme, theme, dark: theme !== "paper" });
  await expect(page.locator("html")).toHaveAttribute("data-luca-shell", "");
  const paint = await page.evaluate(() => {
    const root = document.documentElement;
    const vars = getComputedStyle(root);
    const resolveColor = (value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      root.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const surface = document.querySelector(".buzz-huddle-app-surface");
    const sidebar = document.querySelector(
      '[data-testid="app-sidebar"], [data-testid="settings-sidebar"]',
    );
    const sidebarSurface =
      sidebar?.querySelector('[data-sidebar="sidebar"]') ?? sidebar;
    const paintedBackground = (
      element: Element | null | undefined,
    ): string | null => {
      let current = element;
      while (current) {
        const color = getComputedStyle(current).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)") return color;
        current = current.parentElement;
      }
      return null;
    };
    return {
      floor: resolveColor(`hsl(${vars.getPropertyValue("--mn-floor")})`),
      surfaceColor: surface ? getComputedStyle(surface).backgroundColor : null,
      surfaceImage: surface ? getComputedStyle(surface).backgroundImage : null,
      sidebarColor: paintedBackground(sidebarSurface),
      sidebarImage: sidebarSurface
        ? getComputedStyle(sidebarSurface).backgroundImage
        : null,
      legacyLayers: document.querySelectorAll("[data-buzz-gradient]").length,
    };
  });
  expect(paint.surfaceColor).toBe(paint.floor);
  expect(paint.sidebarColor).toBe(paint.floor);
  expect(paint.surfaceImage).toBe("none");
  expect(paint.sidebarImage).toBe("none");
  expect(paint.legacyLayers).toBe(0);
  return paint.floor;
}

test("Luca Paper light sidebar paint", async ({ page }) => {
  await seedTheme(page, "paper");
  await installMockBridge(page);
  await openChannel(page);
  await expectAppliedLucaTheme(page, "paper");
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/01-luca-paper.png` });
});

test("Luca dark sidebar paint", async ({ page }) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  await openChannel(page);
  await expectAppliedLucaTheme(page, "buzz-dark");
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/02-luca-dark.png` });
});

async function openAppearance(page: Page, mode: "system" | "light" | "dark") {
  // Settings renders at the AppShell level; open it via the profile card
  // button, then select the Appearance section.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  const panel = page.getByTestId("settings-theme");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(`appearance-mode-${mode}`).click();
  await waitForAnimations(page);
  return panel;
}

test("appearance picker — system tab (Buzz follows OS)", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page, "system");
  const voidTile = panel.getByTestId("theme-option-buzz-dark");
  await expect(voidTile).toBeVisible();
  await expect(voidTile.getByText("Void", { exact: true })).toBeVisible();
  await panel.screenshot({ path: `${SHOTS}/03-picker-system.png` });
});

test("appearance picker — light tab keeps Void dark-only", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page, "light");
  await expect(panel.getByText("Void", { exact: true })).toHaveCount(0);
  await panel.screenshot({ path: `${SHOTS}/04-picker-light.png` });
});

test("appearance picker — dark tab (Buzz Dark)", async ({ page }) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  const panel = await openAppearance(page, "dark");
  await expect(
    panel
      .getByTestId("theme-option-buzz-dark")
      .getByText("Void", { exact: true }),
  ).toBeVisible();
  await panel.screenshot({ path: `${SHOTS}/05-picker-dark.png` });
});

test("Void selects the first-party blackout palette from System mode", async ({
  page,
}) => {
  await seedTheme(page, "github-light-high-contrast");
  await installMockBridge(page);
  const panel = await openAppearance(page, "system");

  await panel.getByTestId("theme-option-buzz-dark").click();

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz-dark");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--mn-floor")
          .trim(),
      ),
    )
    .toBe("0 0% 0%");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.getAttribute("data-luca-theme"),
      ),
    )
    .toMatch(/^buzz(?:-dark)?$/);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);
});

test("appearance hides accent picker under Buzz", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page, "light");
  // The accent picker is hidden while a Buzz theme is active. Its neutral
  // swatch testid must not be present.
  await expect(page.getByTestId("accent-color-neutral")).toHaveCount(0);
  await panel.screenshot({ path: `${SHOTS}/10-appearance-no-accent.png` });
});

test("accent picker reveals/hides when toggling Buzz", async ({ page }) => {
  // Start on a non-Buzz theme so the accent picker is present, then select the
  // Buzz tile — the picker should animate out and unmount. Reselecting a
  // non-Buzz tile brings it back. Asserts the presence toggle (the motion
  // wrapper) works end to end.
  await seedTheme(page, "github-dark");
  await installMockBridge(page);
  await openAppearance(page, "dark");
  await expect(page.getByTestId("accent-color-neutral")).toBeVisible();

  // Switch to Buzz — picker should leave (allow the exit animation to settle).
  await page.getByTestId("theme-option-buzz-dark").click();
  await expect(page.getByTestId("accent-color-neutral")).toHaveCount(0);

  // Back to a non-Buzz theme — picker returns.
  await page.getByTestId("theme-option-github-dark").click();
  await expect(page.getByTestId("accent-color-neutral")).toBeVisible();
});

test("Luca light and dark modes apply live without a reload", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page, "light");
  await page.evaluate(() => {
    document.documentElement.dataset.themeContinuity = "same-document";
  });
  const light = await expectAppliedLucaTheme(page, "paper");
  await expect(page.getByTestId("theme-option-paper")).toBeVisible();
  await expect(page.getByTestId("thread-layout-trigger")).toHaveCount(0);
  await expect(page.getByText("Thread layout", { exact: true })).toHaveCount(0);
  await page.getByTestId("appearance-mode-dark").click();
  const dark = await expectAppliedLucaTheme(page, "buzz");
  expect(dark).not.toBe(light);
  await page.getByTestId("appearance-mode-light").click();
  expect(await expectAppliedLucaTheme(page, "paper")).toBe(light);
  // Preserve the stale async-load race guard as well as the same-document proof.
  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("appearance-mode-light").click();
  expect(await expectAppliedLucaTheme(page, "paper")).toBe(light);
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-continuity",
    "same-document",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/03-luca-live-light.png` });
});

test("Luca legacy dark alias switches to Light without a reload", async ({
  page,
}) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  await openAppearance(page, "dark");
  const dark = await expectAppliedLucaTheme(page, "buzz-dark");
  await page.evaluate(() => {
    document.documentElement.dataset.themeContinuity = "same-document";
  });

  await page.getByTestId("appearance-mode-light").click();
  const light = await expectAppliedLucaTheme(page, "paper");
  expect(light).not.toBe(dark);
  await expect(page.getByTestId("theme-option-paper")).toBeVisible();
  await page.getByTestId("appearance-mode-dark").click();
  await expectAppliedLucaTheme(page, "buzz");
  await page.getByTestId("appearance-mode-light").click();
  expect(await expectAppliedLucaTheme(page, "paper")).toBe(light);
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-continuity",
    "same-document",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/04-luca-alias-to-light.png` });
});

test("Luca legacy dark alias stays dark in System mode", async ({ page }) => {
  await seedTheme(page, "buzz-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await installMockBridge(page);
  await openAppearance(page, "system");
  await expectAppliedLucaTheme(page, "buzz", "buzz-dark");
  await page.evaluate(() => {
    document.documentElement.dataset.themeContinuity = "same-document";
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await expectAppliedLucaTheme(page, "buzz-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectAppliedLucaTheme(page, "buzz", "buzz-dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-continuity",
    "same-document",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/05-luca-alias-system-light.png` });
});

test("Buzz follows native system theme changes without a reload", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
  });
  await installMockBridge(page);
  await openAppearance(page, "system");

  await emitNativeThemeChange(page, "dark");
  await expectAppliedBuzzTheme(page, "buzz-dark", "buzz");
  await expectBuzzGradientPaint(page, "dark");

  await emitNativeThemeChange(page, "light");
  await expectAppliedBuzzTheme(page, "buzz", "buzz");
  await expectBuzzGradientPaint(page, "light");
});
