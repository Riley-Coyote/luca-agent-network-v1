import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const desktopViewport = { width: 1280, height: 760 };
const minimumViewport = { width: 767, height: 700 };

test("Luca navigation retains the personal conversation plane and hides deferred surfaces", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize(desktopViewport);
  await installMockBridge(page);
  await page.goto("/");

  const menu = page.getByTestId("sidebar-primary-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("open-chat-view")).toBeVisible();
  await expect(menu.getByTestId("open-agents-view")).toBeVisible();
  await expect(menu.getByTestId("open-activity-view")).toBeVisible();
  await expect(menu.getByTestId("open-brain-setup")).toBeDisabled();
  await expect(menu.getByTestId("open-brain-setup")).toHaveAttribute(
    "data-luca-availability",
    "future",
  );
  await expect(menu.getByTestId("open-settings-view")).toBeVisible();

  for (const deferredLabel of ["Inbox", "Projects", "Workflows", "Pulse"]) {
    await expect(menu.getByText(deferredLabel, { exact: true })).toHaveCount(0);
  }

  await expect(menu.getByTestId("open-chat-view")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("channel-general")).toBeVisible();
  await expect(page.getByTestId("dm-list")).toBeVisible();

  await menu.getByTestId("open-agents-view").focus();
  await expect(menu.getByTestId("open-agents-view")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/agents$/);
  await expect(menu.getByTestId("open-agents-view")).toHaveAttribute(
    "data-active",
    "true",
  );

  await menu.getByTestId("open-activity-view").click();
  await expect(page).toHaveURL(/\/pulse$/);
  await expect(menu.getByTestId("open-activity-view")).toHaveAttribute(
    "data-active",
    "true",
  );

  await page.setViewportSize(minimumViewport);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  expect(consoleErrors).toEqual([]);
});
