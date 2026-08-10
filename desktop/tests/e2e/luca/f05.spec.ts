import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const desktopViewport = { width: 1440, height: 900 };
const minimumViewport = { width: 767, height: 700 };

test("Luca renders an opaque dark shell at desktop and minimum supported widths", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize(desktopViewport);
  await installMockBridge(page);
  await page.goto("/");

  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("channel-general")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--mn-surface")
          .trim(),
      ),
    )
    .toBe("220 8% 2.1%");

  await expect(page.locator("html")).toHaveAttribute("data-buzz-sidebar", "");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("[data-luca-theme-shell-layer]")).toHaveCSS(
    "background-image",
    "none",
  );
  const resolveShellColor = async (token: string) =>
    page.evaluate((tokenName) => {
      const probe = document.createElement("div");
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue(tokenName)
        .trim();
      probe.style.backgroundColor = `hsl(${value})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    }, token);

  await expect(page.locator("[data-buzz-content-surface]")).toHaveCSS(
    "border-top-color",
    await resolveShellColor("--mn-border"),
  );

  const hoverChannel = page.getByTestId("channel-random");
  await hoverChannel.hover();
  await expect(hoverChannel).toHaveCSS(
    "background-color",
    "rgba(255, 255, 255, 0.06)",
  );

  await page.getByTestId("open-search").focus();
  await expect(page.getByTestId("open-search")).toHaveCSS(
    "outline-color",
    "rgb(97, 166, 250)",
  );

  await page.screenshot({
    path: testInfo.outputPath("luca-shell-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize(minimumViewport);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect(page.locator("[data-luca-theme-shell-layer]")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("luca-shell-minimum.png"),
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
});
