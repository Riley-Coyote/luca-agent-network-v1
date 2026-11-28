import { expect, test } from "@playwright/test";

import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";

const MOCK_PUBKEY = "deadbeef".repeat(8);
const ENGINEERING_CHANNEL_ID = "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9";
const MUTE_STORAGE_KEY = `buzz-channel-mutes.v1:${MOCK_PUBKEY}`;

function seedMuteState(
  page: import("@playwright/test").Page,
  channelId: string,
) {
  return page.addInitScript(
    ({ key, id }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          channels: {
            [id]: { muted: true, updatedAt: 1700000000 },
          },
        }),
      );
    },
    { key: MUTE_STORAGE_KEY, id: channelId },
  );
}

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  channelName: string,
) {
  await expect
    .poll(async () => {
      return page.evaluate(
        ({ ch }) =>
          (
            window as Window & {
              __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                channelName: string;
              }) => boolean;
            }
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName: ch }) ??
          false,
        { ch: channelName },
      );
    })
    .toBe(true);
}

test.describe("channel muting", () => {
  test("03 — muted channel with @mention shows unread dot", async ({
    page,
  }) => {
    await seedMuteState(page, ENGINEERING_CHANNEL_ID);
    await installMockBridge(page);

    await page.goto("/");
    await page.getByTestId("channel-engineering").click();
    await expect(page.getByTestId("chat-title")).toHaveText("engineering");
    await waitForMockLiveSubscription(page, "engineering");

    await page.getByTestId("channel-random").click();
    await expect(page.getByTestId("chat-title")).toHaveText("random");

    await page.evaluate(
      ({ pubkey, mockPubkey }) => {
        (
          window as Window & {
            __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
              channelName: string;
              content: string;
              pubkey: string;
              mentionPubkeys: string[];
            }) => unknown;
          }
        ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "engineering",
          content: "Hey check this out",
          pubkey,
          mentionPubkeys: [mockPubkey],
        });
      },
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        mockPubkey: MOCK_PUBKEY,
      },
    );

    await expect(page.getByTestId("channel-unread-engineering")).toBeVisible();
  });
});
