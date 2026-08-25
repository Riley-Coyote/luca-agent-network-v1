import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

test("Graphite is selectable and paints the approved charcoal shell", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz-theme", "buzz-dark");
    window.localStorage.setItem("buzz-follow-system", "false");
  });
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("appearance-mode-dark").click();

  const tile = page.getByTestId("theme-option-graphite");
  await expect(tile.getByText("Graphite", { exact: true })).toBeVisible();
  await tile.click();

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("graphite");
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-theme",
    "graphite",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const styles = getComputedStyle(document.documentElement);
        return {
          floor: styles.getPropertyValue("--mn-floor").trim(),
          surface: styles.getPropertyValue("--mn-surface").trim(),
          raised: styles.getPropertyValue("--mn-raised").trim(),
          hover: styles.getPropertyValue("--mn-hover").trim(),
          muted: styles.getPropertyValue("--mn-ink-muted").trim(),
        };
      }),
    )
    .toEqual({
      floor: "240.0 7.14% 5.5%",
      surface: "240.0 5.88% 6.7%",
      raised: "240.0 4.55% 8.6%",
      hover: "240.0 5.88% 10.0%",
      // The AA lift: Graphite's secondary ink was raised to #9d9da2 so meta
      // text clears 4.5:1 on the raised surface (see GRAPHITE_THEME_COLORS).
      muted: "240.0 2.62% 62.5%",
    });
  await expect(page.getByTestId("accent-color-neutral")).toHaveCount(0);

  await waitForAnimations(page);
  await tile.screenshot({
    path: testInfo.outputPath("graphite-theme-tile.png"),
  });

  await page.getByTestId("settings-back-to-app").click();
  // The Luca personal home has no seeded #general channel — the shell lands
  // on the home view, whose rail and content surface carry the same palette
  // the channel view does. Assert the shell where it stands.
  const railPlate = page.locator('[data-sidebar="sidebar"]').first();
  await expect(railPlate).toHaveCSS("background-color", "rgb(13, 13, 15)");
  await expect(page.locator("[data-buzz-content-surface]")).toHaveCSS(
    "background-color",
    "rgb(16, 16, 18)",
  );
  // Floor continuity: the rail and the ground the card sits on are one
  // surface — both resolve from --mn-floor through a single token path.
  const insetBg = await page
    .locator("[data-buzz-glass-inset]")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect(railPlate).toHaveCSS("background-color", insetBg);

  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("graphite-app-shell.png"),
    fullPage: true,
  });
});
