import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const MANAGED_AGENT_PUBKEY =
  "db0b028cd36f4d3e36c8300cce87252c1f7fc9495ffecc53f393fcac341ffd36";

async function openSearch(page: import("@playwright/test").Page) {
  await page.getByTestId("open-search").click();
  await expect(page.getByTestId("search-dialog-input")).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("search opens exact owner and managed-resident messages", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await openSearch(page);
  await page.getByTestId("search-dialog-input").fill("Welcome to #general");
  await page.getByTestId("search-result-mock-general-welcome").click();
  await expect(page).toHaveURL(
    new RegExp(
      `#/channels/${GENERAL_CHANNEL_ID}\\?messageId=mock-general-welcome$`,
    ),
  );
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Welcome to #general",
  );

  const residentEvent = await page.evaluate(
    ({ pubkey }) =>
      (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
            channelName: string;
            content: string;
            pubkey: string;
          }) => { id: string };
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "agents",
        content: "Resident search continuity proof",
        pubkey,
      }),
    { pubkey: MANAGED_AGENT_PUBKEY },
  );
  expect(residentEvent?.id).toBeTruthy();

  await openSearch(page);
  await page
    .getByTestId("search-dialog-input")
    .fill("Resident search continuity proof");
  await page.getByTestId(`search-result-${residentEvent?.id}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Resident search continuity proof",
  );
  await expect(page).toHaveURL(new RegExp(`thread=${residentEvent?.id}$`));
});

test("manual unread state survives reload and clears through existing read authority", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  await page.getByTestId("channel-random").click({ button: "right" });
  await page.getByText("Mark unread", { exact: true }).click();
  await expect(page.getByTestId("channel-unread-random")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("channel-unread-random")).toBeVisible();

  await page.getByTestId("channel-random").click({ button: "right" });
  await page.getByText("Mark as read", { exact: true }).click();
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
});

test("canonical message links open the exact thread and survive reload", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Welcome to #general",
  );
  const link = `buzz://message?channel=${GENERAL_CHANNEL_ID}&id=mock-general-welcome`;

  await page.getByTestId("message-input").fill(`Canonical link ${link}`);
  await page.getByTestId("send-message").click();
  const linkMessage = page
    .getByTestId("message-row")
    .filter({ hasText: "Canonical link" })
    .last();
  await linkMessage
    .getByRole("button", { name: "Open message in general" })
    .click();

  await expect(page).toHaveURL(/thread=mock-general-welcome/);
  await expect(page.getByTestId("focused-thread-bar")).toBeVisible();
  await expect(
    page.locator('[data-message-id="mock-general-welcome"]'),
  ).toContainText("Welcome to #general");

  await page.reload();
  await expect(page).toHaveURL(/thread=mock-general-welcome/);
  await expect(page.getByTestId("focused-thread-bar")).toBeVisible();
  await expect(
    page.locator('[data-message-id="mock-general-welcome"]'),
  ).toContainText("Welcome to #general");
});
