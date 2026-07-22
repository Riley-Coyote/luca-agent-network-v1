import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

test.use({ viewport: { width: 900, height: 700 } });

test("F06: single-owner setup protects key material and makes recovery limits explicit", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await installMockBridge(page, undefined, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "Create owner identity" }),
  ).toBeVisible();
  await expect(page.getByText("A private home for the agents")).toBeVisible();
  await page.getByRole("button", { name: "Create owner identity" }).click();

  const disclosure = page.getByTestId("onboarding-recovery-disclosure");
  await expect(disclosure).toBeVisible();
  await expect(page.getByTestId("onboarding-page-backup")).toContainText(
    "cryptographic identity",
  );
  await expect(page.getByTestId("onboarding-page-backup")).toContainText(
    "never shown or copied during setup",
  );
  await expect(disclosure).toContainText(
    "Protected recovery is not available yet",
  );
  await expect(
    page.getByTestId("onboarding-protected-export-unavailable"),
  ).toBeDisabled();
  await expect(page.getByTestId("nsec-value")).toHaveCount(0);
  await expect(page.getByTestId("nsec-copy")).toHaveCount(0);
  await expect(page.getByTestId("nsec-reveal-toggle")).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(consoleErrors).toEqual([]);

  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-page-2")).toBeVisible();
  await page.getByTestId("onboarding-setup-next").click();
  await expect(page.getByTestId("onboarding-page-config")).toBeVisible();
  await expect(
    page.getByText(
      "Your owner identity stays the same when you replace the runtime",
    ),
  ).toBeVisible();
});

test("F06: existing identity input stays masked", async ({ page }) => {
  await installMockBridge(page, undefined, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect an existing identity" })
    .click();

  const input = page.getByTestId("nostr-import-nsec-input");
  await expect(input).toHaveAttribute("type", "password");
  await expect(page.getByTestId("nostr-import-reveal-toggle")).toHaveCount(0);
});
