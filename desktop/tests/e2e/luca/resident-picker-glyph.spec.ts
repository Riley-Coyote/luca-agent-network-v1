import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

test("resident picker honors the selected glyph identity", async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        pubkey: TEST_IDENTITIES.alice.pubkey,
        status: "running",
        channelNames: ["general"],
      },
    ],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("chat-mark-style-glyph").click();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const resident = page.getByTestId(
    `new-dm-result-${TEST_IDENTITIES.alice.pubkey}`,
  );
  await expect(resident).toBeVisible();
  await expect(
    resident.locator('[data-resident-mark-kind="glyph"]'),
  ).toHaveCount(1);
  await expect(resident.locator(".agent-character")).toHaveCount(0);
});
