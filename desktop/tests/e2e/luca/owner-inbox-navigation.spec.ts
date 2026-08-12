import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("the owner Inbox is visible, badge-backed, and restart-stable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const inboxButton = page.getByTestId("open-inbox-view");
  await expect(inboxButton).toBeVisible();
  await expect(inboxButton).toContainText("Inbox");

  await page.evaluate(
    ({ ownerPubkey, senderPubkey }) => {
      window.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?.({
        category: "mention",
        channel_id: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        channel_name: "general",
        content: "Owner Inbox navigation proof",
        created_at: Math.floor(Date.now() / 1_000) + 5,
        id: "mock-owner-inbox-navigation",
        kind: 9,
        pubkey: senderPubkey,
        tags: [["p", ownerPubkey]],
      });
    },
    {
      ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
      senderPubkey: TEST_IDENTITIES.alice.pubkey,
    },
  );

  await expect(page.getByTestId("sidebar-home-count")).toHaveText("1");
  await inboxButton.click();
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await expect(inboxButton).toHaveAttribute("data-active", "true");

  await page.reload();
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await expect(page.getByTestId("open-inbox-view")).toHaveAttribute(
    "data-active",
    "true",
  );
});
