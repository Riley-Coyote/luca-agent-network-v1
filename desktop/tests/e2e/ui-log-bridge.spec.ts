import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Console output reaches the app log.
 *
 * The tee is additive: `console.error` still prints, and the same text is also
 * pushed at `append_ui_log`. The mock bridge records every such call, which is
 * what lets a spec see the second half happen.
 */
test.describe("ui log bridge", () => {
  test("console.error is teed into append_ui_log", async ({ page }) => {
    await installMockBridge(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 15_000,
    });

    await page.evaluate(() => {
      const error = new Error("nope");
      console.error("spec-probe: relay refused", error);
    });

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__BUZZ_E2E_UI_LOG__?.filter((line) =>
                line.message.includes("spec-probe"),
              ).length ?? 0,
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    const line = await page.evaluate(() =>
      window.__BUZZ_E2E_UI_LOG__?.find((entry) =>
        entry.message.includes("spec-probe"),
      ),
    );
    expect(line?.level).toBe("error");
    expect(line?.source).toBe("console.error");
    expect(line?.message).toContain("relay refused");
    expect(line?.message).toContain("Error: nope");

    // console.error still prints — the tee never swallows the original.
    const printed: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        printed.push(message.text());
      }
    });
    await page.evaluate(() => console.error("spec-probe: still prints"));
    await expect
      .poll(
        () => printed.filter((text) => text.includes("still prints")).length,
      )
      .toBeGreaterThan(0);
  });

  test("console.warn is teed at warn level", async ({ page }) => {
    await installMockBridge(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 15_000,
    });

    await page.evaluate(() => console.warn("spec-probe: slow relay", 42));

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__BUZZ_E2E_UI_LOG__?.find((line) =>
                line.message.includes("spec-probe: slow relay"),
              ) ?? null,
          ),
        { timeout: 5_000 },
      )
      .not.toBeNull();

    const line = await page.evaluate(() =>
      window.__BUZZ_E2E_UI_LOG__?.find((entry) =>
        entry.message.includes("spec-probe: slow relay"),
      ),
    );
    expect(line?.level).toBe("warn");
    expect(line?.source).toBe("console.warn");
    expect(line?.message).toBe("spec-probe: slow relay 42");
  });
});
