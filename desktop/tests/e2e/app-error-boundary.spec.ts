import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * The crash boundary, against a real React render error.
 *
 * `E2eCrashProbe` throws once during the root render when `?crashProbe=1` is
 * set, then disarms — so "Reload this screen" has something real to recover
 * from rather than a boundary reset into the same exception.
 */
test.describe("crash boundary", () => {
  test("names the screen, recovers, and copies a report", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await installMockBridge(page);
    await page.goto("/?crashProbe=1", { waitUntil: "domcontentloaded" });

    const surface = page.getByTestId("app-error-boundary");
    await expect(surface).toBeVisible();
    await expect(surface).toContainText("Something broke here.");
    await expect(page.getByTestId("app-error-screen")).toContainText(
      "Polyphonic stopped rendering.",
    );

    // The error is also written to the app log, not just drawn on screen.
    const boundaryLines = await page.evaluate(
      () =>
        window.__BUZZ_E2E_UI_LOG__?.filter(
          (line) => line.source === "react.boundary",
        ) ?? [],
    );
    expect(boundaryLines.length).toBeGreaterThan(0);
    expect(boundaryLines[0]?.level).toBe("error");
    expect(boundaryLines[0]?.message).toContain("E2E crash probe");

    // "Copy report" carries the error, the build, and the recent log.
    await page.getByTestId("app-error-copy").click();
    await expect(page.getByTestId("app-error-copy")).toHaveText(
      "Report copied",
    );
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toContain("Polyphonic crash report");
    expect(report).toContain("E2E crash probe");
    expect(report).toMatch(/app version: \d+\.\d+\.\d+/);
    expect(report).toContain("--- recent log ---");

    // "Reload this screen" resets the boundary and the real app mounts.
    // Disarm first: the probe throws on every render by design (see
    // E2eCrashProbe), so a reset without this would land right back here.
    await page.evaluate(() => window.__BUZZ_E2E_DISARM_CRASH_PROBE__?.());
    await page.getByTestId("app-error-reload").click();
    await expect(surface).toBeHidden();
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 15_000,
    });
  });
});
