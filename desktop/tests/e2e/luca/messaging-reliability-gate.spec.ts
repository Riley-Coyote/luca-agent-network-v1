import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

async function sentChannelMessages(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
      (entry) => entry.command === "send_channel_message",
    ),
  );
}

test("repeated project-room sends clear once and stay bound without duplicates", async ({
  page,
}) => {
  await installMockBridge(page, { sendMessageDelayMs: 75 });
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-luca").click();
  await page
    .getByTestId("project-room-navigator")
    .getByRole("button", { name: /engineering/i })
    .click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");

  const channelId = page.url().match(/#\/channels\/([^/?#]+)/)?.[1];
  if (!channelId) throw new Error("Expected a project-room channel route.");

  const input = page.getByTestId("message-input");
  const messages = [
    `project-repeat-one-${Date.now()}`,
    `project-repeat-two-${Date.now()}`,
  ];

  for (const [index, content] of messages.entries()) {
    await input.fill(content);
    await page.getByTestId("send-message").click();

    await expect(input).toHaveText("");
    await expect(
      page.getByTestId("message-row").filter({ hasText: content }),
    ).toHaveCount(1);
    await expect
      .poll(async () => (await sentChannelMessages(page)).length)
      .toBe(index + 1);
  }

  const sends = await sentChannelMessages(page);
  expect(sends).toHaveLength(2);
  for (const send of sends) {
    expect(send.payload).toMatchObject({ channelId });
  }
  await expect(page.getByTestId("message-timeline")).not.toContainText(
    "No response arrived",
  );
});
