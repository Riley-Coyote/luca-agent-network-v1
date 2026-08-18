import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

/**
 * Product decision (owner, 2026-08-18): the Inbox is disabled. Every resident
 * reply is a DM reply, so an Inbox row only ever duplicates the conversation
 * the owner is already reading.
 *
 * The rest of the E2E suite opts the Inbox back on (see `inboxSurface` in
 * `tests/helpers/bridge.ts`) so the existing inbox coverage keeps exercising
 * the flag-on path. This spec passes `inboxSurface: false` to see the shipped
 * default from `src/shared/features/inboxSurface.ts`.
 */
const ENGINEERING_CHANNEL_ID = "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9";
const OWNER_PUBKEY = "deadbeef".repeat(8);
const SENDER_PUBKEY =
  "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, undefined, { inboxSurface: false });
});

test("the sidebar has no Inbox item while the inbox flag is off", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("sidebar-primary-menu")).toBeVisible();

  await expect(page.getByTestId("open-inbox-view")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);

  // The rest of the primary nav is untouched.
  await expect(page.getByTestId("open-new-conversation")).toBeVisible();
  await expect(page.getByTestId("open-agents-view")).toBeVisible();
  await expect(page.getByTestId("open-brain-setup")).toBeVisible();
});

test("a direct /inbox link falls back to the normal landing", async ({
  page,
}) => {
  await page.goto("/#/inbox");

  await expect(page.getByTestId("sidebar-primary-menu")).toBeVisible();
  await expect(page).not.toHaveURL(/#\/inbox$/);
  await expect(page.getByTestId("home-inbox-list")).toHaveCount(0);
  await expect(page.getByTestId("open-inbox-view")).toHaveCount(0);
});

test("inbox feed items do not reach the sidebar or dock badge", async ({
  page,
}) => {
  async function getAppBadgeCount() {
    return page.evaluate(() => {
      const win = window as Window & {
        __BUZZ_E2E_APP_BADGE_COUNT__?: number;
      };

      return win.__BUZZ_E2E_APP_BADGE_COUNT__ ?? 0;
    });
  }

  async function getNotificationCount() {
    return page.evaluate(() => {
      const win = window as Window & {
        __BUZZ_E2E_NOTIFICATIONS__?: Array<{
          body: string | null;
          title: string;
        }>;
      };

      return win.__BUZZ_E2E_NOTIFICATIONS__?.length ?? 0;
    });
  }

  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  // Seeded channels may start with unreads; capture the badge after general is
  // marked read so the assertion below is a true "nothing was added".
  const baseline = await getAppBadgeCount();

  await page.evaluate(
    ({ channelId, ownerPubkey, senderPubkey }) => {
      const win = window as Window & {
        __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?: (item: {
          category: "mention" | "needs_action" | "activity" | "agent_activity";
          channel_id: string | null;
          channel_name: string;
          content: string;
          created_at: number;
          id: string;
          kind: number;
          pubkey: string;
          tags: string[][];
        }) => unknown;
      };

      win.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?.({
        category: "mention",
        channel_id: channelId,
        channel_name: "engineering",
        content: "Please review the rollout checklist.",
        created_at: Math.floor(Date.now() / 1000) + 5,
        id: `mock-inbox-disabled-${Date.now()}`,
        kind: 9,
        pubkey: senderPubkey,
        tags: [
          ["e", channelId],
          ["p", ownerPubkey],
        ],
      });
    },
    {
      channelId: ENGINEERING_CHANNEL_ID,
      ownerPubkey: OWNER_PUBKEY,
      senderPubkey: SENDER_PUBKEY,
    },
  );

  // The desktop notification proves the app ingested the feed item, so the
  // badge assertions below are not just racing an item that never arrived.
  await expect.poll(getNotificationCount).toBeGreaterThan(0);

  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);
  expect(await getAppBadgeCount()).toBe(baseline);
});
