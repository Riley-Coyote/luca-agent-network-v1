import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

test.describe("reminders", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
  });

  test("02 — message action menu shows Remind me later", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");

    const messageRow = page.getByTestId("message-row").first();
    await messageRow.hover();

    const moreActionsButton = messageRow.getByRole("button", {
      name: "More actions",
    });
    await expect(moreActionsButton).toBeVisible();
    await moreActionsButton.click();

    const remindItem = page.getByRole("menuitem", {
      name: "Remind me later",
    });
    await expect(remindItem).toBeVisible();
    await waitForAnimations(page);
  });

  test("03 — Remind me later dialog with time presets", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");

    const messageRow = page.getByTestId("message-row").first();
    await messageRow.hover();

    const moreActionsButton = messageRow.getByRole("button", {
      name: "More actions",
    });
    await moreActionsButton.click();

    const remindItem = page.getByRole("menuitem", {
      name: "Remind me later",
    });
    await expect(remindItem).toBeVisible();
    await waitForAnimations(page);
    await remindItem.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Remind me later")).toBeVisible();
    await expect(dialog.getByText("In 30 minutes")).toBeVisible();
    await expect(dialog.getByText("Custom date & time")).toBeVisible();
    await waitForAnimations(page);
  });
});
