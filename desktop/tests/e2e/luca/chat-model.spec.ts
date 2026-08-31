import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

const AGENT =
  "8a6b5c4d3e2f109876543210abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const CHAT_ID_PATTERN = /\/channels\/([0-9a-f-]{36})/;

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: AGENT,
        name: "Maya",
        status: "running",
        channelIds: ["94a444a4-c0a3-5966-ab05-530c6ddc2301"],
      },
    ],
  });
});

test("Agent and Project collections reference one canonical Chat", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId(`agent-row-${AGENT}`)).toBeVisible();

  await page.getByTestId("open-projects-view").click();
  await page.getByTestId("create-project").click();
  await page.getByLabel("Name").fill("Atlas");
  await page
    .getByLabel("Instructions")
    .fill("Use primary sources for this project.");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("luca-collection-panel")).toContainText(
    "Atlas",
  );
  await expect(page).toHaveURL(/collection=project.*collectionId=/);
  const projectRowTestId = await page
    .locator('[data-testid^="project-row-"]')
    .filter({ hasText: "Atlas" })
    .getAttribute("data-testid");
  const projectId = projectRowTestId?.replace("project-row-", "") ?? null;
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/);

  await page
    .getByTestId("luca-collection-panel")
    .getByRole("button", { name: "New chat" })
    .click();
  await page.getByTestId("new-dm-search").fill("Maya");
  await page.getByTestId(`new-dm-result-${AGENT}`).click();
  await page
    .getByTestId("message-input")
    .fill("Research the current landscape and report back here.");
  await page.getByTestId("send-message").click();
  await expect(page).toHaveURL(CHAT_ID_PATTERN);
  const chatRowTestId = await page
    .getByTestId("luca-collection-panel")
    .locator('[data-testid^="collection-chat-"]')
    .getAttribute("data-testid");
  const chatId = chatRowTestId?.replace("collection-chat-", "");
  expect(chatId).toMatch(/^[0-9a-f-]{36}$/);
  if (!chatId || !projectId) throw new Error("Expected canonical IDs.");

  await expect(page.getByTestId(`collection-chat-${chatId}`)).toBeVisible();
  await page.getByTestId(`agent-row-${AGENT}`).click();
  await expect(page).toHaveURL(
    new RegExp(`collection=agent.*collectionId=${AGENT}`),
  );
  await expect(page.getByTestId(`collection-chat-${chatId}`)).toContainText(
    "Atlas",
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/luca-chat-model/wide-agent-collection.png",
  });

  await page.getByTestId(`project-row-${projectId}`).click();
  await expect(page).toHaveURL(
    new RegExp(`collection=project.*collectionId=${projectId}`),
  );
  await expect(page.getByTestId(`collection-chat-${chatId}`)).toBeVisible();
  await page.getByTestId(`collection-chat-${chatId}`).click();
  await expect(page).toHaveURL(new RegExp(`/channels/${chatId}`));
  await expect(page.getByTestId("luca-collection-panel")).toBeVisible();

  await page.locator(`[data-channel-id="${chatId}"]`).click();
  await expect(page.getByTestId("luca-collection-panel")).toHaveCount(0);
});

test("two Chats may have identical participants and membership mutates in place", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId(`agent-row-${AGENT}`)).toBeVisible();
  const result = await page.evaluate(
    async ({ agent, visitor }) => {
      const invoke = (
        window as unknown as {
          __BUZZ_E2E_INVOKE_MOCK_COMMAND__: (
            command: string,
            args?: unknown,
          ) => Promise<unknown>;
        }
      ).__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const first = (await invoke("create_chat", {
        input: { participantPubkeys: [agent], title: "First" },
      })) as { chat: { id: string } };
      const second = (await invoke("create_chat", {
        input: { participantPubkeys: [agent], title: "Second" },
      })) as { chat: { id: string } };
      await invoke("add_channel_members", {
        channelId: first.chat.id,
        pubkeys: [visitor],
        role: "guest",
      });
      const channels = (await invoke("get_channels")) as Array<{
        id: string;
        member_pubkeys: string[];
      }>;
      return {
        firstId: first.chat.id,
        secondId: second.chat.id,
        count: channels.filter(
          (channel) =>
            channel.id === first.chat.id || channel.id === second.chat.id,
        ).length,
        firstMembers:
          channels.find((channel) => channel.id === first.chat.id)
            ?.member_pubkeys ?? [],
      };
    },
    { agent: AGENT, visitor: TEST_IDENTITIES.outsider.pubkey },
  );

  expect(result.firstId).not.toBe(result.secondId);
  expect(result.count).toBe(2);
  expect(result.firstMembers).toContain(TEST_IDENTITIES.outsider.pubkey);
});

test("narrow collection navigation becomes a full-width stacked step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByTestId(`agent-row-${AGENT}`).click();
  await expect(page).toHaveURL(/\/agents\?collection=agent/);
  const panel = page.getByTestId("luca-collection-panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(620);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/luca-chat-model/narrow-agent-collection.png",
  });
});
