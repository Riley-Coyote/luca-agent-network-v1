import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/buzz-theme";
const THEME_STORAGE_KEY = "buzz-theme";
const MOCK_PUBKEY = "deadbeef".repeat(8);
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

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

async function seedIconChannelSection(page: Page) {
  await page.addInitScript(
    ({ channelId, pubkey }) => {
      window.localStorage.setItem(
        `buzz-channel-sections.v1:${pubkey}`,
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "alignment-section",
              name: "Team channels",
              icon: "📌",
              order: 0,
            },
          ],
          assignments: { [channelId]: "alignment-section" },
        }),
      );
    },
    { channelId: GENERAL_CHANNEL_ID, pubkey: MOCK_PUBKEY },
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

async function expectBuzzSettingsPalette(page: Page, mode: "light" | "dark") {
  const mutedColor =
    mode === "light" ? "rgba(0, 0, 0, 0.4)" : "rgba(255, 255, 255, 0.4)";
  const sidebar = page.getByTestId("settings-sidebar");
  const sectionLabel = sidebar
    .locator('[data-sidebar="group-label"]')
    .filter({ hasText: "Personal" });

  await expect(sectionLabel).toHaveCSS("color", mutedColor);
  await expect(page.getByTestId("settings-nav-profile")).not.toHaveCSS(
    "color",
    mutedColor,
  );

  await expectBuzzGradientPaint(page, mode);

  const version = page.getByTestId("settings-version");
  if ((await version.count()) > 0) {
    await expect(version).toHaveCSS("color", mutedColor);
  }
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
) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        stored: localStorage.getItem("buzz-theme"),
        theme: document.documentElement.getAttribute("data-luca-theme"),
        dark: document.documentElement.classList.contains("dark"),
      })),
    )
    .toEqual({ stored: theme, theme, dark: theme !== "paper" });
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

test("custom section icon and name align with channel columns", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await seedIconChannelSection(page);
  await installMockBridge(page);
  await openChannel(page);

  const sectionIconBox = await page
    .getByTestId("section-icon-alignment-section")
    .boundingBox();
  const sectionTitleBox = await page
    .getByTestId("section-title-alignment-section")
    .boundingBox();
  const channelButton = page.getByTestId("channel-general");
  const channelIconBox = await channelButton
    .locator("svg")
    .first()
    .boundingBox();
  const channelTitleBox = await channelButton
    .locator("[data-sidebar-row-label]")
    .boundingBox();

  expect(sectionIconBox).not.toBeNull();
  expect(sectionTitleBox).not.toBeNull();
  expect(channelIconBox).not.toBeNull();
  expect(channelTitleBox).not.toBeNull();
  if (
    !sectionIconBox ||
    !sectionTitleBox ||
    !channelIconBox ||
    !channelTitleBox
  ) {
    throw new Error("Custom section alignment geometry is missing");
  }
  expect(Math.abs(sectionIconBox.x - channelIconBox.x)).toBeLessThanOrEqual(
    0.5,
  );
  expect(Math.abs(sectionTitleBox.x - channelTitleBox.x)).toBeLessThanOrEqual(
    0.5,
  );
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

test("settings nav uses Buzz active pill + hover (light)", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  const sidebar = page.getByTestId("settings-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 10_000 });
  const profileRow = page.getByTestId("settings-nav-profile");
  const profileLabel = profileRow.locator('[data-sidebar="menu-label"]');
  await expect(profileRow).toHaveAttribute("data-active", "true");
  await expect(profileRow).toHaveCSS("font-weight", "600");
  const selectedLabelBox = await profileLabel.boundingBox();
  // Appearance is the active section here; its nav row should carry the Buzz
  // white active pill (data-active=true), matching the Left Nav treatment.
  await page.getByTestId("settings-nav-appearance").click();
  await expect(profileRow).toHaveCSS("font-weight", "400");
  const unselectedLabelBox = await profileLabel.boundingBox();
  expect(selectedLabelBox).not.toBeNull();
  expect(unselectedLabelBox).not.toBeNull();
  if (!selectedLabelBox || !unselectedLabelBox) {
    throw new Error("Settings nav label geometry is missing");
  }
  expect(Math.abs(selectedLabelBox.width - unselectedLabelBox.width)).toBe(0);
  await expectBuzzSettingsPalette(page, "light");
  const activeRow = page.getByTestId("settings-nav-appearance");
  await expect(activeRow).toHaveAttribute("data-active", "true");
  await waitForAnimations(page);
  await sidebar.screenshot({ path: `${SHOTS}/06-settings-nav-light.png` });
});

test("settings nav uses Buzz active pill + hover (dark)", async ({ page }) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  const sidebar = page.getByTestId("settings-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("settings-nav-appearance").click();
  await expectBuzzSettingsPalette(page, "dark");
  await expect(page.getByTestId("settings-content-surface")).toHaveCSS(
    "background-color",
    "rgb(26, 26, 26)",
  );
  await waitForAnimations(page);
  await sidebar.screenshot({ path: `${SHOTS}/07-settings-nav-dark.png` });
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/09-settings-content-dark.png`,
  });
});

test("settings content uses the same inset surface as the main app", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const searchBox = await page.getByTestId("open-search").boundingBox();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();

  const settingsView = page.getByTestId("settings-view");
  const contentSurface = page.getByTestId("settings-content-surface");
  const backToAppBox = await page
    .getByTestId("settings-back-to-app")
    .boundingBox();
  await expect(contentSurface).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("settings-content-scroll")).toHaveCSS(
    "padding-top",
    "24px",
  );

  const viewBox = await settingsView.boundingBox();
  const surfaceBox = await contentSurface.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(backToAppBox).not.toBeNull();
  expect(viewBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  if (!searchBox || !backToAppBox || !viewBox || !surfaceBox) {
    throw new Error("Settings layout is missing");
  }

  expect(Math.abs(backToAppBox.y - searchBox.y)).toBeLessThanOrEqual(0.5);

  // Match the normal app shell: a fixed 40px top chrome strip, then a 1px
  // top/left inset and 8px right/bottom inset around the rounded content card.
  expect(surfaceBox.y - viewBox.y).toBe(41);
  expect(surfaceBox.x - viewBox.x).toBe(1);
  expect(viewBox.x + viewBox.width - (surfaceBox.x + surfaceBox.width)).toBe(8);
  expect(viewBox.y + viewBox.height - (surfaceBox.y + surfaceBox.height)).toBe(
    8,
  );

  await waitForAnimations(page);
  await settingsView.screenshot({
    path: `${SHOTS}/08-settings-content-inset.png`,
  });
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
