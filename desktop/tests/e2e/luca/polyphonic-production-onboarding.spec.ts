import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, undefined, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
});

async function beginFreshSetup(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
  await page.getByRole("button", { name: "Begin setup" }).click();
}

test("production onboarding resumes, navigates back, and completes fail-soft", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await beginFreshSetup(page);
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeFocused();
  await expect(page.getByText("Step 2 of 5", { exact: true })).toBeVisible();

  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Bring your agents together" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Display name")).toHaveValue("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Everything is in its place" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Enter Polyphonic" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("onboarding keeps its primary action reachable at 800 by 500", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await beginFreshSetup(page);
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeVisible();
  const box = await continueButton.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 500) + (box?.height ?? 0)).toBeLessThanOrEqual(500);
  await expect(page.locator("html")).not.toHaveCSS("overflow-x", "scroll");
});
