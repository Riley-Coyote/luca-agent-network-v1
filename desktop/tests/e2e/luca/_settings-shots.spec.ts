/**
 * Harness tool, not a CI spec (underscore-prefixed; not in the smoke
 * testMatch). Captures the Settings shell per theme for eye review —
 * the shell lab cannot stage Settings. Run against a `build:e2e` build:
 *   pnpm exec playwright test tests/e2e/luca/_settings-shots.spec.ts
 */
import { test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";

for (const theme of ["buzz-dark", "paper", "vitesse-dark"]) {
  test(`settings shell in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => {
      window.localStorage.setItem("buzz-theme", t);
      window.localStorage.setItem("buzz-follow-system", "false");
    }, theme);
    await installMockBridge(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("open-settings").click();
    await page.getByTestId("profile-popover-settings").click();
    await page.getByTestId("settings-nav-appearance").click();
    await page.waitForTimeout(900);
    await page.screenshot({
      path: `test-results/settings-shots/${theme}.png`,
    });
  });
}
