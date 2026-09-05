import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

async function captureFrame(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(450);
  await waitForAnimations(page);
  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  await page.screenshot({
    animations: "allow",
    path: evidenceDirectory
      ? `${evidenceDirectory}/${name}.png`
      : testInfo.outputPath(`${name}.png`),
  });
}

test("Activity stays stable while Search preserves focus and keyboard continuity", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await installMockBridge(page, undefined, { seedPreviewFeatures: false });
  await page.goto("/?e2e=mock");

  await page.getByTestId("open-activity-view").click();
  await expect(page).toHaveURL(/\/pulse$/);
  await expect(page.getByTestId("owner-activity-view")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText: "Pulse is a preview feature",
    }),
  ).toHaveCount(0);
  await captureFrame(page, testInfo, "01-activity-without-preview-warning");

  const trigger = page.getByTestId("open-search");
  await trigger.click();
  const dialog = page.getByTestId("search-results");
  const input = page.getByTestId("search-dialog-input");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await expect(
    dialog.getByText("Recent activity", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("Actions", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("search-result-action-create-channel"),
  ).toBeVisible();
  await captureFrame(page, testInfo, "02-search-recent-actions");
  const suggestionBounds = await dialog.boundingBox();

  await input.fill("general");
  await expect(input).toBeFocused();
  await expect(
    page.getByTestId(
      "search-result-channel-9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
    ),
  ).toBeVisible();
  await expect(dialog).toContainText("general");
  await waitForAnimations(page);
  const resultBounds = await dialog.boundingBox();
  expect(suggestionBounds).not.toBeNull();
  expect(resultBounds).not.toBeNull();
  expect(
    Math.abs((resultBounds?.x ?? 0) - (suggestionBounds?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((resultBounds?.y ?? 0) - (suggestionBounds?.y ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((resultBounds?.width ?? 0) - (suggestionBounds?.width ?? 0)),
  ).toBeLessThanOrEqual(1);
  await captureFrame(page, testInfo, "03-search-general-results");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test("Search honors reduced motion without losing input focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockBridge(page);
  await page.goto("/?e2e=mock");

  await page.getByTestId("open-search").click();
  await expect(page.getByTestId("search-dialog-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search-results")).toBeHidden();
  await expect(page.getByTestId("open-search")).toBeFocused();
});
