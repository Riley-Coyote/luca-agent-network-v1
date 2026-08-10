import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("Polyphonic opens with a quiet threshold before the setup assistant", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?e2e=mock&polyphonicOnboardingPreview=threshold");

  const preview = page.getByTestId("polyphonic-onboarding-preview");
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
  await expect(page.getByTestId("polyphonic-onboarding-begin")).toBeVisible();
  await expect(page.getByText("Step 1 of 5", { exact: false })).toHaveCount(0);

  const baselineCommands = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_E2E_COMMANDS__?: string[];
        }
      ).__BUZZ_E2E_COMMANDS__ ?? [],
  );

  await page.getByTestId("polyphonic-onboarding-begin").click();
  await expect(preview).toContainText("Step 2 of 5: You");
  await expect(
    page.getByRole("heading", { name: "Make Polyphonic yours" }),
  ).toBeFocused();

  await page.getByTestId("polyphonic-owner-name").fill("Riley Coyote");
  await page
    .getByRole("button", { name: "Choose Polyphonic identity mark 2" })
    .click();
  await page.getByTestId("polyphonic-setup-continue").click();

  await expect(preview).toContainText("Step 3 of 5: Your agents");
  await expect(
    page.getByRole("heading", { name: "Bring your agents together" }),
  ).toBeFocused();
  await page.getByTestId("polyphonic-add-agent").click();
  await expect(page.getByText("Studio", { exact: true })).toBeVisible();
  await page.getByTestId("polyphonic-setup-continue").click();

  await expect(preview).toContainText("Step 4 of 5: Your Brain");
  await page.getByRole("button", { name: "Include Codex" }).click();
  await page.getByTestId("polyphonic-add-source").click();
  await expect(page.getByText("Files", { exact: true })).toBeVisible();
  await page.getByTestId("polyphonic-setup-continue").click();

  await expect(preview).toContainText("Step 5 of 5: Ready");
  await expect(preview).toContainText("Riley Coyote");
  await expect(preview).toContainText("3 ready to work");
  await expect(preview).toContainText("3 source groups included");
  await expect(page.getByTestId("polyphonic-setup-continue")).toContainText(
    "Enter Polyphonic",
  );

  const commands = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_E2E_COMMANDS__?: string[];
        }
      ).__BUZZ_E2E_COMMANDS__ ?? [],
  );
  const previewCommands = commands.slice(baselineCommands.length);
  expect(
    previewCommands.filter((command) =>
      /brain|resident|agent|connect|import|grant|create|update|set|write/i.test(
        command,
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("setup remains navigable at compact Mac window sizes and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1164, height: 657 });
  await page.goto("/?e2e=mock&polyphonicOnboardingPreview=threshold");
  await waitForAnimations(page);
  await expect(page.getByTestId("polyphonic-onboarding-begin")).toBeVisible();

  await page.getByTestId("polyphonic-onboarding-begin").click();
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeVisible();
  await page.getByTestId("polyphonic-owner-name").fill("A saved name");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
  await page.getByTestId("polyphonic-onboarding-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toHaveValue(
    "A saved name",
  );

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=mock&polyphonicOnboardingPreview=agents");
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
