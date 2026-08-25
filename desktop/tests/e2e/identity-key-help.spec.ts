import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

test("existing identity path explains the first-run choice", async ({
  page,
}) => {
  await installMockBridge(page, undefined, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin setup" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use an existing identity" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Use an existing identity" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your owner identity" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "If you already have a compatible cryptographic identity, enter its private key to connect it to Polyphonic. It stays masked while you enter it.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("nostr-import-nsec-input")).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
});
