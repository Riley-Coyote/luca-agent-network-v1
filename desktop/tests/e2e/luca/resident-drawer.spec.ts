import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

/**
 * The right drawer of a direct conversation with a resident is the resident:
 * their mark and state, an authorized model control, the first lines of
 * their instructions, their last handoff, and a way to their page. A DM with
 * a person keeps the conversation view.
 */

const RESIDENT = TEST_IDENTITIES.alice.pubkey;

test("a resident DM's drawer is the resident, and opens their page", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["alice-tyler"],
        name: "alice",
        pubkey: RESIDENT,
        status: "running",
      },
    ],
    searchProfiles: [{ displayName: "alice", isAgent: true, pubkey: RESIDENT }],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");
  await page.getByRole("button", { name: "Open conversation details" }).click();

  const drawer = page.getByTestId("resident-drawer");
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId("resident-drawer-state")).toContainText(
    "Ready",
  );
  await expect(page.getByTestId("resident-drawer-model-trigger")).toBeVisible();
  await expect(
    page.getByTestId("resident-drawer-runtime-metadata"),
  ).toHaveCount(0);
  await expect(page.getByTestId("resident-drawer-handoff")).toBeVisible();

  await page.getByTestId("resident-drawer-open-agent").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toMatch(/#\/agents\?/);
});

test("a DM with a person keeps the conversation view", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-bob-tyler").click();
  await expect(page.getByTestId("chat-title")).toHaveText("bob-tyler");
  await page.getByRole("button", { name: "Open conversation details" }).click();
  await expect(page.getByTestId("conversation-context-panel")).toBeVisible();
  await expect(page.getByTestId("resident-drawer")).toHaveCount(0);
  await expect(page.getByTestId("conversation-context-panel")).toContainText(
    "At a glance",
  );
});
